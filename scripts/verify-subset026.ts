/**
 * Requirement-level tests of the reference ETCS onboard (src/core/evc.ts) against Subset-026 and Subset-130.
 *
 * Each block exercises one or more rows of docs/traceability/matrix.csv on the onboard alone, driven cycle by cycle
 * with hand-built balise telegrams and radio messages, and compares what it does with what the clause requires, in
 * closed form where the clause gives a formula. Blocks are tagged with `// @test <id>: <title> [<requirement ids>]`;
 * scripts/traceability.ts collects the tags of all verify scripts into docs/traceability/tests.csv and checks that
 * every implemented or simplified row of the matrix has at least one test.
 *
 * These tests check the behaviour that YuTreno implements, with the simplifications declared in the matrix: they do
 * not show conformity to the specification, which only the Subset-076 test sequences on a certified product could.
 *   npx tsx scripts/verify-subset026.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_NATIONAL, LINE_PRESETS, ReferenceEvc, baliseTelegram, buildBaliseGroups, clone, compileLine,
  type EtcsPacket, type OnboardDmi, type OnboardNationalValues, type OnboardResponse, type OnboardTrainData, type RadioMessage,
} from '../src/core';

const G = 9.81, KMH = 1 / 3.6;
const TD: OnboardTrainData = {
  NID_ENGINE: 7, L_TRAIN: 150, V_MAXTRAIN: 160, A_brake_emergency: 1.3, A_brake_service: 1.0,
  T_brake_emergency: 1.6, T_brake_service: 1.2, T_traction_cut_off: 0.5, M_rotating: 6,
};
const NO_ODO_ERROR: Partial<OnboardNationalValues> = { odo_error_fixed_m: 0, odo_error_relative: 0 };
const LRBG = 16384 + 1;
const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} instead of ${b} (tolerance ${tol})`);
let count = 0;
const ok = (id: string, what: string) => { count++; console.log(`${id.padEnd(5)} ${what}: ok`); };

/** An onboard driven cycle by cycle: odometer, speed, balises and radio messages chosen by the test */
class Bench {
  evc = new ReferenceEvc();
  t = 0;
  last!: OnboardResponse;
  sent: RadioMessage[] = [];
  constructor(opt: { train?: Partial<OnboardTrainData>; nv?: Partial<OnboardNationalValues>; stored?: boolean; odo?: number } = {}) {
    this.last = this.evc.step({
      type: 'onboard', version: 2, start: true, t: 0, dt: 0.1, odometry: { distance_m: opt.odo ?? 0, speed_ms: 0, acceleration_ms2: 0 },
      balises: [], radio: [], train: { doors_open: false, emergency_applied: false, traction: 0, brake: 0 },
      train_data: { ...TD, ...opt.train }, national_values: { ...DEFAULT_NATIONAL, ...NO_ODO_ERROR, ...opt.nv } as OnboardNationalValues,
      ...(opt.stored === false ? {} : { stored_position: { NID_LRBG: LRBG, D_LRBG: opt.odo ?? 0 } }),
    });
    this.sent.push(...(this.last.radio ?? []));
  }
  cycle(x: number, v: number, extra: { radio?: RadioMessage[]; balises?: { odometer_m: number; telegram: ReturnType<typeof baliseTelegram> }[]; a?: number; dt?: number } = {}): OnboardResponse {
    this.t = +(this.t + (extra.dt ?? 0.1)).toFixed(6);
    this.last = this.evc.step({
      type: 'onboard', version: 2, start: false, t: this.t, dt: extra.dt ?? 0.1, odometry: { distance_m: x, speed_ms: v, acceleration_ms2: extra.a ?? 0 },
      balises: extra.balises ?? [], radio: extra.radio ?? [], train: { doors_open: false, emergency_applied: false, traction: 0, brake: 0 },
    });
    this.sent.push(...(this.last.radio ?? []));
    return this.last;
  }
  get dmi(): OnboardDmi { return this.last.dmi; }
}

/** Message 3 referred to LRBG: authority up to eoa (m from the LRBG) with optional danger point, static profile, gradients, TSRs */
function m3(o: { eoa: number; dp?: number | null; vrel?: number; sections?: number[]; ssp?: [number, number][]; grad?: [number, number][]; tsr?: { id: number; d: number; l: number; v: number }[]; revoke?: number[]; linking?: boolean; lrbg?: number }): RadioMessage {
  const secs = o.sections ?? [];
  const p15: EtcsPacket = {
    NID_PACKET: 15, Q_DIR: 1, Q_SCALE: 1, V_LOA: 0, T_LOA: 1023, N_ITER: secs.length, sections: secs.map(L => ({ L_SECTION: L, Q_SECTIONTIMER: 0 })),
    L_ENDSECTION: o.eoa - secs.reduce((a, b) => a + b, 0), Q_SECTIONTIMER: 0, Q_ENDTIMER: 0,
    Q_DANGERPOINT: o.dp == null ? 0 : 1, D_DP: o.dp ?? 0, V_RELEASEDP: o.dp == null ? 0 : (o.vrel ?? 2), Q_OVERLAP: 0,
  };
  // static profile: [distance of the change from the previous one, km/h], closed by V_STATIC = 127
  const ssp = o.ssp ?? [[0, 160]];
  const sspEl = ssp.map(([d, v]) => ({ D_STATIC: d, V_STATIC: Math.floor(v / 5), Q_FRONT: 0 }));
  sspEl.push({ D_STATIC: o.eoa + 2000 - ssp.reduce((a, s) => a + s[0], 0), V_STATIC: 127, Q_FRONT: 0 });
  const grad = o.grad ?? [[0, 0]];
  const gEl = grad.map(([d, g]) => ({ D_GRADIENT: d, Q_GDIR: g >= 0 ? 1 : 0, G_A: Math.abs(g) }));
  gEl.push({ D_GRADIENT: o.eoa + 2000 - grad.reduce((a, s) => a + s[0], 0), Q_GDIR: 0, G_A: 255 });
  const packets: EtcsPacket[] = [
    p15,
    { NID_PACKET: 27, Q_DIR: 1, Q_SCALE: 1, ...sspEl[0], N_ITER: sspEl.length - 1, elements: sspEl.slice(1) },
    { NID_PACKET: 21, Q_DIR: 1, Q_SCALE: 1, ...gEl[0], N_ITER: gEl.length - 1, elements: gEl.slice(1) },
  ];
  for (const t of o.tsr ?? []) packets.push({ NID_PACKET: 65, Q_DIR: 1, Q_SCALE: 1, NID_TSR: t.id, D_TSR: t.d, L_TSR: t.l, Q_FRONT: 0, V_TSR: Math.floor(t.v / 5) });
  for (const id of o.revoke ?? []) packets.push({ NID_PACKET: 66, Q_DIR: 1, NID_TSR: id });
  if (o.linking) packets.push({ NID_PACKET: 5, Q_DIR: 1, Q_SCALE: 1, D_LINK: 1000, Q_NEWCOUNTRY: 0, NID_BG: 2, Q_LINKORIENTATION: 1, Q_LINKREACTION: 2, Q_LOCACC: 12, N_ITER: 0 });
  return { NID_MESSAGE: 3, T_TRAIN: 0, NID_LRBG: o.lrbg ?? LRBG, packets };
}

/** Closed-form helpers on level track with the train data TD */
const Tbe = TD.T_traction_cut_off + TD.T_brake_emergency;
const k = G / (1000 + 10 * TD.M_rotating);
/** Speed of the EBD towards (xt, 0) at distance d with deceleration A, reaction time T: v·T + v²/(2A) = d */
const vReach = (d: number, A: number, T: number) => -A * T + Math.sqrt(A * A * T * T + 2 * A * Math.max(0, d));
/** Margin of the ceiling supervision (m/s) as in Subset-026 §3.13.9.2.3 with the default national values */
const marginKmh = (vKmh: number, dmin: number, dmax: number, vmin: number, vmax: number) => vKmh <= vmin ? dmin : vKmh >= vmax ? dmax : dmin + (dmax - dmin) * (vKmh - vmin) / (vmax - vmin);

// ---------------------------------------------------------------------------------------------
// @test S1: balise groups and telegrams from the trackside [S026-3.4.1, S026-3.4.3, S026-8.4.2]
{
  for (const id of Object.keys(LINE_PRESETS)) {
    const bgs = buildBaliseGroups(compileLine(clone(LINE_PRESETS[id])));
    const nids = new Set(bgs.map(b => b.NID_BG));
    assert.equal(nids.size, bgs.length, `${id}: NID_BG unique in the line`);
    for (const bg of bgs) {
      const t0 = baliseTelegram(bg, 0), t1 = baliseTelegram(bg, 1);
      assert.equal(t0.N_PIG, 0); assert.equal(t1.N_PIG, 1);
      assert.equal(t0.NID_BG, bg.NID_BG); assert.equal(t0.M_VERSION, 33, 'M_VERSION of system version 2.x (Subset-026 §7.5)');
      assert.equal(t0.packets[t0.packets.length - 1].NID_PACKET, 255, 'every telegram ends with packet 255 (§8.4.2)');
    }
  }
  ok('S1', 'balise groups with unique identities, telegrams with N_PIG and closing packet 255');
}

// @test S2: location referred to the first balise of the group [S026-3.4.2, S026-3.6.1, S026-3.6.2]
{
  const b = new Bench({ stored: false });
  assert.equal(b.last.position, undefined, 'without balises and stored position the onboard has no location');
  const bg = { NID_BG: 9, s: 1000 } as never;
  b.cycle(1003, 10, { balises: [{ odometer_m: 1003, telegram: baliseTelegram(bg, 1) }] });
  assert.equal(b.last.position, undefined, 'the second balise of the group alone does not give the reference');
  b.cycle(1100, 10, { balises: [{ odometer_m: 1000, telegram: baliseTelegram(bg, 0) }] });
  assert.equal(b.last.position!.NID_LRBG, 16384 + 9);
  near(b.last.position!.D_LRBG, 100, 1e-9, 'D_LRBG measured from the balise with N_PIG = 0');
  ok('S2', 'LRBG from the balise with N_PIG = 0, distances from it');
}

// @test S3: confidence interval of the train position [S026-3.6.4]
{
  const b = new Bench({ nv: { odo_error_fixed_m: 5, odo_error_relative: 0.02 } });
  b.cycle(1000, 20);
  near(b.last.position!.L_DOUBTOVER, 5 + 0.02 * 1000, 1e-9, 'over-reading = fixed part + relative part of the distance from the LRBG');
  near(b.last.position!.L_DOUBTUNDER, 25, 1e-9, 'under-reading');
  ok('S3', 'location uncertainty grows with the distance from the LRBG');
}

// @test S4: position report, message 136 with packet 0 [S026-3.6.5, S026-8.6.4, S026-7.4.3, S026-8.5.2, S026-8.6, S026-3.5.2, S026-8.5.1, S026-8.5]
{
  const b = new Bench();
  const first = b.sent.find(m => m.NID_MESSAGE === 136);
  assert.ok(first, 'a position report is sent at start of mission');
  const p0 = first!.packets![0];
  assert.equal(p0.NID_PACKET, 0); assert.equal(p0.NID_LRBG, LRBG); assert.equal(first!.NID_ENGINE, TD.NID_ENGINE);
  assert.equal(p0.M_MODE, 6, 'M_MODE 6 = stand by'); assert.equal(p0.L_TRAININT, TD.L_TRAIN);
  b.sent.length = 0;
  for (let i = 1; i <= 70; i++) b.cycle(i * 2, 72 / 3.6);
  const reps = b.sent.filter(m => m.NID_MESSAGE === 136);
  assert.ok(reps.length >= 1 && reps.length <= 2, `periodic report every 6 s (${reps.length} in 7 s)`);
  assert.equal(reps[0].packets![0].V_TRAIN, Math.floor(72 / 5), 'V_TRAIN in 5 km/h steps');
  b.sent.length = 0;
  b.cycle(150, 20, { radio: [m3({ eoa: 3000, dp: 50 })] });
  b.cycle(152, 20);
  const afterMode = b.sent.filter(m => m.NID_MESSAGE === 136);
  assert.ok(afterMode.some(m => m.packets![0].M_MODE === 0), 'report at the change of mode, with M_MODE 0 = full supervision');
  ok('S4', 'message 136 at start, periodically and on mode change, with LRBG, distance, speed and mode');
}

// @test S5: movement authority from message 3 and packet 15, stand by to full supervision [S026-3.8.1, S026-3.8.3, S026-3.8.4, S026-8.7.2, S026-8.7, S026-8.5.3, S026-7.4.2, S026-7.3.1, S026-7.3.2, S026-7.3.3, S026-7.4.1, S026-7.5, S026-8.4.4, S026-4.3.2, S026-4.4.7, S026-4.4.9, S026-4.4.2]
{
  const b = new Bench();
  assert.equal(b.dmi.mode, 'SB');
  assert.ok(b.last.outputs.traction_cut_off, 'in stand by traction is cut off');
  b.cycle(0, 0, { radio: [m3({ eoa: 2000, dp: 80, vrel: 4, sections: [500, 700] })] });
  assert.equal(b.dmi.mode, 'FS', 'a valid MA in level 2 brings the onboard to full supervision');
  b.cycle(100, 10);
  const ato = b.dmi.ato!;
  near(ato.N_LOC_EOALOA!, 2000, 1e-9, 'EOA = sum of the sections + L_ENDSECTION from the LRBG');
  near(ato.N_LOC_SVL!, 2080, 1e-9, 'SvL = EOA + D_DP');
  near(b.dmi.v_release_ms!, 20 * KMH, 1e-9, 'release speed V_RELEASEDP × 5 km/h');
  assert.equal(b.last.outputs.traction_cut_off, false);
  ok('S5', 'message 3 gives EOA, SvL and release speed; SB → FS');
}

// @test S6: data referred to an unknown balise group are rejected [S026-3.7.1, S026-3.7.2, S026-3.6.3, S026-3.7]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 2000, dp: 50, lrbg: 16384 + 77 })] });
  assert.equal(b.dmi.mode, 'SB', 'a MA referred to a balise group the onboard has not passed is not used');
  ok('S6', 'message referred to an unknown LRBG discarded');
}

// @test S7: MA update replaces the previous one, extension and shortening [S026-3.8.5, S026-3.7.3]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 2000, dp: 50 })] });
  b.cycle(10, 5, { radio: [m3({ eoa: 4000, dp: 50 })] });
  near(b.dmi.ato!.N_LOC_EOALOA!, 4000, 1e-9, 'extension');
  b.cycle(20, 5, { radio: [m3({ eoa: 1500, dp: 50 })] });
  near(b.dmi.ato!.N_LOC_EOALOA!, 1500, 1e-9, 'shortening');
  ok('S7', 'a new message 3 replaces end of authority, profile and gradients');
}

// @test S8: static speed profile from packet 27 [S026-3.11.2, S026-3.11.3, S026-3.11.1, S026-3.13.2.3.2-c, S026-3.13.7]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50, ssp: [[0, 120], [3000, 80]] })] });
  b.cycle(1000, 20);
  near(b.dmi.v_mrsp_ms, 120 * KMH, 1e-9, 'MRSP at the head from the first SSP element (V_STATIC × 5 km/h)');
  b.cycle(3500, 20);
  near(b.dmi.v_mrsp_ms, 80 * KMH, 1e-9, 'MRSP after the change');
  ok('S8', 'SSP decoded from packet 27 and used as ceiling');
}

// @test S9: temporary speed restriction (packet 65) and its revocation (packet 66) [S026-3.11.5]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50, tsr: [{ id: 3, d: 1000, l: 500, v: 40 }] })] });
  b.cycle(1200, 8);
  near(b.dmi.v_mrsp_ms, 40 * KMH, 1e-9, 'TSR lowers the MRSP inside its stretch');
  b.cycle(1210, 8, { radio: [m3({ eoa: 6000, dp: 50, revoke: [3] })] });
  near(b.dmi.v_mrsp_ms, 160 * KMH, 1e-9, 'revoked TSR no longer restricts');
  ok('S9', 'TSR applied and revoked by NID_TSR');
}

// @test S10: train-related speed restriction and maximum train speed [S026-3.11.8, S026-3.13.2.2.13-c]
{
  const b = new Bench({ train: { V_MAXTRAIN: 100 } });
  b.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50, ssp: [[0, 160]] })] });
  b.cycle(500, 20);
  near(b.dmi.v_mrsp_ms, 100 * KMH, 1e-9, 'MRSP limited by V_MAXTRAIN');
  ok('S10', 'MRSP never above V_MAXTRAIN');
}

// @test S11: the MRSP holds until the tail clears the restriction [S026-3.13.7.2-c, S026-3.13.2.2.11-c, S026-3.13.8.2.3-c]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50, ssp: [[0, 60], [2000, 140]] })] });
  b.cycle(2050, 15);
  near(b.dmi.v_mrsp_ms, 60 * KMH, 1e-9, 'head past the increase, tail still in the 60 km/h stretch');
  b.cycle(2000 + TD.L_TRAIN + 1, 15);
  near(b.dmi.v_mrsp_ms, 140 * KMH, 1e-9, 'tail beyond the end of the restriction');
  const b2 = new Bench();
  b2.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50, ssp: [[0, 140], [2000, 60]] })] });
  b2.cycle(1800, 20);
  assert.match(b2.dmi.target?.type ?? '', /limit 60/, 'the reduction ahead is a target');
  b2.cycle(2001, 15);
  assert.ok(!/limit 60/.test(b2.dmi.target?.type ?? ''), 'once the head passes it the MRSP target is removed');
  ok('S11', 'train length in the MRSP and removal of the passed MRSP target');
}

// @test S12: ceiling supervision margins dV_ebi, dV_sbi, dV_warning [S026-3.13.9.2.3-c, S026-3.13.2.3.7-c, S026-3.18.2, S026-3.18.1]
{
  for (const vmax of [80, 160, 250]) {
    const b = new Bench({ train: { V_MAXTRAIN: vmax } });
    b.cycle(0, 0, { radio: [m3({ eoa: 20000, dp: 50, ssp: [[0, vmax]] })] });
    b.cycle(100, 5);
    const N = DEFAULT_NATIONAL;
    near((b.dmi.v_intervention_ms - b.dmi.v_mrsp_ms) * 3.6, marginKmh(vmax, N.dV_ebi_min, N.dV_ebi_max, N.V_ebi_min, N.V_ebi_max), 1e-6, `dV_ebi at ${vmax} km/h`);
    near((b.dmi.v_sbi_ms - b.dmi.v_mrsp_ms) * 3.6, marginKmh(vmax, N.dV_sbi_min, N.dV_sbi_max, N.V_sbi_min, N.V_sbi_max), 1e-6, `dV_sbi at ${vmax} km/h`);
    near((b.dmi.v_warning_ms - b.dmi.v_mrsp_ms) * 3.6, marginKmh(vmax, N.dV_warning_min, N.dV_warning_max, N.V_warning_min, N.V_warning_max), 1e-6, `dV_warning at ${vmax} km/h`);
  }
  // national values from the trackside replace the defaults
  const b = new Bench({ nv: { dV_ebi_min: 10 } });
  b.cycle(0, 0, { radio: [m3({ eoa: 20000, dp: 50, ssp: [[0, 100]] })] });
  b.cycle(100, 5);
  near((b.dmi.v_intervention_ms - b.dmi.v_mrsp_ms) * 3.6, 10, 1e-6, 'dV_ebi_min from the national values');
  ok('S12', 'ceiling margins interpolated between the national values, default values when not given');
}

// @test S13: ceiling supervision states and commands [S026-3.13.10.3.3-c, S026-3.13.10.2.2-c, S026-3.13.10, S026-3.14.1, S026-3.13.2.2.7-c, S026-3.13.2.2.8-c, S026-3.14]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 20000, dp: 50, ssp: [[0, 100]] })] });
  const P = 100 * KMH, d = b;
  d.cycle(500, P - 0.5); assert.equal(d.dmi.state, 'NOR');
  d.cycle(510, P + 0.5); assert.equal(d.dmi.state, 'OVS', 'above permitted, below warning');
  d.cycle(520, P + 4.2 * KMH); assert.equal(d.dmi.state, 'WAR', 'above warning');
  d.cycle(530, P + 5.7 * KMH); assert.equal(d.dmi.state, 'SBI'); assert.ok(d.last.outputs.service_brake && d.last.outputs.traction_cut_off, 'service brake and traction cut-off commanded');
  d.cycle(540, P + 1 * KMH); assert.ok(d.last.outputs.service_brake, 'service brake held until the speed is back to the permitted one');
  d.cycle(550, P - 0.1); assert.equal(d.last.outputs.service_brake, false, 'service brake released at the permitted speed');
  d.cycle(560, P + 8 * KMH); assert.equal(d.dmi.state, 'INT'); assert.ok(d.last.outputs.emergency, 'emergency brake above the EBI');
  d.cycle(570, P - 5); assert.ok(d.last.outputs.emergency, 'emergency brake held while moving');
  d.cycle(571, 0); assert.equal(d.last.outputs.emergency, false, 'released at standstill');
  ok('S13', 'NOR, OVS, WAR, SBI, INT with commands held until their revocation condition');
}

// @test S14: gradients from packet 21, default outside the profile, rotating mass correction [S026-3.11.12, S026-3.13.2.3.3-c, S026-3.13.4.1.3-c, S026-3.13.4.3.2-c, S026-3.13.2.2.10-c, S026-3.13.6.2.1.3-c, S026-3.13.6, S026-3.11]
{
  for (const g of [0, -10, -25, 15]) {
    const b = new Bench();
    b.cycle(0, 0, { radio: [m3({ eoa: 8000, dp: 50, grad: [[0, g]] })] });
    const xt = 8050, v = 120 * KMH;
    const x = b.evc.brakingCurvePoint('EBD', xt, 0, v);
    const A = TD.A_brake_emergency + k * g;
    near(xt - x, v * v / (2 * A), 0.01, `EBD on ${g} ‰ with A_safe = A_brake_safe + g·grad/(1000 + 10·M_rotating)`);
  }
  // beyond the end of the received profile the gradient is taken as zero
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 8000, dp: 50, grad: [[0, -20], [4000, 0]] })] });
  const v = 80 * KMH, x = b.evc.brakingCurvePoint('EBD', 3000, 0, v);
  near(3000 - x, v * v / (2 * (TD.A_brake_emergency - k * 20)), 0.01, 'piecewise gradient applied where the curve lies');
  ok('S14', 'gradient correction of the deceleration with the rotating mass, piecewise along the profile');
}

// @test S15: deceleration values of the train data in the EBD and SBD [S026-3.13.2.2.3.1-c, S026-3.13.6.2.1.4-c, S026-3.13.6.3.1.3-c, S026-3.13.2, S026-3.18.3, S026-3.18]
{
  const b = new Bench({ train: { A_brake_emergency: 0.9, A_brake_service: 0.6 } });
  b.cycle(0, 0, { radio: [m3({ eoa: 8000, dp: 50, grad: [[0, -10]] })] });
  const v = 100 * KMH;
  near(8050 - b.evc.brakingCurvePoint('EBD', 8050, 0, v), v * v / (2 * (0.9 - 10 * k)), 0.01, 'EBD with A_brake_emergency of the mission');
  near(8000 - b.evc.brakingCurvePoint('SBD', 8000, 0, v), v * v / (2 * (0.6 - 10 * k)), 0.01, 'SBD with A_expected = A_brake_service + A_gradient');
  assert.throws(() => new ReferenceEvc().step({ type: 'onboard', version: 2, start: true, t: 0, dt: 0.1, odometry: { distance_m: 0, speed_ms: 0, acceleration_ms2: 0 }, balises: [], radio: [], train: { doors_open: false, emergency_applied: false, traction: 0, brake: 0 } }), /train_data/, 'train data are required at start of mission');
  ok('S15', 'EBD and SBD use the decelerations of the train data');
}

// @test S16: EBI position before the EBD by the reaction time, N_LOC_EBI [S026-3.13.9.3.2.12-c, S026-3.13.6.2.2.3-c, S026-3.13.2.2.3.2-c, S026-3.13.8.3.2-c, S026-3.13.8, S026-3.13.9, S130-Packet-6-N_LOC_EBI]
{
  for (const Te of [1.6, 2.6]) {
    const b = new Bench({ train: { T_brake_emergency: Te } });
    b.cycle(0, 0, { radio: [m3({ eoa: 8000, dp: 50 })] });
    const v = 120 * KMH;
    b.cycle(1000, v);
    const expect = 8050 - v * v / (2 * TD.A_brake_emergency) - v * (TD.T_traction_cut_off + Te);
    near(b.dmi.ato!.N_LOC_EBI!, expect, 0.01, `N_LOC_EBI with T_be = T_traction_cut_off + T_brake_emergency = ${TD.T_traction_cut_off + Te} s`);
  }
  ok('S16', 'EBI = EBD(v) − v·T_be, shifted by the brake build-up time of the train data');
}

// @test S17: SBI1 from the SBD towards the EOA and SBI2 from the EBD [S026-3.13.9.3.3.1-c, S026-3.13.9.3.3.3-c, S026-3.13.6.3.2.4-c, S026-3.13.8.4.1-c]
{
  for (const Ts of [1.2, 3]) {
    const b = new Bench({ train: { T_brake_service: Ts } });
    b.cycle(0, 0, { radio: [m3({ eoa: 8000, dp: 50 })] });
    b.cycle(7700, 10);
    const d = 300;
    const sbi1 = vReach(d, TD.A_brake_service, Ts), sbi2 = vReach(d + 50, TD.A_brake_emergency, Tbe + Ts);
    near(b.dmi.v_sbi_ms, Math.min(sbi1, sbi2), 0.02, `SBI speed with T_bs = ${Ts} s`);
  }
  ok('S17', 'SBI speed = min(SBI1 on the SBD, SBI2 on the EBD), with the service brake times of the train data');
}

// @test S18: EBD towards a speed reduction crosses the target at V_target + dV_ebi [S026-3.13.8.3.1-c, S026-3.13.8.2.1-c, S026-3.13.10.4-c, S026-3.13.8.1.3-c]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 9000, dp: 50, ssp: [[0, 160], [5000, 80]] })] });
  b.cycle(4999, 5);
  const dE = marginKmh(80, 7.5, 15, 110, 210);
  assert.ok(b.dmi.v_intervention_ms >= (80 + dE) * KMH - 1e-6 && b.dmi.v_intervention_ms < (80 + dE) * KMH + 0.3, `EBI just before the reduction ≈ ${80 + dE} km/h (got ${(b.dmi.v_intervention_ms * 3.6).toFixed(2)})`);
  // the target shown is the most restrictive of MRSP reduction and EOA
  const b1 = new Bench();
  b1.cycle(0, 0, { radio: [m3({ eoa: 9000, dp: 50, ssp: [[0, 160], [5000, 80]] })] });
  b1.cycle(4700, 30);
  assert.match(b1.dmi.target!.type, /limit 80/);
  const b2 = new Bench();
  b2.cycle(0, 0, { radio: [m3({ eoa: 3500, dp: 50, ssp: [[0, 160], [5000, 80]] })] });
  b2.cycle(3000, 30);
  assert.equal(b2.dmi.target!.type, 'end of authority');
  // indication before the permitted curve, target supervision states
  b2.cycle(3300, 25);
  assert.ok(['IND', 'OVS', 'WAR', 'SBI', 'INT'].includes(b2.dmi.state), `target supervision state ${b2.dmi.state}`);
  ok('S18', 'targets MRSP and EOA, EBD towards V_target + dV_ebi, target supervision states');
}

// @test S19: release speed from the trackside and its supervision near the EOA [S026-3.13.9.4.3-c, S026-3.13.9.4.6-c]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 2000, dp: 50, vrel: 3 })] });
  b.cycle(1995, 1);
  near(b.dmi.v_permitted_ms, 15 * KMH, 1e-6, 'close to the EOA the permitted speed is the release speed');
  assert.ok(b.dmi.v_intervention_ms >= 15 * KMH - 1e-9, 'no curve below the release speed');
  b.cycle(1999, 15 * KMH - 0.1);
  assert.equal(b.last.outputs.emergency || b.last.outputs.service_brake, false, 'running at the release speed up to the EOA is allowed');
  ok('S19', 'release speed V_RELEASEDP supervised as a floor of the curves');
}

// @test S20: trip when passing the EOA, post trip and new MA [S026-3.13.10.2.6-c, S026-4.4.13, S026-4.4.14, S026-5.11, S026-4.4]
{
  const b = new Bench({ nv: { odo_error_fixed_m: 3, odo_error_relative: 0 } });
  b.cycle(0, 0, { radio: [m3({ eoa: 2000, dp: 50, vrel: 2 })] });
  b.cycle(2002, 2); assert.equal(b.dmi.mode, 'FS', 'min safe front (2002 − 3 m) not yet beyond the EOA');
  b.cycle(2004, 2);
  assert.equal(b.dmi.mode, 'TR'); assert.ok(b.last.outputs.emergency); assert.equal(b.last.emergency_reason, 'trip');
  b.cycle(2005, 0);
  assert.equal(b.dmi.mode, 'PT', 'at standstill trip becomes post trip'); assert.equal(b.last.outputs.emergency, false);
  assert.ok(b.last.outputs.traction_cut_off, 'traction cut off in post trip');
  b.cycle(2005, 0, { radio: [m3({ eoa: 5000, dp: 50 })] });
  assert.equal(b.dmi.mode, 'FS', 'a new MA at standstill restores full supervision');
  ok('S20', 'TR at the EOA with the min safe front, PT at standstill, FS with a new MA');
}

// @test S21: unconditional emergency stop, message 16 [S026-3.10.2, S026-3.10.1, S026-8.7.7, S026-3.10]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50 })] });
  b.cycle(500, 20, { radio: [{ NID_MESSAGE: 16, T_TRAIN: 0, NID_LRBG: LRBG, NID_EM: 1 } as RadioMessage] });
  assert.equal(b.dmi.mode, 'TR'); assert.ok(b.last.outputs.emergency); assert.equal(b.last.emergency_reason, 'emergency_stop');
  ok('S21', 'message 16 trips the train with emergency brake');
}

// @test S22: loss of radio contact, T_NVCONTACT and M_NVCONTACT [S026-3.16.3, S026-3.5.4, S026-3.5.1, S026-3.16, S026-3.5]
{
  for (const M of [1, 0]) {
    const b = new Bench({ nv: { T_NVCONTACT: 10, M_NVCONTACT: M } });
    b.cycle(0, 0, { radio: [m3({ eoa: 20000, dp: 50 })] });
    for (let i = 0; i < 95; i++) b.cycle(100 + i, 10);
    assert.equal(b.last.outputs.service_brake || b.last.outputs.emergency, false, 'within T_NVCONTACT nothing happens');
    for (let i = 0; i < 10; i++) b.cycle(200 + i, 10);
    if (M === 1) { assert.ok(b.last.outputs.service_brake, 'M_NVCONTACT = 1: service brake'); assert.match(b.dmi.text ?? '', /RBC/); }
    else { assert.equal(b.dmi.mode, 'TR'); assert.equal(b.last.emergency_reason, 'radio_contact'); }
    if (M === 1) { b.cycle(220, 10, { radio: [m3({ eoa: 20000, dp: 50 })] }); b.cycle(221, 10); assert.equal(b.dmi.text, undefined, 'a new message restores the contact'); }
  }
  ok('S22', 'reaction to the loss of radio contact according to M_NVCONTACT');
}

// @test S23: linking information (packet 5) received and not used [S026-3.4.4, S026-3.4]
{
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 3000, dp: 50, linking: true })] });
  assert.equal(b.dmi.mode, 'FS', 'packet 5 does not prevent the use of the message');
  ok('S23', 'linking packet accepted; the onboard does not supervise linking (declared simplification)');
}

// @test S24: Subset-130 data for ATO in full supervision [S130-Packet-6-M_MODE, S130-Packet-6-V_EST-A_EST, S130-Packet-6-V_PERMITTED, S130-Packet-6-V_MRSP-and-iterations-N_LOC_MRSP, S130-Packet-6-N_LOC_EOALOA-V_EOALOA-N_LOC_SVL, S130-Packet-6-V_RELEASE_ATO, S130-Packet-6-A_GRADIENT-and-iterations, S130-Packet-6-L_UNCERTAINTY_OVERREADING-UNDERREADING, S130-Packet-6-T_TRACTION-T_BE_REACT, S130-Packet-11-A_BRAKE_SAFE, S026-3.15.11]
{
  const b = new Bench({ nv: { odo_error_fixed_m: 2, odo_error_relative: 0.01 } });
  assert.equal(b.dmi.ato ?? null, null, 'no ATO data outside FS');
  b.cycle(0, 0, { radio: [m3({ eoa: 6000, dp: 50, vrel: 3, ssp: [[0, 140], [3000, 90]], grad: [[0, 5], [2000, -8]] })] });
  b.cycle(1000, 25, { a: 0.3 });
  const a = b.dmi.ato!, doubt = 2 + 0.01 * 1000;
  assert.equal(a.M_MODE, 'FS'); assert.equal(a.V_EST, 25); assert.equal(a.A_EST, 0.3);
  near(a.V_PERMITTED, b.dmi.v_permitted_ms, 1e-12, 'V_PERMITTED as on the DMI'); near(a.V_MRSP, 140 * KMH, 1e-9, 'V_MRSP');
  assert.deepEqual(a.MRSP.map(([x, v]) => [Math.round(x), Math.round(v * 3.6)]), [[Math.round(3000 - doubt), 90]], 'N_LOC_MRSP: the reduction seen by the front with over-reading');
  assert.equal(a.N_LOC_EOALOA, 6000); assert.equal(a.V_EOALOA, 0); assert.equal(a.N_LOC_SVL, 6050); near(a.V_RELEASE_ATO!, 15 * KMH, 1e-9, 'V_RELEASE_ATO');
  assert.deepEqual(a.GRADIENT.map(([x, g]) => [x, +g.toFixed(6)]), [[1000, +(5 * k).toFixed(6)], [2000, +(-8 * k).toFixed(6)]], 'A_GRADIENT in m/s² from the current position');
  assert.equal(a.L_UNCERTAINTY_OVERREADING, doubt); assert.equal(a.L_UNCERTAINTY_UNDERREADING, doubt);
  assert.equal(a.T_TRACTION, TD.T_traction_cut_off); assert.equal(a.T_BE_REACT, TD.T_brake_emergency); assert.equal(a.A_BRAKE_SAFE, TD.A_brake_emergency);
  ok('S24', 'every Subset-130 variable of packets 6 and 11 produced by the reference onboard');
}

// @test S25: SBI2, W, P and I of an MRSP target from its EBD, T_indication with T_driver [S026-3.13.9.3.3.2-c, S026-3.13.9.3.4.1-c, S026-3.13.9.3.5.1-c, S026-3.13.9.3.6.1-c, S026-3.13.9.3.6.2-c]
{
  // on level track the EBD towards (x_t, V_t + dV_ebi) is v² = (V_t + dV_ebi)² + 2·A·(x_t − x): a limit that leaves
  // the EBD after a dead time T is the v with v² = vtE² + 2·A·(d − v·T)
  const vDead = (d: number, vtE: number, A: number, T: number) => -A * T + Math.sqrt(A * A * T * T + vtE * vtE + 2 * A * d);
  const Tdrv = DEFAULT_NATIONAL.T_driver, Tw = DEFAULT_NATIONAL.T_warning, Ts = TD.T_brake_service, Ae = TD.A_brake_emergency;
  const vtE = (80 + marginKmh(80, 7.5, 15, 110, 210)) * KMH;
  const b = new Bench();
  b.cycle(0, 0, { radio: [m3({ eoa: 9000, dp: 50, ssp: [[0, 160], [5000, 80]] })] });
  b.cycle(4600, 20);
  const d = 400, sbi = vDead(d, vtE, Ae, Tbe + Ts);
  near(b.dmi.v_intervention_ms, vDead(d, vtE, Ae, Tbe), 0.02, 'EBI of the MRSP target');
  near(b.dmi.v_sbi_ms, sbi, 0.02, 'SBI2 = EBI − V·T_bs');
  near(b.dmi.v_warning_ms, vDead(d, vtE, Ae, Tbe + Ts + Tw), 0.02, 'W = SBI − V·T_warning');
  near(b.dmi.v_permitted_ms, vDead(d, vtE, Ae, Tbe + Ts + Tdrv), 0.02, 'P = SBI − V·T_driver');
  // the indication starts T_indication = max(0.8·T_bs, 5 s) + T_driver before P
  const Tind = Math.max(0.8 * Ts, 5) + Tdrv, vI = vDead(d, vtE, Ae, Tbe + Ts + Tdrv + Tind);
  b.cycle(4600, vI - 0.05);
  assert.equal(b.dmi.indication, false, 'below the I curve: no indication');
  b.cycle(4600, vI + 0.05);
  assert.equal(b.dmi.indication, true, 'above the I curve: indication');
  // the limits never go below the ceiling limits of the target
  b.cycle(4995, 20);
  near(b.dmi.v_permitted_ms, 80 * KMH, 1e-9, 'P at the target is V_target');
  ok('S25', 'MRSP target: EBI, SBI2, W, P, I from the EBD towards V_target + dV_ebi, T_indication with T_driver');
}

// @test S26: orientation with respect to the LRBG from the order of the balises, and validity direction of the packets [S026-3.4.2, S026-3.6.3]
{
  // a train that reads N_PIG = 1 before N_PIG = 0 passes the group against its nominal direction
  const b = new Bench({ stored: false });
  const bg = { NID_BG: 1, s: 0 } as never;
  b.cycle(1000, 10, { balises: [{ odometer_m: 1000, telegram: baliseTelegram(bg, 1) }, { odometer_m: 1003, telegram: baliseTelegram(bg, 0) }] });
  const rep = b.sent.filter(m => m.NID_MESSAGE === 136).pop()!.packets![0];
  assert.equal(rep.Q_DIRLRBG, 0, 'Q_DIRLRBG = 0: train oriented against the nominal direction of the LRBG');
  assert.equal(rep.Q_DIRTRAIN, 0, 'Q_DIRTRAIN = 0: running against the nominal direction');
  const flip = (m: RadioMessage, q: number): RadioMessage => ({ ...m, packets: m.packets!.map(p => ({ ...p, Q_DIR: q })) });
  b.cycle(1010, 10, { radio: [flip(m3({ eoa: 2000, dp: 50 }), 1)] });
  assert.equal(b.dmi.mode, 'SB', 'packets valid in the nominal direction are ignored by a train running in reverse');
  b.cycle(1020, 10, { radio: [flip(m3({ eoa: 2000, dp: 50 }), 0)] });
  assert.equal(b.dmi.mode, 'FS', 'packets with Q_DIR = 0 apply to it');
  near(b.dmi.ato!.N_LOC_EOALOA!, 1003 + 2000, 1e-9, 'end of authority counted from the LRBG in the direction of running');
  // the same group read in the usual order: nominal, and Q_DIR = 2 is valid in both directions
  const n = new Bench({ stored: false });
  n.cycle(1003, 10, { balises: [{ odometer_m: 1000, telegram: baliseTelegram(bg, 0) }, { odometer_m: 1003, telegram: baliseTelegram(bg, 1) }] });
  assert.equal(n.sent.filter(m => m.NID_MESSAGE === 136).pop()!.packets![0].Q_DIRLRBG, 1);
  n.cycle(1010, 10, { radio: [flip(m3({ eoa: 2000, dp: 50 }), 0)] });
  assert.equal(n.dmi.mode, 'SB', 'a nominal train ignores packets for the reverse direction');
  n.cycle(1020, 10, { radio: [flip(m3({ eoa: 2000, dp: 50 }), 2)] });
  assert.equal(n.dmi.mode, 'FS', 'Q_DIR = 2: valid in both directions');
  ok('S26', 'orientation from the order of N_PIG, packets filtered by Q_DIR');
}

console.log(`Subset-026 and Subset-130 requirement tests: ${count} blocks ok`);
