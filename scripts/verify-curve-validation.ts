/**
 * Check of the curve validation tool (scripts/curve-validation.ts) against the closed-form formulas.
 * On level track, without odometry errors and with constant deceleration, the EBD curve towards the supervised location
 * lies v²/(2·A_brake_emergency) before it, the EBI adds v·(T_traction_cut_off + T_brake_emergency) and the SBD towards
 * the end of authority lies v²/(2·A_brake_service) before it. The curves must also be in the order EBD < EBI < SBI < W
 * < P < I (increasing distances from the target) and move away on a descent.
 * Requirements: see the @test tag below and docs/traceability/tests.csv.
 *   npx tsx scripts/verify-curve-validation.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { points } from './curve-validation';

// @test C1: EBD, EBI and SBD towards the EOA in closed form, curve order and gradient effect [S026-3.13.8.3.2-c, S026-3.13.8.4.1-c, S026-3.13.8.1.3-c, S026-3.13.1, S026-3.13.9.3.2.12-c, S026-3.13.4.3.2-c]
const cs = JSON.parse(readFileSync('validation/cases.json', 'utf8'));
const T = cs.train_data;
const rows = points({ ...cs, speed_kmh: [60, 100, 140], cases: cs.cases.filter((c: { id: string }) => ['EOA-level', 'EOA-down-10', 'V80-level'].includes(c.id)) });
const get = (id: string, v: number) => rows.find(r => r.case_id === id && r.v_kmh === v) as Record<string, string | number>;
for (const vk of [60, 100, 140]) {
  const v = vk / 3.6, r = get('EOA-level', vk), dp = 50;
  const ebd = v * v / (2 * T.A_brake_emergency) - dp, ebi = ebd + v * (T.T_traction_cut_off + T.T_brake_emergency), sbd = v * v / (2 * T.A_brake_service);
  assert.ok(Math.abs(Number(r.d_EBD_m) - ebd) < 0.05, `EBD at ${vk} km/h: ${r.d_EBD_m} instead of ${ebd.toFixed(2)}`);
  assert.ok(Math.abs(Number(r.d_EBI_m) - ebi) < 0.05, `EBI at ${vk} km/h: ${r.d_EBI_m} instead of ${ebi.toFixed(2)}`);
  assert.ok(Math.abs(Number(r.d_SBD_m) - sbd) < 0.05, `SBD at ${vk} km/h: ${r.d_SBD_m} instead of ${sbd.toFixed(2)}`);
  for (const id of ['EOA-level', 'V80-level']) {
    const q = get(id, vk);
    if (q.d_EBI_m === '') continue;
    const seq = ['EBD', 'EBI', 'SBI', 'W', 'P', 'I'].map(k => Number(q['d_' + k + '_m']));
    for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], `${id} at ${vk} km/h: curves out of order ${seq.join(' ')}`);
  }
  assert.ok(Number(get('EOA-down-10', vk).d_EBI_m) > Number(r.d_EBI_m), `on a descent the EBI moves away from the target at ${vk} km/h`);
  console.log(`${vk} km/h: EBD ${r.d_EBD_m} m, EBI ${r.d_EBI_m} m, SBD ${r.d_SBD_m} m before the end of authority, as in closed form`);
}
