// Control room: schematic of the whole network, train table, log and the existing commands.
// The page only draws the snapshot of the engine (sim.controlRoom(), docs/CONTROL_ROOM.md) and sends the commands that
// already exist (operator commands of the trackside, time speed): no signalling or traffic logic here. The layout of the
// schematic is computed from the topology of the network: every line is a horizontal band in its own chainages, and
// the bands are aligned so that each node falls at the same abscissa on the two lines it joins.
import {
  withDispatched,
  type ControlRoomSnapshot,
  type CrLine,
  type CrTrain,
  type DispatchCommand,
  type ScenarioDef,
} from '../core';
import type { OperatorCommand } from '../trackside';
import { $, app, cfg, esc, fmtClock, fmtKm, ui } from './state';

const ROW = 128,
  TOP = 64,
  PAD = 28,
  LOOP = 15;
let selected: string | null = null;
let lastKey = '';

/** Abscissa (m) of the origin of every line and its row: breadth first from the main line along the nodes */
function layout(c: ControlRoomSnapshot) {
  const lines = c.network.lines,
    place = new Map<string, { x0: number; row: number }>();
  place.set(lines[0].id, { x0: 0, row: 0 });
  let row = 0;
  for (let pass = 0; pass < lines.length; pass++)
    for (const nd of c.network.nodes) {
      const from = nd.lines.find(id => place.has(id));
      if (!from) continue;
      const a = lines.find(l => l.id === from) as CrLine,
        sa = a.stations.find(s => s.name === nd.name) as CrLine['stations'][number];
      for (const id of nd.lines) {
        if (place.has(id)) continue;
        const b = lines.find(l => l.id === id) as CrLine,
          sb = b.stations.find(s => s.name === nd.name) as CrLine['stations'][number];
        place.set(id, { x0: (place.get(from) as { x0: number }).x0 + sa.s_m - sb.s_m, row: ++row });
      }
    }
  for (const l of lines) if (!place.has(l.id)) place.set(l.id, { x0: 0, row: ++row });
  const xs = lines.flatMap(l => {
    const p = place.get(l.id) as { x0: number };
    return [p.x0, p.x0 + l.length_m];
  });
  return { place, min: Math.min(...xs), max: Math.max(...xs), rows: row + 1 };
}

const delayClass = (d: number | null) => (d == null ? 'ok' : d <= 60 ? 'ok' : d <= 300 ? 'late' : 'very-late');
const fmtDelay = (d: number | null) => {
  if (d == null) return '—';
  const m = Math.round(d / 60);
  return m === 0 ? 'on time' : (m > 0 ? '+' : '−') + Math.abs(m) + ' min';
};
const STATUS: Record<string, string> = {
  not_started: 'not yet on the line',
  running: 'running',
  stopped: 'stopped',
  dwelling: 'at the platform',
  broken_down: 'broken down',
  cancelled: 'cancelled',
  finished: 'arrived',
};
const OCC: Record<string, string> = {
  empty: 'empty',
  manySeatsAvailable: 'many seats free',
  fewSeatsAvailable: 'few seats free',
  standingRoomOnly: 'standing room only',
  crushedStandingRoomOnly: 'crowded',
  full: 'full',
};
const DRIVER: Record<string, string> = {
  controlled: 'driver or controller',
  ato: 'built-in ATO',
  agent: 'external agent',
};

/** The schematic as SVG */
function schematic(c: ControlRoomSnapshot, width: number): string {
  const L = layout(c),
    k = (width - 2 * PAD) / Math.max(1, L.max - L.min);
  const X = (id: string, s: number) => PAD + ((L.place.get(id) as { x0: number }).x0 + s - L.min) * k;
  const Y = (id: string) => TOP + (L.place.get(id) as { row: number }).row * ROW;
  const h = TOP + L.rows * ROW;
  const svg: string[] = [];
  svg.push(
    `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img" aria-label="Schematic of the network">`,
  );
  svg.push(
    '<defs><pattern id="crHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#ee4a45"/></pattern></defs>',
  );
  // connectors of the nodes
  for (const nd of c.network.nodes) {
    const [a, ...rest] = nd.lines,
      la = c.network.lines.find(l => l.id === a) as CrLine,
      sa = la.stations.find(s => s.name === nd.name) as { s_m: number };
    for (const b of rest) {
      const lb = c.network.lines.find(l => l.id === b) as CrLine,
        sb = lb.stations.find(s => s.name === nd.name) as { s_m: number };
      svg.push(`<line class="cr-node" x1="${X(a, sa.s_m)}" y1="${Y(a)}" x2="${X(b, sb.s_m)}" y2="${Y(b)}"/>`);
    }
  }
  for (const l of c.network.lines) {
    const y = Y(l.id),
      x = (s: number) => X(l.id, s),
      yT = (track: string) => (/^II(:|$)/.test(track) ? y + LOOP : y);
    svg.push(`<text class="cr-line" x="${x(0)}" y="${y - 22}">${esc(l.name)}</text>`);
    svg.push(`<line class="cr-track" x1="${x(0)}" y1="${y}" x2="${x(l.length_m)}" y2="${y}"/>`);
    // stations: the passing track between the single-track stretches around them
    for (const st of l.stations) {
      if (st.tracks === 2) {
        const before = [...l.single_track].reverse().find(t => t.to_m <= st.s_m),
          after = l.single_track.find(t => t.from_m >= st.s_m);
        const a = before ? before.to_m : st.s_m - 250,
          b = after ? after.from_m : st.s_m + 250;
        svg.push(
          `<path class="cr-track" d="M${x(a - 60)},${y} L${x(a)},${y + LOOP} L${x(b)},${y + LOOP} L${x(b + 60)},${y}"/>`,
        );
      }
      svg.push(`<line class="cr-stop" x1="${x(st.s_m)}" y1="${y - 6}" x2="${x(st.s_m)}" y2="${y + LOOP + 6}"/>`);
      svg.push(`<text class="cr-st" x="${x(st.s_m)}" y="${y + LOOP + 30}" text-anchor="middle">${esc(st.name)}</text>`);
      if (st.waiting != null)
        svg.push(
          `<text class="cr-wait" x="${x(st.s_m)}" y="${y + LOOP + 44}" text-anchor="middle">${Math.round(st.waiting)} waiting<title>People waiting on the platforms of ${esc(st.name)}</title></text>`,
        );
    }
    // occupation: the sections of the interlocking or the block sections of each direction
    if (l.sections) {
      // the routes set or in use (the automatic block routes are not shown: they are always set on vacant sections)
      for (const r of l.routes ?? []) {
        const yy = r.track_to !== 'I' ? yT(r.track_to) : yT(r.track_from);
        svg.push(
          `<line class="cr-lock" x1="${x(r.from_m)}" y1="${yy}" x2="${x(r.to_m)}" y2="${yy}"><title>${esc(r.name)}: ${esc(r.state)}</title></line>`,
        );
      }
      for (const s of l.sections) {
        if (s.state === 'vacant') continue;
        const cls = s.state === 'occupied' ? 'cr-occ' : 'cr-dist';
        const yy = s.track === '*' ? y : yT(s.track);
        svg.push(
          `<line class="${cls}" x1="${x(s.from_m)}" y1="${yy}" x2="${x(s.to_m)}" y2="${yy}"><title>${esc(s.id)}: ${s.state}${s.locked ? ', locked' : ''}</title></line>`,
        );
      }
    } else
      for (const b of l.blocks) {
        if (!b.occupied) continue;
        const yy = b.dir > 0 ? y - 5 : y + LOOP + 5;
        svg.push(`<line class="cr-occ thin" x1="${x(b.from_m)}" y1="${yy}" x2="${x(b.to_m)}" y2="${yy}"/>`);
      }
    for (const z of l.blocked)
      svg.push(
        `<rect x="${x(z.from_m)}" y="${y - 7}" width="${Math.max(2, x(z.to_m) - x(z.from_m))}" height="14" fill="url(#crHatch)" opacity=".8"><title>Line blocked</title></rect>`,
      );
    // single track: the direction it is open to
    for (const t of l.single_track) {
      if (t.orientation == null) continue;
      const m = x((t.from_m + t.to_m) / 2),
        arrow = t.orientation > 0 ? '→' : t.orientation < 0 ? '←' : '·';
      svg.push(
        `<text class="cr-orient" x="${m}" y="${y - 9}" text-anchor="middle">${arrow}<title>Single track ${fmtKm(t.from_m)}–${fmtKm(t.to_m)}: ${t.orientation > 0 ? 'open towards the end of the line' : t.orientation < 0 ? 'open towards the origin' : 'free'}</title></text>`,
      );
    }
    // points and their position
    for (const p of l.points ?? []) {
      const yy = p.junction ? yT(p.track) : y + LOOP / 2;
      svg.push(
        `<circle class="cr-pt${p.position === 'R' ? ' rev' : ''}${p.fault ? ' bad' : ''}" cx="${x(p.s_m)}" cy="${yy}" r="3.2"><title>Point ${esc(p.id)} ${p.position}${p.locked ? ', locked' : ''}${p.junction ? ', junction to ' + esc(p.junction) : ''}</title></circle>`,
      );
    }
    // signals (on ETCS level 2 the marker boards): above the track for direction +1, below for −1
    for (const g of l.signals) {
      const yy = g.dir > 0 ? y - 12 : y + LOOP + 12,
        cls = g.aspect === 'G' ? 'g' : g.aspect === 'Y' ? 'y' : g.aspect === 'R' ? 'r' : 'n';
      svg.push(
        `<circle class="cr-sig ${cls}" cx="${x(g.s_m)}" cy="${yy}" r="2.6"><title>Signal ${esc(g.id)} (${g.dir > 0 ? 'towards the end' : 'towards the origin'}): ${g.aspect ?? '—'}</title></circle>`,
      );
    }
    for (const n of l.node_routes ?? []) {
      const st = l.stations.find(s => s.name === n.node);
      if (st && n.owner)
        svg.push(
          `<text class="cr-gate" x="${x(st.s_m)}" y="${y - 30}" text-anchor="middle">node route: ${esc(n.owner)}</text>`,
        );
    }
  }
  // trains: the stretch they occupy on every line, the label at the head
  for (const t of c.trains) {
    if (t.line == null) continue;
    const cls = `cr-train ${delayClass(t.delay_s)}${t.id === selected ? ' sel' : ''}`;
    for (const o of t.occupies) {
      const l = c.network.lines.find(z => z.id === o.line) as CrLine;
      const station = l.stations.find(s => s.tracks === 2 && Math.abs((o.from_m + o.to_m) / 2 - s.s_m) < 300);
      const yy = Y(o.line) + (t.track === 'II' && station ? LOOP : 0);
      svg.push(
        `<rect class="${cls}" data-train="${esc(t.id)}" x="${X(o.line, o.from_m)}" y="${yy - 5}" width="${Math.max(3, X(o.line, o.to_m) - X(o.line, o.from_m))}" height="10" rx="2"><title>${esc(t.id)}</title></rect>`,
      );
    }
    const yy = Y(t.line) + (t.dir === -1 ? LOOP + 48 : -40),
      hx = X(t.line, t.s_m as number);
    svg.push(
      `<text class="cr-label ${delayClass(t.delay_s)}" data-train="${esc(t.id)}" x="${hx}" y="${yy}" text-anchor="${t.dir === -1 ? 'start' : 'end'}">${t.dir === -1 ? '◀ ' : ''}${esc(t.id)} · ${Math.round(t.v_kmh)} km/h · ${fmtDelay(t.delay_s)}${t.dir === 1 ? ' ▶' : ''}</text>`,
    );
  }
  svg.push('</svg>');
  return svg.join('');
}

function trainTable(c: ControlRoomSnapshot): string {
  const pax = c.trains.some(t => t.passengers);
  const head =
    '<tr><th>Train</th><th>Status</th><th>Where</th><th style="text-align:right">Speed</th><th style="text-align:right">Delay</th><th>Next stop</th>' +
    (pax ? '<th>Passengers</th>' : '') +
    '<th>Driven by</th></tr>';
  const people = (t: CrTrain) =>
    !pax
      ? ''
      : `<td>${t.passengers ? `${Math.round(t.passengers.onboard)} on board<br><span class="hint">${t.passengers.seats} seats + ${t.passengers.standing} standing · ${OCC[t.passengers.occupancy] ?? t.passengers.occupancy}</span>` : '—'}</td>`;
  const row = (t: CrTrain) => {
    const where =
      t.line == null ? '—' : `${esc(t.line)} ${fmtKm(t.s_m as number)}${t.track === 'II' ? ' (track II)' : ''}`;
    const nx = t.next_stop
      ? `${esc(t.next_stop.station)}${t.next_stop.planned_arrival_s != null ? ' ' + fmtClock(t.next_stop.planned_arrival_s).slice(0, 5) : ''}${t.next_stop.arrival_s != null && t.next_stop.arrival_s !== t.next_stop.planned_arrival_s ? ' (now ' + fmtClock(t.next_stop.arrival_s).slice(0, 5) + ')' : ''}`
      : '—';
    const extra = [
      t.next_service ? 'then ' + esc(t.next_service) : '',
      ...(t.connections ?? []).map(x => `waits for ${esc(x.from)} at ${esc(x.station)}: ${x.outcome}`),
    ]
      .filter(Boolean)
      .join('; ');
    return `<tr data-train="${esc(t.id)}" class="${t.id === selected ? 'sel' : ''}"><td><b>${esc(t.id)}</b><br><span class="hint">${esc(t.train)}</span></td><td>${STATUS[t.status] ?? t.status}${extra ? '<br><span class="hint">' + extra + '</span>' : ''}</td><td>${where}</td><td class="n">${Math.round(t.v_kmh)} km/h</td><td class="n ${delayClass(t.delay_s)}">${fmtDelay(t.delay_s)}</td><td>${nx}</td>${people(t)}<td>${DRIVER[t.driver] ?? t.driver}</td></tr>`;
  };
  return head + c.trains.map(row).join('');
}

function logList(c: ControlRoomSnapshot): string {
  const vig = ($('crVig') as HTMLInputElement).checked;
  return c.log
    .filter(e => vig || e.kind !== 'VIG')
    .slice(-80)
    .reverse()
    .map(
      e =>
        `<li><time>${fmtClock(e.t_s)}</time><span class="${e.kind}"><b>${esc(e.train)}</b> ${esc(e.text)}</span></li>`,
    )
    .join('');
}

function routesPanel(c: ControlRoomSnapshot): string {
  const q = c.panel;
  if (!q) return '';
  const stopped = !!q.ma && /emergency stop/.test(q.ma.reason);
  let h =
    `<div class="ctrl"><button class="btn sm" data-q="ars">${q.ars ? 'Disable' : 'Enable'} automatic route setting</button>` +
    `<button class="btn sm urg" data-q="${stopped ? 'revoke_emergency_stop' : 'emergency_stop'}">${stopped ? 'Revoke emergency stop' : 'Emergency stop of all trains'}</button></div>`;
  const busy = q.routes.filter(r => r.state !== 'free'),
    free = q.routes.filter(r => r.state === 'free');
  h += `<table class="tt">${busy.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.name)}</td><td>${esc(r.state)}</td><td><button class="btn sm" data-q="cancel_route" data-id="${esc(r.id)}">Cancel</button></td></tr>`).join('') || '<tr><td class="hint">No route set</td></tr>'}</table>`;
  h += `<div class="ctrl"><select id="crRoute">${free.map(r => `<option value="${esc(r.id)}">${esc(r.id)} · ${esc(r.name)}</option>`).join('')}</select><button class="btn sm" data-q="set_route">Set route</button></div>`;
  if (q.consents?.length)
    h += `<p class="hint">Block consents: ${q.consents.map(x => `${esc(x.segment)} → ${esc(x.holder ?? 'in transit')}`).join('; ')}</p>`;
  return h;
}

/** Updates the control room; the routes panel is rebuilt only when it changes, so its buttons stay clickable */
export function renderControlRoom(): void {
  const c = app.sim.controlRoom();
  const wrap = $('crMap') as HTMLElement;
  wrap.innerHTML = schematic(c, Math.max(720, wrap.clientWidth || 1200));
  $('crTrains').innerHTML = trainTable(c);
  $('crLog').innerHTML = logList(c);
  $('crClock').textContent = fmtClock(c.t_s);
  $('crPause').textContent = ui.paused ? 'Resume' : 'Pause';
  $('crTs').textContent = 'Time ×' + ui.ts;
  const rp = routesPanel(c),
    key = rp;
  $('crRoutesP').hidden = !c.panel;
  if (key !== lastKey) {
    $('crRoutes').innerHTML = rp;
    lastKey = key;
  }
  dispatcherPanel();
}

/** Dispatcher panel: the chosen train, the buttons that need one, the commands given */
function dispatcherPanel(): void {
  const sim = app.sim,
    r = selected ? sim.trains.find(t => t.id === selected) : null;
  $('dpTrain').textContent = r ? r.id + (r.S.finished ? ' (arrived)' : '') : 'click a train';
  for (const id of ['dpHold', 'dpSkip', 'dpCancel', 'dpPrio'])
    ($(id) as HTMLButtonElement).disabled = !r || r.S.finished;
  const n = sim.dispatched.length;
  if ($('dpCount').textContent !== String(n)) {
    $('dpCount').textContent = String(n);
    $('dpLog').textContent = sim.dispatched.map(d => fmtClock(d.t_s) + '  ' + JSON.stringify(d.command)).join('\n');
  }
}

/** Gives a command to the engine and says what happened */
function give(c: DispatchCommand): void {
  const why = app.sim.dispatch(c);
  $('dpMsg').textContent = why
    ? 'Not applied: ' + why + '.'
    : 'Applied at ' + fmtClock(app.sim.time) + ': ' + JSON.stringify(c);
  ui.dirty = true;
  renderControlRoom();
}

/** Next stop of the chosen train: the one it is standing at with doors open, or the next one */
function nextStop(): { id: string; name: string; dep: number | null; arr: number | null } | null {
  const r = selected ? app.sim.trains.find(t => t.id === selected) : null;
  const st = r ? r.stations[r.S.nextSt] : null;
  return r && st ? { id: r.id, name: st.name, dep: st.dep, arr: st.arr } : null;
}

$('dpHold').onclick = () => {
  const n = nextStop();
  if (n)
    give({
      type: 'retime',
      train: n.id,
      station: n.name,
      departure_s: Math.round(Math.max(n.dep ?? n.arr ?? 0, app.sim.time) + 120),
    });
};
$('dpSkip').onclick = () => {
  const n = nextStop();
  if (n) give({ type: 'skip_stop', train: n.id, station: n.name });
};
$('dpCancel').onclick = () => {
  const n = nextStop();
  if (n) give({ type: 'cancel', train: n.id, from_station: n.name });
};
$('dpPrio').onclick = () => {
  if (selected) give({ type: 'priority', train: selected, value: 10 });
};
const tsr = (revoke: boolean) =>
  give({
    type: 'speed_restriction',
    from_m: Math.round(+$('dpFrom').value * 1000),
    to_m: Math.round(+$('dpTo').value * 1000),
    v_kmh: +$('dpV').value,
    ...(revoke ? { revoke: true } : {}),
  });
$('dpTsr').onclick = () => tsr(false);
$('dpTsrOff').onclick = () => tsr(true);
$('dpCopy').onclick = () => {
  void navigator.clipboard?.writeText(JSON.stringify(app.sim.dispatched, null, 1));
  $('dpMsg').textContent = 'Commands copied as JSON.';
};
// the scenario of the run with the commands as its events, in the JSON of the Scenario tab: applied, it repeats the run
$('dpScenario').onclick = () => {
  const base: ScenarioDef = app.sim.scenario ?? {
    name: 'Run with the commands of the dispatcher',
    line: cfg.line,
    train: cfg.train,
    signalling: cfg.scen.sig,
    weather: cfg.scen.met,
    adhesion: cfg.scen.adh,
    ...(cfg.scen.onboard ? { onboard: cfg.scen.onboard } : {}),
    ...(cfg.scen.trackside ? { trackside: cfg.scen.trackside } : {}),
  };
  ($('scnJson') as HTMLTextAreaElement).value = JSON.stringify(withDispatched(base, app.sim.dispatched), null, 2);
  $('dpMsg').textContent =
    `${app.sim.dispatched.length} commands written into the scenario, in the JSON of the Scenario tab: apply it there to run again with them.`;
};

/** The train chosen in the control room (also highlighted in the space-time diagram), null if none */
export function selectedTrain(): string | null {
  return selected;
}

/** The snapshot as JSON, to copy */
export function controlRoomJson(): string {
  return JSON.stringify(app.sim.controlRoom(), null, 1);
}

function select(e: Event) {
  const el = (e.target as HTMLElement).closest('[data-train]') as HTMLElement | null;
  if (!el) return;
  selected = selected === el.dataset.train ? null : (el.dataset.train ?? null);
  renderControlRoom();
}
$('crMap').addEventListener('click', select);
$('crTrains').addEventListener('click', select);
$('crVig').addEventListener('change', () => renderControlRoom());
$('crRoutes').addEventListener('click', (e: Event) => {
  const b = (e.target as HTMLElement).closest('button[data-q]') as HTMLButtonElement | null;
  const tr = app.sim.tr;
  if (!b || !tr) return;
  const k = b.dataset.q as string;
  let c: OperatorCommand;
  if (k === 'cancel_route') c = { type: 'cancel_route', id: b.dataset.id ?? '' };
  else if (k === 'set_route') c = { type: 'set_route', id: ($('crRoute') as HTMLSelectElement).value };
  else if (k === 'ars') c = { type: 'ars', active: !(tr.panel?.ars ?? true) };
  else if (k === 'emergency_stop') c = { type: 'emergency_stop' };
  else c = { type: 'revoke_emergency_stop' };
  app.sim.operatorCommand(c);
  lastKey = '';
  ui.dirty = true;
});
