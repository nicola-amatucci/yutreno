/**
 * Shared state of the interface: saved configuration, current simulation, page state (pause, time speed, messages)
 * and formatting functions. Physics and signalling are in the core (src/core): nothing is computed here.
 */
import { DEFAULT_SCENARIO, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, toEnglish } from '../core';
import type { EventKind, LineDef, Scenario, ScenarioDef, TrainParams } from '../core';

/** Element by id */
export const $ = (id: string): any => document.getElementById(id);

/** Browser storage that never fails: without localStorage it reads null and ignores writes */
export const store = {
  get(k: string): any {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      /* storage not available */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch (e) {
      /* storage not available */
    }
  },
};

/** True if the user prefers less motion: no camera sway nor decorative animations */
export const REDUCED = (() => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
})();

export interface Cfg {
  line: LineDef;
  train: TrainParams;
  scen: Scenario;
  scenario: ScenarioDef | null;
}
const CFG_KEY = 'yutreno-cfg-v1';
// a configuration saved by version 0.x has Italian names: it is translated when read
const SAVED = (() => {
  const v = store.get(CFG_KEY);
  try {
    return v ? toEnglish<any>(v) : null;
  } catch (e) {
    return null;
  }
})();
/** Current configuration (line, train, conditions, scenario), saved in the browser */
export const cfg: Cfg = {
  line: SAVED && SAVED.line ? SAVED.line : clone(LINE_PRESETS['valle-lauro']),
  train: SAVED && SAVED.train ? SAVED.train : clone(TRAIN_PRESETS.regional),
  scen: Object.assign({}, DEFAULT_SCENARIO, (SAVED && SAVED.scen) || {}),
  scenario: (SAVED && SAVED.scenario) || null,
};
/** Saves the current configuration */
export const saveCfg = (): void => store.set(CFG_KEY, cfg);

/** Interface state that is not part of the simulation */
export const ui = {
  paused: true,
  ts: 1,
  msg: null as null | { kind: EventKind; text: string; until: number },
  dirty: true,
  tab: 'drive',
  muted: false,
  /** Train whose cab the 3D view rides in: null for the driven train (docs/GUIDE.md) */
  ride: null as string | null,
};

/** External or in-browser controller, driven in lockstep */
export const CTL = {
  kind: null as null | 'worker' | 'ws',
  period: 0.2,
  nextT: 0,
  waiting: false,
  sentAt: 0,
  worker: null as Worker | null,
  ws: null as WebSocket | null,
  lastCmd: null as unknown,
  lastErr: '',
  rtt: 0,
  timeouts: 0,
  ready: false,
  /** Observation version for the in-browser controller: 3 for `control`, 2 for the legacy `controllo` */
  api: 3 as 2 | 3,
};

/** Current simulation and end-of-run callback */
export const app = { sim: null as unknown as Simulation, onFinish: () => {} };

/** Direct references to the state of the current run (live bindings, updated by newSimulation) */
export let S: any = null,
  L: any = null,
  TR: any = null,
  F: any = null,
  ME = 0;

/**
 * The train ahead as the page draws it, read live from its train of the run: head on the main line, length, and
 * whether it is on the line (`gone` before it appears and after its run ends, or without a train ahead)
 */
export function leaderView(sim: Simulation): { readonly s: number; readonly len: number; readonly gone: boolean } {
  const r = sim.leader;
  return {
    get s() {
      return r ? sim.headLine(r) : 0;
    },
    get len() {
      return r ? r.TR.L : 0;
    },
    get gone() {
      return !r || !r.active || r.S.finished;
    },
  };
}

/** Creates a new run with the current configuration */
export function newSimulation(): Simulation {
  // the interlocking trackside needs a message-based onboard and in the page runs only in the browser ('interlocking'):
  // with the internal onboard, or with an external trackside the page cannot connect, the simple one is used
  const tracksideOk = cfg.scen.trackside === 'interlocking' && (cfg.scen.onboard ?? 'internal') !== 'internal';
  const scen =
    cfg.scen.trackside && cfg.scen.trackside !== 'simple' && !tracksideOk
      ? { ...cfg.scen, trackside: 'simple' as const }
      : cfg.scen;
  const sim = new Simulation(clone(cfg.line), cfg.train, scen, cfg.scenario);
  sim.onEvent = e => {
    if (e.hidden) return;
    ui.msg = { kind: e.kind, text: e.text, until: e.t + (e.kind === 'INFO' || e.kind === 'SIG' ? 5 : 7) };
    ui.dirty = true;
  };
  sim.onFinish = () => app.onFinish();
  ui.msg = null;
  app.sim = sim;
  S = sim.S;
  L = sim.L;
  TR = sim.TR;
  F = leaderView(sim);
  ME = sim.ME;
  return sim;
}

// ---------- formatting ----------
export const pad = (n: number): string => String(n).padStart(2, '0');
export const T0 = 8 * 3600;
export function fmtClock(t: number): string {
  const x = Math.floor(T0 + t);
  return pad(Math.floor(x / 3600) % 24) + ':' + pad(Math.floor(x / 60) % 60) + ':' + pad(x % 60);
}
export const fmtKm = (s: number): string => {
  const m = Math.round(s);
  return 'km ' + Math.floor(m / 1000) + '+' + String(m % 1000).padStart(3, '0');
};
export const fmtLate = (l: number | null): string =>
  l == null ? '—' : (l >= 0 ? '+' : '−') + Math.round(Math.abs(l)) + ' s';
export const num = (x: number, d = 1): string => (+x).toFixed(d);
export const mmss = (t: number | null): string => (t == null ? '' : Math.floor(t / 60) + ':' + pad(Math.round(t % 60)));
export const parseMmss = (t: string): number | null => {
  t = String(t).trim();
  if (!t) return null;
  if (t.includes(':')) {
    const [m, s] = t.split(':');
    return +m * 60 + (+s || 0);
  }
  return +t * 60;
};
export const leverDesc = (l: number): string =>
  l <= -8
    ? 'Emergency braking'
    : l < 0
      ? 'Service braking, step ' + -l + ' of 7'
      : l === 0
        ? 'Neutral'
        : 'Traction at ' + l * 10 + '%';
export const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"]/g,
    c => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }) as Record<string, string>)[c],
  );
export const clampN = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

// ---------- colours and canvas ----------
const css = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
export const COL: Record<string, string> = {};
['bg', 'panel', 'panel2', 'line', 'fg', 'muted', 'accent', 'sig-g', 'sig-y', 'sig-r', 'orange'].forEach(k => {
  COL[k] = (css && css.getPropertyValue('--' + k).trim()) || '#888';
});
export const MONO = "'IBM Plex Mono',ui-monospace,monospace";
export const SANS = "'IBM Plex Sans',system-ui,sans-serif";
/** Fits the canvas to its on-screen size and pixel density */
export function fit(cv: HTMLCanvasElement): { c: CanvasRenderingContext2D; W: number; H: number } {
  const r = cv.getBoundingClientRect(),
    d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)),
    h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  c.setTransform(d, 0, 0, d, 0, 0);
  return { c, W: r.width || 1, H: r.height || 1 };
}
export const LAMP: Record<string, string> = { G: '#5dff95', Y: '#ffd34d', R: '#ff4b3e' };
export const ASPCOL: Record<string, string> = { G: COL['sig-g'], Y: COL['sig-y'], R: COL['sig-r'] };
/** Pseudo-random number in [0, 1) determined by n: same n, same value (trees, houses, noise) */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
export const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export const rgb = (a: number[], al?: number): string =>
  al == null ? 'rgb(' + a.join(',') + ')' : 'rgba(' + a.join(',') + ',' + al + ')';
