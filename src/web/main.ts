// Driving interface: driver controls, tabs, panels and main loop.
// The loop advances the simulation with a fixed step and, with a controller, stops to wait for its command.
import { FIXED_DT, altOf, clamp, clone, fmtErr, leverLabel } from '../core';
import {
  $,
  COL,
  store,
  CTL,
  L,
  ME,
  S,
  TR,
  app,
  cfg,
  esc,
  fmtClock,
  fmtKm,
  fmtLate,
  leverDesc,
  newSimulation,
  num,
  pad,
  saveCfg,
  ui,
} from './state';
import { audioInit, audioUpdate, hasAudio } from './audio';
import { pad as padState, padStatus, pollPad } from './gamepad';
import { ctlOnReset, ctlSend, ctlStartWorker, ctlStop } from './controllers';
import { edOpen, trOpen } from './editors';
import { renderChart, renderCouplers, renderDmi, renderLine, renderView } from './render';
import { renderScenarioTab, verdictHtml } from './scenarios';
import { init3d, render3d, scene3d, setQuality, viewLine, viewTrain } from './view3d';
import { describeScene } from './scene-fingerprint';
import { DYN, dynConnect, dynStatus, dynStep, dynUsed } from './dynamics';
import { OBX, obConnect, obStatus, obStep, obUsed } from './onboard';
import { renderPanel } from './panel';
import { renderEditor, renderTimetable } from './timetable';
import { controlRoomJson, renderControlRoom } from './control-room';
import { renderMaker } from './scenario-maker';
import type { Quality } from './view3d';

const MAX_STEPS = 240;

/** New run with the current configuration (stops the simulation and shows the briefing) */
export function resetRun() {
  newSimulation();
  ui.paused = true;
  if (dynUsed()) {
    if (!DYN.ws || DYN.url !== (app.sim.TR.external?.address || 'ws://localhost:8766')) dynConnect();
    else {
      DYN.waiting = false;
      DYN.exchanges = 0;
    }
  } else if (DYN.ws) dynConnect();
  const obUrl = (document.getElementById('obUrl') as HTMLInputElement).value.trim();
  if (obUsed()) {
    if (!OBX.ws || OBX.url !== obUrl) obConnect(obUrl);
    else {
      OBX.waiting = false;
      OBX.exchanges = 0;
    }
  } else if (OBX.ws) obConnect(obUrl);
  syncOnboardUi();
  ctlOnReset();
  if (CTL.kind) app.sim.S.commandSource = CTL.kind;
  ui.dirty = true;
}
/** Shows the onboard choice only with ETCS and the address only with the external onboard */
function syncOnboardUi() {
  const etcs = cfg.scen.sig === 'ETCS';
  $('scOnboard').disabled = !etcs;
  $('scOnboard').value = cfg.scen.onboard || 'internal';
  $('scTrackside').disabled = !etcs || (cfg.scen.onboard || 'internal') === 'internal';
  $('scTrackside').value = cfg.scen.trackside || 'simple';
  $('obUrlL').hidden = !(etcs && cfg.scen.onboard === 'external');
}
$('obUrl').addEventListener('change', () => {
  store.set('yutreno-onboard-url', $('obUrl').value.trim());
  if (obUsed()) {
    resetRun();
  }
});
{
  const u = store.get('yutreno-onboard-url') || store.get('yutreno-bordo-url');
  if (u) $('obUrl').value = u;
}
/** Moves the lever to position l; a manual command takes the train away from the controller */
export function setLever(l) {
  if (CTL.kind) {
    ctlStop('Control taken back by the driver');
  }
  app.sim.setLever(l);
  ui.dirty = true;
}
/** Acknowledges the vigilance */
export function vigPress() {
  app.sim.vigilance();
  ui.dirty = true;
}
/** Pauses or resumes the run */
export function togglePause() {
  if (app.sim.done) return;
  ui.paused = !ui.paused;
  ui.dirty = true;
}
function cycleTs() {
  const o = [1, 2, 4, 8];
  ui.ts = o[(o.indexOf(ui.ts) + 1) % o.length];
  ui.dirty = true;
}
const segEl = $('seg');
for (let l = -8; l <= 10; l++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'notch' + (l + 8);
  b.dataset.l = String(l);
  b.textContent = l <= -8 ? 'EM' : l < 0 ? String(-l) : String(l);
  b.className = l <= -8 ? 'em' : l < 0 ? 'b' : l === 0 ? 'n' : 't';
  b.title = leverDesc(l);
  b.addEventListener('click', () => setLever(l));
  segEl.appendChild(b);
}
$('vigBtn').onclick = () => {
  audioInit();
  vigPress();
};
$('urgBtn').onclick = () => app.sim.emergency('commanded by the driver');
$('pauseBtn').onclick = togglePause;
$('tsBtn').onclick = cycleTs;
$('resetBtn').onclick = () => {
  resetRun();
  $('summary').hidden = true;
  $('brief').hidden = false;
};
$('startBtn').onclick = () => {
  audioInit();
  $('brief').hidden = true;
  ui.paused = false;
  ui.dirty = true;
};
$('startAuto').onclick = () => {
  audioInit();
  $('brief').hidden = true;
  ctlStartWorker();
  ui.paused = false;
  ui.dirty = true;
};
$('againBtn').onclick = () => {
  const auto = CTL.kind;
  resetRun();
  $('summary').hidden = true;
  audioInit();
  if (auto === 'worker') ctlStartWorker();
  ui.paused = false;
};
$('closeSum').onclick = () => {
  $('summary').hidden = true;
};
window.addEventListener('keydown', e => {
  const tg = e.target && (e.target as any).tagName;
  if (tg === 'TEXTAREA' || tg === 'INPUT' || tg === 'SELECT') return;
  if (ui.tab !== 'drive') return;
  const k = e.key.toLowerCase();
  if (k === 'arrowup' || k === 'w') {
    setLever(S.lever + 1);
    e.preventDefault();
  } else if (k === 'arrowdown' || k === 's') {
    setLever(S.lever - 1);
    e.preventDefault();
  } else if (k === ' ') {
    audioInit();
    vigPress();
    e.preventDefault();
  } else if (k === 'n' || k === '0') setLever(0);
  else if (k === 'e') app.sim.emergency('commanded by the driver');
  else if (k === 'p') togglePause();
  else if (k === 't') cycleTs();
  else if (k === 'm') {
    audioInit();
    ui.muted = !ui.muted;
    ui.dirty = true;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !ui.paused && !S.finished) {
    ui.paused = true;
    ui.dirty = true;
  }
});
const SCK = { scSig: 'sig', scTod: 'tod', scMet: 'met', scAdh: 'adh', scOnboard: 'onboard', scTrackside: 'trackside' };
Object.keys(SCK).forEach(id => {
  $(id).addEventListener('change', () => {
    const key = SCK[id],
      old = cfg.scen[key];
    cfg.scen[key] = $(id).value;
    app.sim.scen[key] = cfg.scen[key];
    saveCfg();
    if ((key === 'sig' || key === 'onboard' || key === 'trackside') && old !== cfg.scen[key]) {
      ctlStop('');
      resetRun();
      updateBrief();
      $('summary').hidden = true;
      $('brief').hidden = false;
    }
    ui.dirty = true;
  });
});

/** Copies to the clipboard; if the browser does not allow it, selects the text in a box */
export function copyText(txt, label, hintId?) {
  const h = $(hintId || 'csvHint');
  const done = () => {
    h.textContent = label + ' copied to the clipboard.';
  };
  const fallback = () => {
    const ta = hintId === 'lnMsg' ? $('lnJson') : hintId === 'scnMsg' ? $('scnJson') : $('csvOut');
    ta.hidden = false;
    ta.value = txt;
    ta.focus();
    ta.select();
    h.textContent = 'Copy not allowed here: the text is selected in the box, press Ctrl+C.';
  };
  try {
    navigator.clipboard.writeText(txt).then(done, fallback);
  } catch (err) {
    fallback();
  }
}
$('csvBtn').onclick = () => {
  copyText(app.sim.csv(), S.rows.length + ' samples');
};
$('evBtn').onclick = () =>
  copyText(
    't_s,pos_m,kind,description\n' +
      S.events
        .map(e => [e.t.toFixed(1), e.s.toFixed(1), e.kind, '"' + e.text.replace(/"/g, '""') + '"'].join(','))
        .join('\n'),
    S.events.length + ' events',
  );

let lastUI = 0,
  lastTables = 0,
  lastCr = 0;
$('crPause').onclick = togglePause;
$('crTs').onclick = cycleTs;
$('crJson').onclick = () => copyText(controlRoomJson(), 'Control room snapshot', 'crHint');
function bar(id, val) {
  const el = $(id),
    fr = clamp(val / Math.max(200000, TR.Fmax * 1.2), -1, 1);
  el.style.left = (fr >= 0 ? 50 : 50 + fr * 50) + '%';
  el.style.width = Math.abs(fr) * 50 + '%';
  el.style.background = fr >= 0 ? COL.accent : COL.orange;
}
const kN = x => num(x / 1000, 1) + ' kN';
function updateUI(now) {
  renderPanel();
  $('subTitle').textContent =
    TR.name +
    ' · ' +
    L.def.name +
    ' · ' +
    num(L.len / 1000, 1) +
    ' km · ' +
    (app.sim.scen.sig === 'ETCS' ? 'ERTMS/ETCS L2' : 'automatic block + SCMT');
  $('clock').textContent = fmtClock(S.t);
  const st = L.st[S.nextSt];
  $('nextSt').textContent = st ? st.name + (st.arr != null ? ' ' + fmtClock(st.arr).slice(0, 5) : '') : '—';
  $('pos').textContent = fmtKm(S.s);
  $('cmdBy').textContent =
    CTL.kind === 'worker' ? 'in-browser controller' : CTL.kind === 'ws' ? 'external controller' : 'driver';
  $('hudGrade').textContent =
    ((S.grade || 0) >= 0 ? '+' : '−') +
    num(Math.abs(S.grade || 0), 1) +
    ' ‰ · ' +
    Math.round(altOf(L, S.s)) +
    ' m a.s.l.';
  $('hudTs').textContent = 'time ×' + ui.ts;
  $('tsBtn').textContent = 'Time ×' + ui.ts;
  $('hudPause').hidden = !ui.paused;
  {
    const d = dynStatus();
    $('hudDyn').hidden = !d;
    $('hudDyn').textContent = d;
    $('hudDyn').className = 'chip' + (DYN.err ? ' warn' : '');
  }
  {
    const o = obStatus();
    $('hudOb').hidden = !o;
    $('hudOb').textContent = o;
    $('hudOb').className = 'chip' + (OBX.err ? ' warn' : '');
  }
  $('pauseBtn').textContent = ui.paused ? 'Resume' : 'Pause';
  const m = ui.msg && S.t < ui.msg.until ? ui.msg : null;
  const me = $('msg');
  me.hidden = !m;
  if (m) {
    me.textContent = m.text;
    me.className = 'msg ' + m.kind;
  }
  {
    // passengers: at a stop the people alighting and boarding, while running those on board
    const px = app.sim.pax;
    $('hudPax').hidden = !px;
    // of the train the view rides in: the driven one, or the one chosen in "Ride in"
    const r = view.mode === '3d' && view.ok ? viewTrain() : app.sim.train,
      RS = r.S;
    if (px) {
      const on = Math.round(px.onboard(r.id)),
        st = RS.doors ? r.stations[RS.nextSt] : null,
        x = st ? px.stopOf(r.id, st.name) : null;
      $('hudPax').textContent = x
        ? Math.round(x.alighted) +
          ' off · ' +
          Math.round(x.boarded) +
          ' on · ' +
          on +
          ' on board' +
          (RS.paxDue != null && RS.t < RS.paxDue ? ' · boarding ' + Math.ceil(RS.paxDue - RS.t) + ' s' : '')
        : on + ' passengers on board';
    }
  }
  {
    // riding in the cab of another train: its number, speed and next stop; the list follows the trains of the run
    const ids = app.sim.trains.slice(1).map(r => r.id),
      opts = ['', ...ids];
    if (
      $('scRide').options.length !== opts.length ||
      [...$('scRide').options].some((o: any, i) => o.value !== opts[i])
    ) {
      $('scRide').innerHTML =
        '<option value="">your train</option>' +
        ids.map(id => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join('');
    }
    if (ui.ride && !ids.includes(ui.ride)) ui.ride = null;
    $('scRide').value = ui.ride ?? '';
    $('scRide').disabled = !ids.length || view.mode !== '3d';
    const seat = view.mode === '3d' && view.ok ? viewTrain() : app.sim.train,
      on = seat !== app.sim.train;
    $('hudRide').hidden = !ui.ride;
    if (ui.ride) {
      const r = app.sim.trains.find(x => x.id === ui.ride),
        nx = r ? r.stations[r.S.nextSt] : null;
      $('hudRide').textContent =
        on && r
          ? 'In the cab of ' +
            r.id +
            (viewLine() ? ' on ' + viewLine() : '') +
            ' · ' +
            Math.round(r.S.v * 3.6) +
            ' km/h' +
            (nx ? ' · next ' + nx.name : '')
          : ui.ride + ' is not running: view from your train';
    }
  }
  $('notchLbl').textContent = leverLabel(S.lever);
  $('notchDesc').textContent =
    S.doors && S.uT > 0
      ? 'Doors open: traction inhibited'
      : CTL.kind
        ? 'The controller is in command: traction ' +
          Math.round(S.uT * 100) +
          '%, brake ' +
          Math.round(S.uB * 100) +
          '%'
        : leverDesc(S.lever);
  segEl.querySelectorAll('button').forEach((b: any) => b.classList.toggle('cur', +b.dataset.l === S.lever));
  const sp = S.sup;
  $('dmiTitle').textContent = app.sim.scen.sig === 'ETCS' ? 'ETCS DMI' : 'SCMT panel';
  $('lProt').className = 'lamp on ' + { NOR: 'ok', IND: 'in', OVS: 'wa', WAR: 'wa', SBI: 'er', INT: 'er' }[sp.status];
  $('lProt').textContent = app.sim.scen.sig === 'ETCS' ? 'ETCS' : 'SCMT';
  $('lVig').className = 'lamp' + (S.vigAlarm ? ' on wa' : '');
  $('lDoor').className = 'lamp' + (S.doors ? ' on in' : '');
  $('lSlip').className = 'lamp' + (S.slip ? ' on wa' : '');
  $('lWsp').className = 'lamp' + (S.wsp ? ' on wa' : '');
  $('lUrg').className = 'lamp' + (S.eb ? ' on er' : '');
  $('vigBtn').classList.toggle('alarm', S.vigAlarm);
  $('pillMu').textContent = 'μ ' + num(app.sim.mu, 2);
  Object.keys(SCK).forEach(id => {
    const v = cfg.scen[SCK[id]] ?? (SCK[id] === 'onboard' ? 'internal' : SCK[id] === 'trackside' ? 'simple' : '');
    if ($(id).value !== v) $(id).value = v;
  });
  bar('bT', S.Ft);
  bar('bB', -S.Fb);
  bar('bR', -S.R);
  bar('bG', -S.Fg);
  bar('bN', S.v > 0.01 || S.a > 0 ? ME * S.a : 0);
  $('vT').textContent = kN(S.Ft);
  $('vB').textContent = kN(-S.Fb);
  $('vR').textContent = kN(-S.R);
  $('vG').textContent = kN(-S.Fg);
  $('vN').textContent = kN(ME * S.a);
  $('eq').textContent =
    num(ME / 1000, 1) +
    ' t · ' +
    num(S.a, 2) +
    ' m/s² = ' +
    num(S.Ft / 1000, 1) +
    ' − ' +
    num(S.Fb / 1000, 1) +
    ' − ' +
    num(S.R / 1000, 1) +
    ' − (' +
    num(S.Fg / 1000, 1) +
    ')  [kN]';
  $('forceHint').textContent =
    'Of the brake, ' +
    num(S.Fed / 1000, 0) +
    ' kN are electric and regenerate energy. Scale ±' +
    Math.round(Math.max(200, (TR.Fmax * 1.2) / 1000)) +
    ' kN.';
  $('padTxt').textContent = padStatus();
  $('coupStats').innerHTML = app.sim.mm
    ? '<span>Maximum tension now <b>' +
      num(S.Tnow / 1000, 0) +
      ' kN</b></span><span>Maximum compression now <b>' +
      num(S.Cnow / 1000, 0) +
      ' kN</b></span>' +
      '<span>In the run <b>' +
      num(S.maxTension / 1000, 0) +
      ' / ' +
      num(S.maxCompression / 1000, 0) +
      ' kN</b></span><span>Tail speed <b>' +
      num(S.vTail * 3.6, 1) +
      ' km/h</b></span><span>Jerk <b>' +
      num(S.jerk, 2) +
      ' m/s³</b></span>'
    : '';
  $('calBtn').textContent = padState.cal
    ? 'Confirm'
    : padState.lever
      ? 'Recalibrate lever'
      : 'Calibrate physical lever';
  $('calClr').hidden = !padState.lever && !padState.cal;
  $('calClr').textContent = padState.cal ? 'Cancel' : 'Disconnect lever';
  $('muteBtn').textContent = ui.muted ? 'Audio on' : 'Audio off';
  $('mdMan').setAttribute('aria-pressed', String(!CTL.kind && !CTL.ws));
  $('mdWorker').setAttribute('aria-pressed', String(CTL.kind === 'worker'));
  $('mdWs').setAttribute('aria-pressed', String(CTL.kind === 'ws' || !!CTL.ws));
  $('ctlStat').textContent =
    (CTL.kind
      ? 'In command: ' +
        (CTL.kind === 'worker'
          ? 'in-browser controller' + (CTL.api === 2 ? ' (legacy API version 2)' : '')
          : 'external controller') +
        '\nControl steps: ' +
        S.ctlTicks +
        ' · response in ' +
        num(CTL.rtt, 1) +
        ' ms\nLast command: ' +
        JSON.stringify(CTL.lastCmd || {})
      : 'Manual driving. Choose a controller to hand the train over to it.') +
    (CTL.lastErr ? '\n\n' + CTL.lastErr : '') +
    (ui.paused && CTL.kind ? '\n\nThe simulation is paused: start it from the Drive tab.' : '');
  if (ui.dirty || now - lastTables > 1000) {
    renderTables();
    if (ui.tab === 'scenarios') renderScenarioTab();
    lastTables = now;
  }
  const sc = app.sim.scenario;
  $('pillScen').hidden = !sc;
  if (sc) $('pillScen').textContent = 'Scenario: ' + sc.name;
  ui.dirty = false;
}
function renderTables() {
  const rm = S.reactions.length ? num(S.reactions.reduce((a, b) => a + b, 0) / S.reactions.length, 2) + ' s' : '—';
  const etcs = app.sim.scen.sig === 'ETCS';
  const rows = [
    ['Running time', Math.floor(S.t / 60) + ' min ' + pad(Math.floor(S.t % 60)) + ' s'],
    ['Traction energy', num(S.eT, 1) + ' kWh'],
    ['Energy regenerated in braking', num(S.eR, 1) + ' kWh'],
    ['Net energy', num(S.eT - S.eR, 1) + ' kWh'],
    ['Warnings', String(S.warns)],
    [etcs ? 'ETCS service brakings' : 'Service brakings', String(S.sbiCount)],
    ['Protection interventions', String(S.interventions)],
    [etcs ? 'End of authority overruns' : 'Red signals passed', String(S.spad)],
    ['Maximum over the line limit', S.maxOverLine > 0 ? num(S.maxOverLine, 1) + ' km/h' : 'none'],
    ['Wheel slip time', num(S.slipT, 1) + ' s'],
    ['Dynamics model', app.sim.mm ? 'multi-mass, ' + app.sim.mm.n + ' vehicles' : 'point mass'],
    [
      'Maximum coupler tension / compression',
      num(S.maxTension / 1000, 0) + ' / ' + num(S.maxCompression / 1000, 0) + ' kN',
    ],
    ['Maximum jerk at the head', num(S.maxJerk, 2) + ' m/s³'],
    ['Vigilance: acknowledgements, mean time', S.reactions.length + ' · ' + rm],
    ['Missed vigilance', String(S.vigMissed)],
    ['Controller steps', String(S.ctlTicks)],
  ];
  $('metrics').innerHTML = rows.map(r => '<tr><td>' + r[0] + '</td><td class="n">' + r[1] + '</td></tr>').join('');
  $('stops').innerHTML =
    '<tr><th>Station</th><th style="text-align:right">Stop error</th><th style="text-align:right">Delay</th></tr>' +
    (S.stops.length
      ? S.stops
          .map(
            s =>
              '<tr><td>' +
              esc(s.name) +
              '</td><td class="n">' +
              (s.err == null ? 'missed' : fmtErr(s.err)) +
              '</td><td class="n">' +
              fmtLate(s.late) +
              '</td></tr>',
          )
          .join('')
      : '<tr><td colspan="3" style="color:var(--muted)">No stop made yet</td></tr>');
  $('events').innerHTML = S.events
    .slice(-60)
    .reverse()
    .map(
      e =>
        '<li><time>' +
        fmtClock(e.t) +
        '</time><span class="' +
        e.kind +
        '">' +
        esc(e.text) +
        (e.hidden ? ' <em class="hid">not announced</em>' : '') +
        '</span></li>',
    )
    .join('');
}
/** Rows of the passengers for the summary (docs/PASSENGERS.md); none without passengers */
function paxRows() {
  const p = app.sim.passengers();
  if (!p) return [];
  return [
    [
      'Passengers carried by all the trains',
      Math.round(p.boarded) + ' (' + Math.round(p.left_behind) + ' left behind by full trains)',
    ],
    [
      'Mean wait on the platform / journey',
      Math.round(p.mean_wait_s) + ' s / ' + Math.round(p.mean_journey_s / 60) + ' min',
    ],
    ['Delay per passenger', fmtLate(p.mean_passenger_delay_s)],
    ...(p.transfers > 0
      ? [
          [
            'Changes of train',
            Math.round(p.transfers) +
              ', ' +
              Math.round(p.mean_transfer_wait_s) +
              ' s each (' +
              Math.round(p.transfer_passenger_min) +
              ' passenger-minutes)',
          ],
        ]
      : []),
    ['Energy per passenger-km', p.energy_wh_per_pkm == null ? '—' : num(p.energy_wh_per_pkm, 1) + ' Wh'],
  ];
}
function showSummary() {
  renderTables();
  const good = S.stops.filter(s => s.err != null),
    last = S.stops[S.stops.length - 1];
  const merr = good.length ? num(good.reduce((a, s) => a + Math.abs(s.err), 0) / good.length, 1) + ' m' : '—';
  $('sumBody').innerHTML =
    '<table>' +
    [
      ['Arrival', fmtClock(S.t) + (last && last.late != null ? ' (' + fmtLate(last.late) + ' on the timetable)' : '')],
      ['Command', CTL.kind ? 'automatic controller' : 'driver'],
      ['Mean stop error', merr],
      ['Net energy', num(S.eT - S.eR, 1) + ' kWh (' + num(S.eR, 1) + ' regenerated)'],
      ['Warnings / service brakings / interventions', S.warns + ' / ' + S.sbiCount + ' / ' + S.interventions],
      [app.sim.scen.sig === 'ETCS' ? 'End of authority overruns' : 'Red signals passed', String(S.spad)],
      [
        'Vigilance: mean reaction time',
        S.reactions.length ? num(S.reactions.reduce((a, b) => a + b, 0) / S.reactions.length, 2) + ' s' : '—',
      ],
    ]
      .concat(paxRows())
      .map(r => '<tr><td>' + r[0] + '</td><td class="n">' + r[1] + '</td></tr>')
      .join('') +
    '</table>' +
    verdictHtml(true) +
    '<p style="margin-top:10px">The complete data are in the Data tab and can be copied as CSV.</p>';
  $('summary').hidden = false;
}
/** Updates the start-of-run briefing with line, train, conditions and scenario */
export function updateBrief() {
  const a = L.st[0],
    b = L.st[L.st.length - 1];
  $('briefEye').textContent = 'SHIFT 08:00 · ' + TR.name.toUpperCase();
  $('briefTitle').textContent = 'Drive the train from ' + (a ? a.name : '?') + ' to ' + (b ? b.name : '?');
  $('briefText').textContent =
    (app.sim.scen.sig === 'ETCS'
      ? 'Line equipped with ERTMS/ETCS level 2: no lineside signals, the movement authority arrives in the cab and the DMI shows permitted speed, distance to target and line profile. '
      : 'Line with three-aspect automatic block and SCMT protection: the lineside signals show you green, yellow and red. ') +
    (L.def.freight && L.def.freight.on
      ? 'A slower train runs ahead of you, so the clear route will get shorter. '
      : '') +
    'Respect the limits, stop with the head of the train at the white stop marker of every station and acknowledge the vigilance when it sounds.' +
    (app.sim.scenario ? ' Scenario «' + app.sim.scenario.name + '»: ' + (app.sim.scenario.description || '') : '');
}

const TABS = ['drive', 'line', 'train', 'scenarios', 'timetable', 'control', 'controller', 'data'];
function showTab() {
  const h = (location.hash || '').replace('#', '');
  ui.tab = TABS.includes(h) ? h : 'drive';
  TABS.forEach(t => {
    $('tab-' + t).hidden = t !== ui.tab;
  });
  document.querySelectorAll('nav.tabs a').forEach((a: any) => {
    if (a.dataset.tab === ui.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (ui.tab === 'line') edOpen();
  if (ui.tab === 'train') trOpen();
  if (ui.tab === 'timetable') renderEditor();
  if (ui.tab === 'scenarios') renderMaker();
  ui.dirty = true;
}
window.addEventListener('hashchange', showTab);

// 3D view (Three.js) falling back to the 2D view if WebGL is not available
const view = {
  mode: (store.get('yutreno-view') || '3d') as '3d' | '2d',
  q: (store.get('yutreno-quality') || (matchMedia('(max-width:720px)').matches ? 'low' : 'medium')) as Quality,
  ok: false,
};
function applyView() {
  if (view.mode === '3d' && !view.ok) view.ok = init3d($('view3d'), view.q);
  const on = view.mode === '3d' && view.ok;
  $('view3d').hidden = !on;
  document.querySelector('.view').classList.toggle('v3d', on);
  $('scView').value = on ? '3d' : '2d';
  $('scQual').value = view.q;
  $('scQual').disabled = !on;
  if (view.mode === '3d' && !view.ok) {
    $('scView').title = 'WebGL not available in this browser: using the 2D view';
  }
}
$('scView').addEventListener('change', () => {
  view.mode = $('scView').value;
  store.set('yutreno-view', view.mode);
  applyView();
});
$('scRide').addEventListener('change', () => {
  ui.ride = $('scRide').value || null;
  ui.dirty = true;
});
$('scQual').addEventListener('change', () => {
  view.q = $('scQual').value;
  store.set('yutreno-quality', view.q);
  setQuality(view.q);
});
applyView();

let last = performance.now(),
  acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  pollPad();
  if (!ui.paused && !app.sim.done) {
    acc = Math.min(acc + dt * ui.ts, 0.6);
    let n = 0;
    while (acc >= FIXED_DT && n < MAX_STEPS * ui.ts && !app.sim.done) {
      if (CTL.kind && !S.finished) {
        if (CTL.waiting) {
          if (now - CTL.sentAt > 1500) {
            CTL.timeouts++;
            CTL.waiting = false;
            CTL.nextT = S.t + CTL.period;
            CTL.lastErr = 'The controller did not respond within 1.5 s: keeping the last command.';
            if (CTL.timeouts >= 3) ctlStop('Controller stopped: not responding');
          } else break;
        } else if (CTL.ready && S.t + 1e-9 >= CTL.nextT) {
          ctlSend();
          break;
        } else if (!CTL.ready) break;
      }
      if (!obStep(now)) break;
      if (!dynStep(now)) break;
      app.sim.step(FIXED_DT);
      app.sim.sample();
      acc -= FIXED_DT;
      n++;
    }
  } else acc = 0;
  if (hasAudio()) audioUpdate(now);
  if (ui.tab === 'timetable') renderTimetable();
  if (ui.tab === 'control' && (ui.dirty || now - lastCr > 250)) {
    renderControlRoom();
    lastCr = now;
  }
  if (ui.tab === 'drive') {
    renderDmi();
    if (view.mode === '3d' && view.ok) render3d(now);
    else renderView();
    renderLine();
    renderChart();
    renderCouplers();
  }
  if (ui.dirty || now - lastUI > 100) {
    updateUI(now);
    lastUI = now;
  }
  requestAnimationFrame(frame);
}
app.onFinish = showSummary;
resetRun();
updateBrief();
showTab();
requestAnimationFrame(frame);
(window as any).YuTreno = {
  observe: () => app.sim.observe(CTL.period),
  command: c => {
    app.sim.applyCommand(c);
    ui.dirty = true;
  },
  config: () => clone(cfg),
  line: () => clone(L.def),
  simulation: () => app.sim,
  scene3d: () => describeScene(scene3d()),
};
