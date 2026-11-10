/**
 * Checks the line model: lengths of the built-in lines, profile, contiguous limits, signals ordered and consistent
 * with the stations.
 *   npx tsx scripts/verify-line.ts
 */
import assert from 'node:assert/strict';
import { LINE_PRESETS, altOf, clone, compileLine, gradeOf, limitOf } from '../src/core';

const EXPECTED_LEN: Record<string, number> = { 'valle-lauro': 15300, appennino: 18500, 'rocca-sabato': 9600, 'ponte-pietrarsa': 9616 };

for (const [id, def] of Object.entries(LINE_PRESETS)) {
  const L = compileLine(clone(def));
  assert.ok(Math.abs(L.len - EXPECTED_LEN[id]) < EXPECTED_LEN[id] * 0.01, `${id}: length ${L.len.toFixed(0)} m out of tolerance`);
  assert.ok(L.st.length >= 2, `${id}: at least two stations are needed`);
  for (let i = 1; i < L.sig.length; i++) assert.ok(L.sig[i].s > L.sig[i - 1].s, `${id}: signals not ordered`);
  for (let i = 1; i < L.lim.length; i++) assert.equal(L.lim[i][0], L.lim[i - 1][1], `${id}: limits not contiguous`);
  assert.equal(L.lim[L.lim.length - 1][1], 1e9);
  // every intermediate station has its starting signal 250 m after the stop marker
  L.st.slice(0, -1).forEach((st, i) => assert.ok(L.sig.some(sg => sg.st === i && Math.abs(sg.s - st.s - 250) < 1e-6), `${id}: starting signal of ${st.name} missing`));
  // the altitude at the ends matches the profile and the gradient is the derivative of the altitude
  assert.equal(altOf(L, 0), def.profile[0][1]);
  for (let s = 100; s < L.len - 100; s += 997) {
    const num = (altOf(L, s + 1) - altOf(L, s - 1)) / 2 * 1000;
    assert.ok(Math.abs(num - gradeOf(L, s)) < 1e-6 || L.prof.some(p => Math.abs(p.b - s) < 2), `${id}: inconsistent gradient at km ${(s / 1000).toFixed(2)}`);
  }
  assert.ok(limitOf(L, 0) > 0);
  console.log(`${id}: ${(L.len / 1000).toFixed(2)} km, ${L.st.length} stations, ${L.sig.length} signals, max gradient ${L.imax.toFixed(1)} ‰, min radius ${Math.round(L.rmin)} m`);
}

// a minimal hand-written line compiles and generates its signals
const L = compileLine({
  name: 'test', plan: [[0, 0], [5000, 0]], profile: [[0, 100]], stations: [{ name: 'A', s: 100, arr: null, dep: null }, { name: 'B', s: 4800, arr: 300, dep: null }],
  limits: [[0, 1e9, 100]], tunnels: [], block: 1000, freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 400 },
});
assert.equal(L.st[0].dep, 0, 'the first station departs at t = 0 if not given');
assert.ok(Math.abs(L.len - 5000) < 1);
assert.ok(L.sig.length >= 4);
console.log('minimal line: ok');
