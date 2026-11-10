// Control centre panel: state of the interlocking and of the RBC of the trackside component and the operator's commands.
// The page only reads the panel returned by the trackside and sends commands with sim.operatorCommand(): no logic here.
import type { OperatorCommand, PanelState } from '../trackside';
import { $, app, esc, fmtKm, ui } from './state';

const ROUTE_STATE: Record<string, string> = {
  free: 'free',
  setting: 'setting',
  set: 'set',
  occupied: 'occupied',
  cancelling: 'cancelling',
};
const POINT_POS: Record<string, string> = {
  N: 'normal',
  R: 'reverse',
  moving: 'moving',
  no_end_position: 'no detection',
};

let lastKey = '';

/** Updates the panel; rebuilds the content only when the panel state changes, so the buttons stay clickable */
export function renderPanel(): void {
  const tr = app.sim.tr;
  const box = $('panelP');
  box.hidden = !tr;
  if (!tr) {
    lastKey = '';
    return;
  }
  const q: PanelState | null = tr.panel;
  const key = JSON.stringify(q);
  if (key === lastKey) return;
  lastKey = key;
  if (!q) {
    $('panel').innerHTML = '<p class="hint">Waiting for the first response of the trackside…</p>';
    return;
  }
  // group the elements by site (the part before the slash)
  const site = (id: string) => id.split('/')[0];
  const name = (id: string) => id.split('/').slice(1).join('/');
  const sites = [...new Set([...q.routes.map(r => site(r.id)), ...q.points.map(d => site(d.id))])];
  const stopped = !!q.ma && /emergency stop/.test(q.ma.reason);
  const ma = q.ma
    ? `end of authority <b>${fmtKm(q.ma.eoa_m)}</b> · ${esc(q.ma.reason)}`
    : 'no authority (train not yet in session)';
  let h =
    `<div class="qd-top"><span>${ma}</span><button class="btn" data-q="ars">${q.ars ? 'Disable' : 'Enable'} automatic route setting</button>` +
    `<button class="btn urg" data-q="${stopped ? 'revoke_emergency_stop' : 'emergency_stop'}">${stopped ? 'Revoke emergency stop' : 'Emergency stop'}</button></div>`;
  h += '<div class="qd-grid">';
  for (const k of sites) {
    const routes = q.routes.filter(r => site(r.id) === k);
    const points = q.points.filter(d => site(d.id) === k);
    const sections = q.tvps.filter(t => site(t.id) === k);
    h += `<div class="qd-imp"><h4>${esc(k)}</h4><table class="qd">`;
    for (const r of routes) {
      const act =
        r.state === 'free'
          ? `<button class="btn sm" data-q="set_route" data-id="${esc(r.id)}">Set</button>`
          : `<button class="btn sm" data-q="cancel_route" data-id="${esc(r.id)}">Cancel</button>`;
      h += `<tr class="st-${r.state}"><td>${esc(name(r.id))}</td><td>${esc(r.name)}</td><td>${ROUTE_STATE[r.state] ?? r.state}${r.cancel_at_s != null ? ' (at ' + Math.round(r.cancel_at_s) + ' s)' : ''}</td><td>${act}</td></tr>`;
    }
    h += '</table><p class="qd-elements">';
    h += points
      .map(
        d =>
          `<span class="qd-dev${d.fault || d.position === 'no_end_position' ? ' bad' : ''}">Point ${esc(name(d.id))} ${POINT_POS[d.position] ?? d.position}${d.locked ? ' 🔒' : ''}</span>`,
      )
      .join(' ');
    h += ' ' + sections.map(t => `<span class="qd-cdb ${t.state}">${esc(name(t.id))}</span>`).join(' ');
    h += '</p></div>';
  }
  const line = q.tvps.filter(t => site(t.id) === 'Line');
  if (line.length)
    h += `<div class="qd-imp"><h4>Line (automatic block)</h4><p class="qd-elements">${line.map(t => `<span class="qd-cdb ${t.state}">${esc(name(t.id))}${t.locked ? ' 🔒' : ''}</span>`).join(' ')}</p></div>`;
  h += '</div>';
  if (q.speed_restrictions.length)
    h += `<p class="hint">Speed restrictions: ${q.speed_restrictions.map(z => `${fmtKm(z.from_m)}–${fmtKm(z.to_m)} at ${z.v_kmh} km/h`).join('; ')}</p>`;
  $('panel').innerHTML = h;
}

$('panel').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button[data-q]') as HTMLButtonElement | null;
  const tr = app.sim.tr;
  if (!b || !tr) return;
  const k = b.dataset.q as string,
    id = b.dataset.id ?? '';
  let c: OperatorCommand;
  if (k === 'set_route' || k === 'cancel_route') c = { type: k, id };
  else if (k === 'ars') c = { type: 'ars', active: !(tr.panel?.ars ?? true) };
  else if (k === 'emergency_stop') c = { type: 'emergency_stop' };
  else c = { type: 'revoke_emergency_stop' };
  app.sim.operatorCommand(c);
  ui.dirty = true;
});
