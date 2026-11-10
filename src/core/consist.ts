/**
 * Train consist and elementary laws of the multi-mass model.
 *
 * The train is a chain of N vehicles, each with its own mass, connected by draw and buffer gear
 * modelled as a spring and damper with slack (a dead band). It generalises the two-mass «toy
 * train» model (Gîlcă and Borcoși 2019; Control Tutorials for MATLAB & Simulink), as in the
 * literature on longitudinal train dynamics (Cole, Spiryagin and others).
 */
import type { CouplerDef, TrainParams, VehicleDef } from './types';

/** Gravitational acceleration (m/s²) */
export const G0 = 9.81;

/** Adhesion according to Curtius and Kniffler (1943), with v in km/h: μ = 0.161 + 7.5 / (44 + v) */
export const curtiusKniffler = (vKmh: number): number => 0.161 + 7.5 / (44 + Math.max(0, vKmh));
const CK0 = curtiusKniffler(0);
/** Adhesion reduction factor with speed, 1 at standstill */
export const adhesionSpeedFactor = (v: number): number => curtiusKniffler(v * 3.6) / CK0;

/**
 * Curve resistance according to Röckl, in N/kN (per mille of the weight), with R in metres:
 * 650 / (R − 55) for R > 300 m, 500 / (R − 30) for smaller radii.
 */
export function rocklPermille(R: number): number {
  if (!isFinite(R) || R > 20000) return 0;
  if (R > 300) return 650 / (R - 55);
  return 500 / Math.max(R - 30, 20);
}

/**
 * Coupler force, positive in tension. e is the extension from the rest position (m), dv the
 * relative speed (m/s, positive when the vehicles move apart).
 */
export function couplerForce(e: number, dv: number, cp: CouplerDef): number {
  const h = cp.slack / 2;
  if (e > h) return Math.max(0, cp.k * (e - h) + cp.c * dv);
  if (e < -h) return Math.min(0, cp.k * (e + h) + cp.c * dv);
  return 0;
}

/** Coupler used when the train does not specify one: stiffness (N/m), damping (N·s/m), total slack (m) */
export const DEFAULT_COUPLER: CouplerDef = { k: 10e6, c: 2e5, slack: 0.002 };

/** Effective consist: the one given, or one derived from mass, length and motored share */
export function buildConsist(TR: TrainParams): VehicleDef[] {
  if (TR.consist && TR.consist.length) return TR.consist.map(v => ({ ...v }));
  const n = Math.max(1, Math.round(TR.L / 25));
  const nMot = Math.max(1, Math.min(n, Math.round(n * TR.adh)));
  return Array.from({ length: n }, (_, i) => ({ name: 'Veicolo ' + (i + 1), m: TR.m / n, L: TR.L / n, motored: i < nMot }));
}

export interface ConsistSummary { m: number; L: number; mMot: number; adh: number; n: number }
/** Total and motored mass, length and number of vehicles of a consist, for the editor and the model page */
export function consistSummary(c: VehicleDef[]): ConsistSummary {
  const m = c.reduce((a, v) => a + v.m, 0), L = c.reduce((a, v) => a + v.L, 0), mMot = c.filter(v => v.motored).reduce((a, v) => a + v.m, 0);
  return { m, L, mMot, adh: m > 0 ? mMot / m : 0, n: c.length };
}

/** Consists of the built-in trains */
export const CONSISTS = {
  regional: [
    { name: 'Motor car A', m: 42000, L: 27.5, motored: true },
    { name: 'Trailer car', m: 38000, L: 27.5, motored: false },
    { name: 'Trailer car', m: 38000, L: 27.5, motored: false },
    { name: 'Motor car B', m: 42000, L: 27.5, motored: true },
  ] as VehicleDef[],
  high_speed: [
    { name: 'Leading power car', m: 69000, L: 26, motored: true },
    ...Array.from({ length: 6 }, (_, i) => ({ name: 'Coach ' + (i + 1), m: 52000, L: 24.6667, motored: false })),
    { name: 'Trailing power car', m: 69000, L: 26, motored: true },
  ] as VehicleDef[],
  freight: [
    { name: 'Locomotive', m: 88000, L: 19, motored: true },
    ...Array.from({ length: 24 }, (_, i) => ({ name: 'Wagon ' + (i + 1), m: 50500, L: 22.125, motored: false })),
  ] as VehicleDef[],
};
