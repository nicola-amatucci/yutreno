// Input devices via the Gamepad API: standard controller and calibrated USB lever (like device-input of LibreCorsa).
import { clamp } from '../core';
import { $, S, app, store, ui } from './state';
import { audioInit } from './audio';
import { setLever, vigPress, togglePause } from './main';

const PAD_KEY = 'banco-guida-leva-v1';
/** Calibrated USB lever (saved in the browser) and calibration in progress */
export const pad = { lever: store.get(PAD_KEY), cal: null };
let padPrev = {},
  padRep = {},
  padLastNotch = null;
const pads = () => {
  try {
    return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean);
  } catch (e) {
    return [];
  }
};
function axisToNotch(raw) {
  let u = clamp((raw - pad.lever.back) / (pad.lever.fwd - pad.lever.back), 0, 1);
  const c = u * 2 - 1;
  if (Math.abs(c) < 0.06) return 0;
  if (c > 0) return clamp(Math.round(c * 10), 1, 10);
  if (c < -0.94) return -8;
  return -clamp(Math.round(-c * 7.4), 1, 7);
}
/** Reads the connected gamepads and turns levers and buttons into commands */
export function pollPad() {
  const list = pads(),
    now = performance.now();
  for (const p of list) {
    const btn = i => !!(p.buttons[i] && p.buttons[i].pressed),
      prev = padPrev[p.index] || {},
      edge = i => btn(i) && !prev[i];
    if (p.mapping === 'standard') {
      for (const [i, dl] of [
        [12, 1],
        [13, -1],
      ]) {
        if (edge(i)) {
          setLever(S.lever + dl);
          padRep[i] = now + 400;
        } else if (btn(i) && now > (padRep[i] || 0)) {
          setLever(S.lever + dl);
          padRep[i] = now + 150;
        }
      }
      if (edge(0)) {
        audioInit();
        vigPress();
      }
      if (edge(1)) app.sim.emergency('commanded by the driver');
      if (edge(9)) togglePause();
    }
    const st = {};
    p.buttons.forEach((b, i) => (st[i] = b.pressed));
    padPrev[p.index] = st;
  }
  if (pad.lever && !pad.cal) {
    const p = list.find(x => x.id === pad.lever.id);
    if (p && p.axes[pad.lever.axis] != null) {
      const n = axisToNotch(p.axes[pad.lever.axis]);
      if (n !== padLastNotch) {
        padLastNotch = n;
        setLever(n);
      }
    }
  }
}
/** Status text of the input devices for the Train tab */
export function padStatus() {
  const list = pads();
  let t = list.length
    ? 'Device: ' + list.map(p => p.id.replace(/\s*\(.*$/, '')).join(', ')
    : 'No device detected. Connect a controller or a USB lever and press a button.';
  if (pad.cal)
    t =
      pad.cal.step === 1
        ? 'Calibration 1 of 2: push the lever fully forward (maximum traction), then press Confirm.'
        : 'Calibration 2 of 2: pull the lever fully back (braking), then press Confirm.';
  else if (pad.lever) t += ' · lever calibrated on axis ' + pad.lever.axis;
  return t;
}
const snapAxes = () => pads().map(p => ({ id: p.id, axes: Array.from(p.axes) }));
/** Advances the guided calibration of the lever */
export function calStep() {
  if (!pad.cal) {
    if (!pads().length) {
      ui.dirty = true;
      return;
    }
    pad.cal = { step: 1, a: null };
    ui.dirty = true;
    return;
  }
  if (pad.cal.step === 1) {
    pad.cal.a = snapAxes();
    pad.cal.step = 2;
    ui.dirty = true;
    return;
  }
  const b = snapAxes();
  let best = null;
  for (const pa of pad.cal.a) {
    const pb = b.find(x => x.id === pa.id);
    if (!pb) continue;
    pa.axes.forEach((v, i) => {
      const d = Math.abs((pb.axes[i] ?? v) - v);
      if (!best || d > best.d) best = { d, id: pa.id, axis: i, fwd: v, back: pb.axes[i] };
    });
  }
  pad.cal = null;
  if (best && best.d > 0.3) {
    pad.lever = { id: best.id, axis: best.axis, fwd: best.fwd, back: best.back };
    padLastNotch = null;
    store.set(PAD_KEY, pad.lever);
    app.sim.event('INFO', 'Physical lever calibrated on axis ' + best.axis);
  } else app.sim.event('WARN', 'Calibration failed: no axis moved enough.');
  ui.dirty = true;
}
$('calBtn').onclick = calStep;
$('calClr').onclick = () => {
  pad.lever = null;
  pad.cal = null;
  padLastNotch = null;
  store.del(PAD_KEY);
  ui.dirty = true;
};
$('muteBtn').onclick = () => {
  audioInit();
  ui.muted = !ui.muted;
  ui.dirty = true;
};
window.addEventListener('gamepadconnected', () => {
  ui.dirty = true;
});
window.addEventListener('gamepaddisconnected', () => {
  ui.dirty = true;
});
