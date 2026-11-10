/** Built-in lines and trains */
import { CONSISTS } from './consist';
import { fitPlan } from './line';
import type { NetworkDef } from './network';
import type { LineDef, Scenario, TrainParams } from './types';

const RAW_LINES: Record<string, LineDef> = {
  'valle-lauro': {
    name: 'Valle Lauro – Monte Clanio', fitLen: 15300, geo: { lat: 40.879, lon: 14.632 },
    plan: [[0, 0], [1800, 0], [2700, 180], [4300, 420], [5300, 300], [6800, -80], [8300, 120], [9800, 520], [10500, 430], [12000, 300], [13300, 520], [15400, 600]],
    profile: [[0, 120], [1800, 120], [4200, 139.2], [6200, 131.2], [9200, 167.2], [11200, 147.2], [15300, 159.5]],
    stations: [
      { name: 'Valle Lauro', s: 150, arr: null, dep: 0 },
      { name: 'Ponte Sabato', s: 5200, arr: 260, dep: 290 },
      { name: 'San Felice Scalo', s: 10400, arr: 620, dep: 650 },
      { name: 'Monte Clanio', s: 15000, arr: 880, dep: null },
    ],
    limits: [[0, 700, 60], [700, 4500, 140], [4500, 5650, 90], [5650, 9700, 120], [9700, 10900, 80], [10900, 14300, 150], [14300, 1e9, 70]],
    tunnels: [], block: 1300,
    freight: { on: true, s0: 3200, vmax: 80, stopAt: 7600, wait: 150, len: 450 },
  },
  appennino: {
    name: "Valico dell'Appennino", fitLen: 18500, geo: { lat: 41.002, lon: 15.112 },
    plan: [[0, 0], [1200, 150], [2200, 700], [3000, 1500], [4200, 1900], [5600, 1700], [6800, 2300], [7600, 3300], [8400, 4100], [10200, 4700], [11600, 5400], [12500, 6300], [13800, 6800], [15200, 6600], [16600, 7200], [17800, 7700]],
    profile: [[0, 210], [1500, 212], [6200, 330], [6900, 332], [12300, 467], [13000, 468], [18500, 400]],
    stations: [
      { name: 'Fondovalle', s: 200, arr: null, dep: 0 },
      { name: 'Castagneto', s: 6550, arr: 360, dep: 390 },
      { name: 'Valico', s: 12650, arr: 760, dep: 790 },
      { name: 'Piano Alto', s: 18200, arr: 1110, dep: null },
    ],
    limits: [[0, 600, 60], [600, 6000, 100], [6000, 7200, 80], [7200, 9000, 90], [9000, 11800, 100], [11800, 13200, 70], [13200, 17700, 110], [17700, 1e9, 60]],
    tunnels: [[3300, 3900], [9000, 11800]], block: 1500,
    freight: { on: true, s0: 2700, vmax: 55, stopAt: 0, wait: 0, len: 400 },
  },
  'rocca-sabato': {
    name: 'San Felice Scalo – Rocca Sabato', fitLen: 9600, geo: { lat: 40.912, lon: 14.735 },
    plan: [[0, 0], [900, 500], [2100, 1300], [3400, 1700], [4800, 2600], [6100, 3000], [7400, 3900], [8600, 4300], [9600, 4900]],
    profile: [[0, 155.2], [2200, 158], [5200, 182], [7600, 190.4], [9600, 196]],
    stations: [
      { name: 'San Felice Scalo', s: 150, arr: null, dep: 0 },
      { name: 'Pietrarsa', s: 4700, arr: 250, dep: 280 },
      { name: 'Rocca Sabato', s: 9300, arr: 540, dep: null },
    ],
    limits: [[0, 600, 60], [600, 4300, 100], [4300, 5100, 80], [5100, 8900, 100], [8900, 1e9, 60]],
    tunnels: [[6300, 6900]], block: 1500,
    freight: { on: false, s0: 3000, vmax: 80, stopAt: 0, wait: 0, len: 450 },
  },
  // a straight link that closes a loop with the main line and the branch: its two ends fall on Ponte Sabato and on
  // Pietrarsa of the network valle-lauro-anello
  'ponte-pietrarsa': {
    name: 'Ponte Sabato – Pietrarsa', geo: { lat: 40.881, lon: 14.69 },
    plan: [[0, 0], [4662, 1175.3], [9324, 2350.6]],
    profile: [[150, 135.2], [4800, 151], [9465, 178]],
    stations: [
      { name: 'Ponte Sabato', s: 150, arr: null, dep: 0 },
      { name: 'Casale Sabato', s: 4800, arr: 260, dep: 290 },
      { name: 'Pietrarsa', s: 9465, arr: 560, dep: null },
    ],
    limits: [[0, 600, 60], [600, 9000, 110], [9000, 1e9, 60]],
    tunnels: [], block: 1500,
    freight: { on: false, s0: 3000, vmax: 80, stopAt: 0, wait: 0, len: 450 },
  },
};

/** Built-in lines, already scaled to the desired length (`fitLen`) */
export const LINE_PRESETS: Record<string, LineDef> = Object.fromEntries(Object.entries(RAW_LINES).map(([k, v]) => [k, fitPlan(v)]));

/**
 * Built-in networks (docs/design/network.md): the lines and, implicitly, the nodes where they share a station. The
 * first line is the main one, that of the controlled train.
 */
export const NETWORK_PRESETS: Record<string, NetworkDef> = {
  'valle-lauro-rocca': { name: 'Valle Lauro with the Rocca Sabato branch', lines: ['valle-lauro', 'rocca-sabato'] },
  'valle-lauro-anello': { name: 'Valle Lauro, Rocca Sabato branch and Ponte Sabato – Pietrarsa link', lines: ['valle-lauro', 'rocca-sabato', 'ponte-pietrarsa'] },
};

/** Built-in trains: regional EMU, high-speed train and freight train, all with the multi-mass model */
export const TRAIN_PRESETS: Record<string, TrainParams> = {
  regional: {
    name: 'Regional EMU (4 cars)', m: 160000, rot: 1.08, L: 110, Pw: 2.4e6, Fmax: 170000, adh: 0.5, A: 2200, B: 28, C: 5.2,
    bSvc: 1.0, bEm: 1.3, tauB: 1.0, tauR: 1.8, eta: 0.86, edMax: 110000, etaR: 0.75, vmax: 160 / 3.6,
    model: 'multimass', consist: CONSISTS.regional, coupler: { k: 15e6, c: 2.5e5, slack: 0.002 }, epBrake: true, vProp: 280, kTunnel: 1.6,
  },
  high_speed: {
    name: 'High-speed train (8 cars)', m: 450000, rot: 1.04, L: 200, Pw: 8.8e6, Fmax: 370000, adh: 0.5, A: 4500, B: 60, C: 9,
    bSvc: 0.9, bEm: 1.2, tauB: 1.2, tauR: 2, eta: 0.88, edMax: 300000, etaR: 0.8, vmax: 300 / 3.6,
    model: 'multimass', consist: CONSISTS.high_speed, coupler: { k: 20e6, c: 3e5, slack: 0.002 }, epBrake: true, vProp: 280, kTunnel: 1.8,
  },
  freight: {
    name: 'Heavy freight (loco + 1200 t)', m: 1300000, rot: 1.06, L: 550, Pw: 5.6e6, Fmax: 300000, adh: 0.068, A: 13000, B: 110, C: 20,
    bSvc: 0.45, bEm: 0.65, tauB: 4, tauR: 6, eta: 0.85, edMax: 150000, etaR: 0.75, vmax: 100 / 3.6,
    model: 'multimass', consist: CONSISTS.freight, coupler: { k: 6e6, c: 1.2e5, slack: 0.02 }, epBrake: false, vProp: 280, kTunnel: 1.6,
  },
};

/** Initial conditions of the interface: ETCS, day, clear weather, adhesion from the weather */
export const DEFAULT_SCENARIO: Scenario = { sig: 'ETCS', tod: 'day', met: 'clear', adh: 'auto' };

/** Adhesion coefficient by rail condition */
export const ADHESION: Record<'dry' | 'wet' | 'leaves', number> = { dry: 0.3, wet: 0.2, leaves: 0.09 };

/** Deep copy for data-only objects (configurations, lines, trains) */
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
