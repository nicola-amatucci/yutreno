/**
 * The path of the line in the 3D view (phase 8, R3): the point and the frame of the line at a chainage, the placing
 * of an object beside it, the second track of the stations, and the compiled line of the network the view draws.
 */
import * as THREE from 'three';
import { altOf, xyOf } from '../core';
import type { CompiledLine } from '../core';
import { app } from './state';
import { UP, v3 } from './view3d-state';

/** Half length (m) of the two-track area of a station and lateral distance of the second track */
export const ST_HALF = 450,
  TRACK2 = 4.5;
/** Lateral position of the second track at s: 0 on single track, TRACK2 in a station, with the turnouts at the ends */
export const track2At = (s: number) => {
  let d = 0;
  for (const st of v3.L.st) {
    const x = Math.abs(s - st.s);
    if (x < ST_HALF) d = Math.max(d, TRACK2 * (1 - sstep(ST_HALF - 90, ST_HALF, x)));
  }
  return d;
};

// ---------- path ----------
export function P(s: number, out = new THREE.Vector3()): THREE.Vector3 {
  const [x, y] = xyOf(v3.L, s);
  return out.set(x, altOf(v3.L, s) - v3.A0, -y);
}
export function frame(s: number) {
  const a = P(s - 2),
    b = P(s + 2);
  const f = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  return { p: P(s), f, r };
}
export const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Object oriented along the track: x to the right, y up, z in the running direction */
export function placeAt(o: THREE.Object3D, s: number, d: number, h: number) {
  const { p, f, r } = frame(s);
  o.position.set(p.x + r.x * d, p.y + h, p.z + r.z * d);
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, UP, f.clone().negate()));
  return o;
}

/** Compiled line j of the network, in its own chainages (the main line is the line of the run) */
export function lineOf(j: number): CompiledLine {
  return j === 0 ? app.sim.L : (app.sim.net.lines[j]?.L ?? app.sim.L);
}
