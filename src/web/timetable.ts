// Timetable tab: space-time diagram with the planned and the realised timetable of every train, editor of the
// service trains (list, stops, times, drag on the diagram) and checks of the planned timetable.
import { clone, validateScenario } from '../core';
import type { CompiledLine, ScenarioDef, ServiceDef, ServiceStopDef } from '../core';
import { $, COL, MONO, SANS, T0, app, cfg, esc, fit, fmtClock, pad } from './state';
import { applyScenario } from './scenarios';
import { selectedTrain } from './control-room';
import { DEFAULT_FEED_OPTIONS, gtfsFiles, importTimetable, netexTimetable, railmlTimetable, zip } from '../feeds';

/** Working copy of the services being edited, not yet applied */
let work: ServiceDef[] = [];
let sel = -1;
let workFor: unknown = null;
const FWD = '#3d9bff',
  REV = '#e0a43a',
  CTLC = '#5dff95';

/** Planned points (time, chainage of the line) of a list of stops */
function plannedPoints(L: CompiledLine, stops: ServiceStopDef[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const x of stops) {
    const st = L.st.find(s => s.name === x.station);
    if (!st) continue;
    if (x.arrival_s != null) pts.push([x.arrival_s, st.s]);
    if (x.departure_s != null) pts.push([x.departure_s, st.s]);
  }
  return pts;
}

/** The controlled train as a list of stops, from the timetable of the line */
function controlledStops(L: CompiledLine): ServiceStopDef[] {
  return L.st.map(s => ({ station: s.name, arrival_s: s.arr, departure_s: s.dep }));
}

/** Running times between consecutive stations: from the line timetable, otherwise estimated from distance and speed */
function legTimes(L: CompiledLine): { run: number[]; dwell: number[] } {
  const st = L.st,
    run: number[] = [],
    dwell: number[] = [];
  const vmax = Math.max(40, Math.min(160, ...L.lim.map(l => l[2]))) / 3.6;
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i].dep,
      b = st[i + 1].arr;
    run.push(a != null && b != null && b > a ? b - a : Math.round((st[i + 1].s - st[i].s) / (0.7 * vmax) + 40));
    const d =
      st[i + 1].arr != null && st[i + 1].dep != null ? (st[i + 1].dep as number) - (st[i + 1].arr as number) : 30;
    dwell.push(Math.max(20, d));
  }
  return { run, dwell };
}

/** A new service calling at every station, in one direction, leaving at t0 */
function template(L: CompiledLine, id: string, dir: 1 | -1, t0: number): ServiceDef {
  const { run, dwell } = legTimes(L);
  const order = L.st.map((_, i) => i);
  if (dir < 0) order.reverse();
  const stops: ServiceStopDef[] = [];
  let t = t0;
  order.forEach((k, n) => {
    if (n === 0) {
      stops.push({ station: L.st[k].name, departure_s: t });
      return;
    }
    const leg = dir > 0 ? run[k - 1] : run[k];
    t += leg;
    if (n === order.length - 1) {
      stops.push({ station: L.st[k].name, arrival_s: t });
      return;
    }
    const dw = dir > 0 ? dwell[k - 1] : dwell[k];
    stops.push({ station: L.st[k].name, arrival_s: t, departure_s: t + dw });
    t += dw;
  });
  return { id, stops };
}

const dirOf = (L: CompiledLine, sv: ServiceDef): 1 | -1 => {
  const a = L.st.find(s => s.name === sv.stops[0]?.station),
    b = L.st.find(s => s.name === sv.stops[1]?.station);
  return a && b && b.s < a.s ? -1 : 1;
};

/** Problems of the planned timetable that the simulation would only show as delays or blocked trains */
export function checkTimetable(L: CompiledLine, services: ServiceDef[]): string[] {
  const out: string[] = [];
  const trains = [{ id: 'controlled train', stops: controlledStops(L) }, ...services];
  for (const sv of services) {
    sv.stops.forEach((x, i) => {
      if (i === 0 || i === sv.stops.length - 1) return;
      if (x.arrival_s != null && x.departure_s != null && x.departure_s - x.arrival_s < (x.min_dwell_s ?? 20))
        out.push(`${sv.id}: dwell at ${x.station} shorter than ${x.min_dwell_s ?? 20} s`);
    });
  }
  // two traces crossing between stations: a crossing on single track or an overtaking without a passing track
  const legs = (stops: ServiceStopDef[]) => {
    const p = plannedPoints(L, stops),
      out2: [number, number, number, number][] = [];
    for (let i = 0; i + 1 < p.length; i++)
      if (p[i][1] !== p[i + 1][1]) out2.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]);
    return out2;
  };
  const between = (s: number) => {
    for (let j = 0; j + 1 < L.st.length; j++)
      if (s > L.st[j].s + 250 && s < L.st[j + 1].s - 250) return `${L.st[j].name} and ${L.st[j + 1].name}`;
    return null;
  };
  for (let a = 0; a < trains.length; a++)
    for (let b = a + 1; b < trains.length; b++) {
      for (const [t1, s1, t2, s2] of legs(trains[a].stops))
        for (const [u1, r1, u2, r2] of legs(trains[b].stops)) {
          // intersection of the two segments in the (t, s) plane
          const d = (t2 - t1) * (r2 - r1) - (s2 - s1) * (u2 - u1);
          if (Math.abs(d) < 1e-9) continue;
          const x = ((u1 - t1) * (r2 - r1) - (r1 - s1) * (u2 - u1)) / d,
            y = ((u1 - t1) * (s2 - s1) - (r1 - s1) * (t2 - t1)) / d;
          if (x <= 0 || x >= 1 || y <= 0 || y >= 1) continue;
          const where = between(s1 + x * (s2 - s1));
          if (!where) continue;
          const opposite = (s2 - s1) * (r2 - r1) < 0;
          out.push(
            `${trains[a].id} and ${trains[b].id}: ${opposite ? 'crossing planned on single track' : 'overtaking planned without a passing track'} between ${where}`,
          );
        }
    }
  return out;
}

function syncWork(): void {
  const sc = cfg.scenario;
  if (workFor === sc) return;
  workFor = sc;
  work = clone(sc?.services ?? []);
  sel = work.length ? 0 : -1;
}

// ---------- diagram ----------
let geo = { t0: 0, t1: 1, X: (t: number) => t, Y: (s: number) => s, secPerPx: 1 };
let drag: { i: number; x0: number; dt: number } | null = null;

export function renderTimetable(): void {
  syncWork();
  const sim = app.sim,
    L = sim.L;
  const { c, W, H } = fit($('cvTt'));
  c.clearRect(0, 0, W, H);
  const pl = 118,
    pr = 12,
    pt = 16,
    pb = 26;
  const all = [controlledStops(L), ...work.map(s => s.stops)].flatMap(st => plannedPoints(L, st).map(p => p[0]));
  const t0 = Math.floor(Math.min(0, ...all) / 300) * 300,
    t1 = Math.ceil(Math.max(600, sim.time, ...all) / 300) * 300 + 120;
  const X = (t: number) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr),
    Y = (s: number) => pt + (s / L.len) * (H - pt - pb);
  geo = { t0, t1, X, Y, secPerPx: (t1 - t0) / (W - pl - pr) };
  // grid: stations and times
  c.font = '11px ' + SANS;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  for (const st of L.st) {
    c.strokeStyle = COL.line;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(pl, Y(st.s));
    c.lineTo(W - pr, Y(st.s));
    c.stroke();
    c.fillStyle = COL.fg;
    c.fillText(st.name, pl - 8, Y(st.s));
  }
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.font = '10px ' + MONO;
  c.fillStyle = COL.muted;
  const stepT = t1 - t0 > 5400 ? 900 : 300;
  for (let t = Math.ceil(t0 / stepT) * stepT; t <= t1; t += stepT) {
    c.strokeStyle = 'rgba(139,156,166,.15)';
    c.beginPath();
    c.moveTo(X(t), pt);
    c.lineTo(X(t), H - pb);
    c.stroke();
    c.fillText(fmtClock(t).slice(0, 5), X(t), H - 8);
  }
  // planned traces (dashed) and realised traces (solid)
  const line = (pts: [number, number][], col: string, w: number, dash: number[]) => {
    if (pts.length < 2) return;
    c.strokeStyle = col;
    c.lineWidth = w;
    c.setLineDash(dash);
    c.beginPath();
    pts.forEach(([t, s], i) => (i ? c.lineTo(X(t), Y(s)) : c.moveTo(X(t), Y(s))));
    c.stroke();
    c.setLineDash([]);
  };
  line(plannedPoints(L, controlledStops(L)), CTLC, 1.4, [5, 4]);
  work.forEach((sv, i) => {
    const off = drag && drag.i === i ? drag.dt : 0;
    const pts = plannedPoints(L, sv.stops).map(([t, s]) => [t + off, s] as [number, number]);
    line(pts, dirOf(L, sv) > 0 ? FWD : REV, i === sel || sv.id === selectedTrain() ? 2.4 : 1.4, [5, 4]);
    if (pts.length) {
      c.fillStyle = dirOf(L, sv) > 0 ? FWD : REV;
      c.font = '10px ' + MONO;
      c.textAlign = 'left';
      c.fillText(sv.id, X(pts[0][0]) + 3, Y(pts[0][1]) + (dirOf(L, sv) > 0 ? 12 : -5));
    }
  });
  // realised paths on the main line (with a network, the stretches on other lines are left out)
  for (const r of sim.trains) {
    const parts: [number, number][][] = [[]];
    const add = (t: number, s: number) => {
      const m = sim.mainChainage(r, s);
      if (m == null) {
        if (parts[parts.length - 1].length) parts.push([]);
      } else parts[parts.length - 1].push([t, m]);
    };
    for (let k = 0; k < r.S.rows.length; k += 4) {
      const row = r.S.rows[k];
      add(+row[0], +row[1]);
    }
    if (r.active && !r.S.finished) add(r.S.t, r.S.s);
    // the train chosen in the control room stands out, with a light halo under its trace
    const chosen = r.id === selectedTrain();
    if (chosen) for (const pts of parts) line(pts, 'rgba(255,255,255,.55)', 6, []);
    for (const pts of parts) line(pts, r.id === 'train' ? CTLC : r.dir > 0 ? FWD : REV, chosen ? 3.2 : 2.2, []);
  }
  if (sim.time > 0) {
    c.strokeStyle = COL.accent;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(X(sim.time), pt);
    c.lineTo(X(sim.time), H - pb);
    c.stroke();
  }
}

/** Distance (px) from the point to the planned trace of service i */
function hitDistance(i: number, x: number, y: number): number {
  const L = app.sim.L,
    pts = plannedPoints(L, work[i].stops).map(([t, s]) => [geo.X(t), geo.Y(s)]);
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k],
      [bx, by] = pts[k + 1],
      dx = bx - ax,
      dy = by - ay,
      l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(x - ax - u * dx, y - ay - u * dy));
  }
  return best;
}

const cv = $('cvTt') as HTMLCanvasElement;
cv.addEventListener('pointerdown', (e: PointerEvent) => {
  const r = cv.getBoundingClientRect(),
    x = e.clientX - r.left,
    y = e.clientY - r.top;
  let bi = -1,
    bd = 8;
  work.forEach((_, i) => {
    const d = hitDistance(i, x, y);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  if (bi < 0) return;
  sel = bi;
  drag = { i: bi, x0: x, dt: 0 };
  cv.setPointerCapture(e.pointerId);
  renderEditor();
});
cv.addEventListener('pointermove', (e: PointerEvent) => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  drag.dt = Math.round(((e.clientX - r.left - drag.x0) * geo.secPerPx) / 10) * 10;
});
cv.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.dt) shift(drag.i, drag.dt);
  drag = null;
});

// ---------- editor ----------
const clock = (t: number | null | undefined) => (t == null ? '' : fmtClock(t));
function parseClock(v: string): number | null {
  v = v.trim();
  if (!v) return null;
  const p = v.split(':').map(Number);
  if (p.some(x => !isFinite(x))) return NaN;
  const sec = (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
  return sec - T0;
}

function shift(i: number, dt: number): void {
  for (const x of work[i].stops) {
    if (x.arrival_s != null) x.arrival_s += dt;
    if (x.departure_s != null) x.departure_s += dt;
  }
  renderEditor();
}

export function renderEditor(stops = true): void {
  syncWork();
  const L = app.sim.L;
  $('ttList').innerHTML =
    '<tr><th>Train</th><th>Direction</th><th>Departure</th><th>Stops</th><th></th></tr>' +
    (work.length
      ? work
          .map(
            (sv, i) =>
              `<tr class="${i === sel ? 'sel' : ''}" data-i="${i}"><td><b>${esc(sv.id)}</b></td>` +
              `<td>${dirOf(L, sv) > 0 ? 'towards ' + esc(L.st[L.st.length - 1]?.name ?? '') : 'towards ' + esc(L.st[0]?.name ?? '')}</td>` +
              `<td class="n">${clock(sv.stops[0]?.departure_s)}</td><td class="n">${sv.stops.length}</td>` +
              `<td><button class="btn sm" data-sh="${i}" data-d="-60">−1 min</button> <button class="btn sm" data-sh="${i}" data-d="60">+1 min</button> <button class="btn sm" data-rm="${i}">Remove</button></td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" style="color:var(--muted)">No service train: only the controlled train runs. Add one below.</td></tr>');
  const sv = work[sel];
  if (stops) {
    $('ttStopsTitle').textContent = sv ? 'Stops of ' + sv.id : 'Stops';
    $('ttStops').innerHTML = sv
      ? '<tr><th>Station</th><th>Arrival</th><th>Departure</th><th>Minimum dwell (s)</th></tr>' +
        sv.stops
          .map(
            (x, k) =>
              `<tr><td>${esc(x.station)}</td><td><input type="text" size="8" data-k="${k}" data-f="arrival_s" value="${clock(x.arrival_s)}" ${k === 0 ? 'disabled' : ''}></td>` +
              `<td><input type="text" size="8" data-k="${k}" data-f="departure_s" value="${clock(x.departure_s)}" ${k === sv.stops.length - 1 ? 'disabled' : ''}></td>` +
              `<td><input type="number" min="0" step="5" style="width:70px" data-k="${k}" data-f="min_dwell_s" value="${x.min_dwell_s ?? ''}" placeholder="20" ${k === 0 || k === sv.stops.length - 1 ? 'disabled' : ''}></td></tr>`,
          )
          .join('')
      : '<tr><td style="color:var(--muted)">Select a service in the list or on the diagram.</td></tr>';
  }
  const probs = checkTimetable(L, work);
  $('ttChecks').innerHTML = probs.length
    ? probs.map(p => '<li>' + esc(p) + '</li>').join('')
    : '<li class="ok">No problem found in the planned timetable.</li>';
  const applied = JSON.stringify(cfg.scenario?.services ?? []) === JSON.stringify(work);
  $('ttState').textContent = applied
    ? 'The timetable shown is the one in use.'
    : 'Changes not yet applied: press «Apply timetable and restart».';
}

$('ttList').addEventListener('click', (e: MouseEvent) => {
  const t = e.target as HTMLElement;
  if (t.dataset.sh) {
    shift(+t.dataset.sh, +(t.dataset.d as string));
    return;
  }
  if (t.dataset.rm) {
    work.splice(+t.dataset.rm, 1);
    sel = Math.min(sel, work.length - 1);
    renderEditor();
    return;
  }
  const tr = t.closest('tr') as HTMLElement | null;
  if (tr && tr.dataset.i) {
    sel = +tr.dataset.i;
    renderEditor();
  }
});
$('ttStops').addEventListener('change', (e: Event) => {
  const t = e.target as HTMLInputElement,
    sv = work[sel];
  if (!sv || !t.dataset.f) return;
  const x = sv.stops[+(t.dataset.k as string)] as unknown as Record<string, number | null | undefined>;
  if (t.dataset.f === 'min_dwell_s') x.min_dwell_s = t.value === '' ? undefined : Math.max(0, +t.value);
  else {
    const v = parseClock(t.value);
    if (v != null && !isFinite(v)) {
      $('ttMsg').textContent = 'Times are written as hh:mm:ss, for example 08:12:30.';
      return;
    }
    x[t.dataset.f] = v;
  }
  // the table being edited is not redrawn, so that the focus moves on normally
  renderEditor(false);
});
function addService(dir: 1 | -1): void {
  const L = app.sim.L;
  const same = work.filter(s => dirOf(L, s) === dir),
    last = same.map(s => s.stops[0].departure_s as number);
  const t0 = last.length ? Math.max(...last) + 600 : dir > 0 ? 600 : 300;
  let k = same.length + 1,
    id = '';
  do {
    id = 'R ' + (2100 + 2 * k + (dir > 0 ? 0 : 1));
    k++;
  } while (work.some(s => s.id === id));
  work.push(template(L, id, dir, t0));
  sel = work.length - 1;
  renderEditor();
}
$('ttAddF').onclick = () => addService(1);
$('ttAddR').onclick = () => addService(-1);
$('ttRevert').onclick = () => {
  workFor = null;
  syncWork();
  renderEditor();
  $('ttMsg').textContent = 'Changes discarded.';
};
$('ttApply').onclick = () => {
  const base: ScenarioDef = cfg.scenario
    ? clone(cfg.scenario)
    : { name: 'Timetable', description: 'Service trains edited in the Timetable tab.' };
  base.services = clone(work);
  const L = app.sim.L;
  if (work.some(s => dirOf(L, s) < 0)) base.leader = { ...(base.leader ?? {}), on: false };
  if (!work.length) delete base.services;
  const err = validateScenario(base);
  if (err.length) {
    $('ttMsg').textContent = 'The timetable has errors: ' + err.join('; ') + '.';
    return;
  }
  try {
    applyScenario(base);
  } catch (e) {
    $('ttMsg').textContent = 'The timetable cannot be used: ' + (e as Error).message;
    return;
  }
  workFor = cfg.scenario;
  $('ttMsg').textContent = 'Timetable applied: start the run from the Drive tab and follow it here.';
  renderEditor();
};

// ---------- import and export ----------
/** Decompresses a deflated ZIP entry with the browser's DecompressionStream */
async function inflateRaw(d: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  return new Uint8Array(await new Response(new Blob([d as BlobPart]).stream().pipeThrough(ds)).arrayBuffer());
}
function save(name: string, data: BlobPart, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const feedOptions = () => ({ ...DEFAULT_FEED_OPTIONS, start: fmtClock(0) });
$('ttImport').onclick = () => ($('ttImportFile') as HTMLInputElement).click();
$('ttImportFile').addEventListener('change', async (e: Event) => {
  const inp = e.target as HTMLInputElement,
    f = inp.files?.[0];
  inp.value = '';
  if (!f) return;
  try {
    const r = await importTimetable(
      f.name,
      new Uint8Array(await f.arrayBuffer()),
      { line: app.sim.L.def, start: fmtClock(0) },
      inflateRaw,
    );
    $('ttImportLog').innerHTML = r.warnings.map(w => '<li>' + esc(w) + '</li>').join('');
    if (!r.services.length) {
      $('ttMsg').textContent = `No service of ${f.name} runs on this line.`;
      return;
    }
    work = r.services;
    sel = 0;
    renderEditor();
    $('ttMsg').textContent =
      `${r.services.length} services imported from ${{ gtfs: 'GTFS', netex: 'NeTEx', railml: 'railML' }[r.format]} (${f.name}): check them and apply the timetable.`;
  } catch (err) {
    $('ttMsg').textContent = `${f.name} cannot be imported: ${(err as Error).message}`;
  }
});
$('ttGtfs').onclick = () =>
  save('yutreno-gtfs.zip', zip(gtfsFiles(app.sim, feedOptions())) as BlobPart, 'application/zip');
$('ttNetex').onclick = () => save('yutreno-netex.xml', netexTimetable(app.sim, feedOptions()), 'application/xml');
$('ttRailml').onclick = () => save('yutreno-railml.xml', railmlTimetable(app.sim, feedOptions()), 'application/xml');
void pad;
