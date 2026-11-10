// Layered procedural audio driven by the physics (motor, rolling, rail joints, brakes, alarms).
import { tunnelOf } from '../core';
import { L, ME, S, TR, app, ui } from './state';

let AC = null,
  lastBeep = 0,
  SND = null,
  lastJoint = null;
/** True after the first user gesture has created the audio context */
export const hasAudio = () => !!SND;
/** Creates the Web Audio context and the sound layers; must be called from a user gesture */
export function audioInit() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      AC = null;
    }
  }
  if (AC) {
    if (AC.state === 'suspended') AC.resume();
    audioGraph();
  }
}
function audioGraph() {
  if (!AC || SND) return;
  try {
    const master = AC.createGain();
    master.gain.value = 0;
    master.connect(AC.destination);
    const mk = (type, f) => {
      const o = AC.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.start();
      return o;
    };
    const motG = AC.createGain();
    motG.gain.value = 0;
    const motF = AC.createBiquadFilter();
    motF.type = 'bandpass';
    motF.Q.value = 3;
    const m1 = mk('sawtooth', 60),
      m2 = mk('triangle', 120);
    m1.connect(motF);
    m2.connect(motF);
    motF.connect(motG);
    motG.connect(master);
    const len = AC.sampleRate * 2,
      buf = AC.createBuffer(1, len, AC.sampleRate),
      d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 6;
    }
    const noise = AC.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    noise.start();
    const rolF = AC.createBiquadFilter();
    rolF.type = 'lowpass';
    rolF.frequency.value = 200;
    const rolG = AC.createGain();
    rolG.gain.value = 0;
    noise.connect(rolF);
    rolF.connect(rolG);
    rolG.connect(master);
    const sq = mk('sine', 2350),
      sqG = AC.createGain();
    sqG.gain.value = 0;
    sq.connect(sqG);
    sqG.connect(master);
    const cb = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.05), AC.sampleRate),
      cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (AC.sampleRate * 0.006));
    SND = { master, motG, motF, m1, m2, rolF, rolG, sqG, cb };
  } catch (e) {
    SND = null;
  }
}
function clack(at, vol) {
  if (!SND) return;
  try {
    const s = AC.createBufferSource();
    s.buffer = SND.cb;
    const f = AC.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 1.2;
    const g = AC.createGain();
    g.gain.value = vol;
    s.connect(f);
    f.connect(g);
    g.connect(SND.master);
    s.start(at);
  } catch (e) {}
}
function beep(freq, dur, vol) {
  if (!AC) return;
  try {
    const o = AC.createOscillator(),
      g = AC.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    o.connect(g);
    g.connect(SND ? SND.master : AC.destination);
    const t = AC.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
  } catch (e) {}
}
/** Updates volumes and frequencies from the simulation state (once per frame) */
export function audioUpdate(now) {
  if (!SND) return;
  const t = AC.currentTime,
    k = 0.08,
    live = !ui.paused && !S.finished && !ui.muted && ui.tab === 'drive';
  SND.master.gain.setTargetAtTime(live ? 1 : 0, t, 0.05);
  if (!live) return;
  const v = S.v,
    load = S.Ft / TR.Fmax,
    tun = tunnelOf(L, S.s) ? 1.8 : 1;
  const fm = 35 + v * 21;
  SND.m1.frequency.setTargetAtTime(fm, t, k);
  SND.m2.frequency.setTargetAtTime(fm * 2.01, t, k);
  SND.motF.frequency.setTargetAtTime(fm * 3, t, k);
  SND.motG.gain.setTargetAtTime(
    v > 0.05 || load > 0 ? 0.012 + 0.05 * load + 0.02 * (S.Fed / Math.max(1, TR.edMax)) : 0,
    t,
    k,
  );
  SND.rolF.frequency.setTargetAtTime(150 + v * 28, t, k);
  SND.rolG.gain.setTargetAtTime(Math.min(0.12, (v * 0.0011 + v * v * 0.000028) * tun), t, k);
  SND.sqG.gain.setTargetAtTime(
    S.Fb - S.Fed > 0.3 * ME * TR.bSvc && v > 0.3 && v < 6 ? 0.012 * (1 - v / 6) : 0,
    t,
    0.05,
  );
  const j = Math.floor((S.s - 4) / 36);
  if (lastJoint == null) lastJoint = j;
  if (j !== lastJoint && v > 1) {
    const vol = Math.min(0.5, 0.08 + v * 0.008);
    clack(t, vol);
    clack(t + 2.5 / v, vol * 0.8);
  }
  lastJoint = j;
  if (S.vigAlarm && now - lastBeep > 450) {
    beep(1180, 0.16, 0.06);
    lastBeep = now;
  } else if ((S.sup.status === 'WAR' || S.sup.status === 'SBI') && now - lastBeep > 900) {
    beep(app.sim.scen.sig === 'ETCS' ? 880 : 620, 0.25, 0.05);
    lastBeep = now;
  }
}
