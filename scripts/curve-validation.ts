/**
 * Validation of the curves of the reference onboard against the ERA braking curves tool.
 *
 *   npx tsx scripts/curve-validation.ts                                     # YuTreno points for the cases of validation/cases.json
 *   npx tsx scripts/curve-validation.ts --era-template                      # writes the form validation/era/era_points.csv to fill in
 *   npx tsx scripts/curve-validation.ts --era validation/era/era_points.csv # comparison and differences in metres
 *
 * For each single-target case the reference onboard receives, as in a real run, the stored position and a message 3
 * with authority (15), static profile (27) and gradients (21). For each speed of `speed_kmh` the script looks for the
 * distance from the target at which each curve equals that speed. For EBI, SBI, W, P and I it uses the speeds the
 * onboard publishes on the DMI, by bisection on the position; for EBD and SBD the validation function of the onboard.
 * Distances are in metres before the target: the end of authority or the point of the speed reduction. An empty cell
 * means that the curve does not reach that speed before the target or that the onboard does not use it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReferenceEvc, toEnglish, type EtcsPacket, type OnboardDmi, type OnboardNationalValues, type OnboardTrainData } from '../src/core';

interface Case { id: string; description: string; target: 'EOA' | 'speed'; distance_m: number; D_DP?: number; v_target_kmh?: number; gradient_permille: number }
interface Cases { train_data: OnboardTrainData; national_values: Partial<OnboardNationalValues>; speed_kmh: number[]; cases: Case[] }

const NID_LRBG = 16384 + 1;
const CURVES = ['EBD', 'SBD', 'EBI', 'SBI', 'W', 'P', 'I'] as const;
type Curve = typeof CURVES[number];

function args(argv: string[]): Record<string, string> {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  return a;
}

/** Message 3 for a case: authority, static profile and constant gradient referred to the balise group at the origin */
function message3(c: Case): { packets: EtcsPacket[]; eoa: number } {
  const eoa = c.target === 'EOA' ? c.distance_m : c.distance_m + 20000;
  const end = eoa + 1000;
  const p15: EtcsPacket = {
    NID_PACKET: 15, Q_DIR: 1, Q_SCALE: 1, V_LOA: 0, T_LOA: 1023, N_ITER: 0, L_ENDSECTION: eoa, Q_SECTIONTIMER: 0, Q_ENDTIMER: 0,
    Q_DANGERPOINT: c.target === 'EOA' ? 1 : 0, D_DP: c.target === 'EOA' ? (c.D_DP ?? 50) : 0, V_RELEASEDP: c.target === 'EOA' ? 3 : 0, Q_OVERLAP: 0,
  };
  const ssp = c.target === 'EOA'
    ? [{ D_STATIC: 0, V_STATIC: 32, Q_FRONT: 0 }, { D_STATIC: end, V_STATIC: 127, Q_FRONT: 0 }]
    : [{ D_STATIC: 0, V_STATIC: 32, Q_FRONT: 0 }, { D_STATIC: c.distance_m, V_STATIC: Math.floor((c.v_target_kmh as number) / 5), Q_FRONT: 0 }, { D_STATIC: end - c.distance_m, V_STATIC: 127, Q_FRONT: 0 }];
  const up = c.gradient_permille >= 0, ga = Math.abs(c.gradient_permille);
  const gr = [{ D_GRADIENT: 0, Q_GDIR: up ? 1 : 0, G_A: ga }, { D_GRADIENT: end, Q_GDIR: 0, G_A: 255 }];
  return {
    eoa,
    packets: [
      p15,
      { NID_PACKET: 27, Q_DIR: 1, Q_SCALE: 1, ...ssp[0], N_ITER: ssp.length - 1, elements: ssp.slice(1) },
      { NID_PACKET: 21, Q_DIR: 1, Q_SCALE: 1, ...gr[0], N_ITER: gr.length - 1, elements: gr.slice(1) },
    ],
  };
}

/** A freshly started onboard, in FS with the message of the case, ready to be queried at a point */
function freshEvc(cs: Cases, c: Case, pk: EtcsPacket[]): ReferenceEvc {
  const evc = new ReferenceEvc();
  evc.step({
    type: 'onboard', version: 2, start: true, t: 0, dt: 0.1, odometry: { distance_m: 0, speed_ms: 0, acceleration_ms2: 0 },
    balises: [], radio: [], train: { doors_open: false, emergency_applied: false, traction: 0, brake: 0 },
    train_data: cs.train_data, national_values: { ...cs.national_values } as OnboardNationalValues, stored_position: { NID_LRBG, D_LRBG: 0 },
  });
  evc.step({
    type: 'onboard', version: 2, start: false, t: 0.1, dt: 0.1, odometry: { distance_m: 0, speed_ms: 0, acceleration_ms2: 0 },
    balises: [], radio: [{ NID_MESSAGE: 3, T_TRAIN: 10, NID_LRBG, packets: pk }], train: { doors_open: false, emergency_applied: false, traction: 0, brake: 0 },
  });
  if (evc.mode !== 'FS') throw new Error(c.id + ': the onboard did not enter full supervision');
  return evc;
}

/** DMI of the onboard with the head at x at speed v (a new onboard for each point, so no state passes from one point to the next) */
function dmiAt(cs: Cases, c: Case, pk: EtcsPacket[], x: number, v: number): OnboardDmi {
  const evc = freshEvc(cs, c, pk);
  return evc.step({
    type: 'onboard', version: 2, start: false, t: 0.2, dt: 0.1, odometry: { distance_m: x, speed_ms: v, acceleration_ms2: 0 },
    balises: [], radio: [], train: { doors_open: false, emergency_applied: false, traction: 0, brake: 0 },
  }).dmi;
}

/** Last position in [0, xMax] where the curve is at least v (the curve descends towards the target) */
function crossing(test: (x: number) => boolean, xMax: number): number | null {
  if (!test(0)) return null;
  if (test(xMax)) return null;
  let lo = 0, hi = xMax;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (test(m)) lo = m; else hi = m; }
  return lo;
}

export function points(cs: Cases) {
  const rows: Record<string, string | number>[] = [];
  for (const c of cs.cases) {
    const { packets, eoa } = message3(c);
    const xt = c.distance_m, probe = freshEvc(cs, c, packets);
    for (const vk of cs.speed_kmh) {
      const v = vk / 3.6, row: Record<string, string | number> = { case_id: c.id, v_kmh: vk };
      const put = (k: Curve, x: number | null) => { row['d_' + k + '_m'] = x == null ? '' : (xt - x).toFixed(2); };
      if (c.target === 'EOA') {
        put('EBD', probe.brakingCurvePoint('EBD', eoa + (c.D_DP ?? 50), 0, v));
        put('SBD', probe.brakingCurvePoint('SBD', eoa, 0, v));
      } else {
        const vt = (c.v_target_kmh as number) / 3.6;
        put('EBD', v > vt ? probe.brakingCurvePoint('EBD', xt, vt, v) : null);
        put('SBD', null);  // the reference onboard does not use the SBD for speed reductions
      }
      // the search stops at the end of authority: beyond it the onboard trips and publishes no curves
      const lim = Math.min(xt, eoa) - 0.01;
      put('EBI', crossing(x => dmiAt(cs, c, packets, x, 0).v_intervention_ms >= v, lim));
      put('SBI', crossing(x => dmiAt(cs, c, packets, x, 0).v_sbi_ms >= v, lim));
      put('W', crossing(x => dmiAt(cs, c, packets, x, 0).v_warning_ms >= v, lim));
      put('P', crossing(x => dmiAt(cs, c, packets, x, 0).v_permitted_ms >= v, lim));
      put('I', crossing(x => !dmiAt(cs, c, packets, x, v).indication, lim));
      rows.push(row);
    }
  }
  return rows;
}

function toCsv(rows: Record<string, unknown>[]): string {
  const cols = Object.keys(rows[0]);
  return cols.join(',') + '\n' + rows.map(r => cols.map(k => String(r[k] ?? '')).join(',')).join('\n') + '\n';
}
function fromCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map(s => s.trim());
  return lines.filter(l => l.trim()).map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? '').trim()])); });
}

async function main() {
  const a = args(process.argv.slice(2));
  const cs = toEnglish<Cases>(JSON.parse(readFileSync(a.cases || 'validation/cases.json', 'utf8')));
  const outDir = a.output || join('results', 'curve-validation');
  mkdirSync(outDir, { recursive: true });
  const rows = points(cs);
  writeFileSync(join(outDir, 'yutreno_points.csv'), toCsv(rows));
  console.log(`YuTreno points: ${rows.length} rows in ${join(outDir, 'yutreno_points.csv')}`);

  if (a['era-template']) {
    const file = 'validation/era/era_points.csv';
    mkdirSync('validation/era', { recursive: true });
    if (existsSync(file)) console.log(file + ' already exists: not overwriting it');
    else {
      writeFileSync(file, toCsv(rows.map(r => ({ case_id: r.case_id, v_kmh: r.v_kmh, ...Object.fromEntries(CURVES.map(k => ['d_' + k + '_m', ''])) }))));
      console.log('Form to fill in with the values of the ERA tool: ' + file);
    }
  }

  if (a.era) {
    const era = fromCsv(readFileSync(a.era, 'utf8'));
    const key = (r: Record<string, unknown>) => r.case_id + '|' + Number(r.v_kmh);
    const byKey = new Map(era.map(r => [key(r), r]));
    const diff: Record<string, string | number>[] = [];
    const worst = new Map<string, number>();
    for (const r of rows) {
      const e = byKey.get(key(r));
      const d: Record<string, string | number> = { case_id: r.case_id, v_kmh: r.v_kmh };
      for (const k of CURVES) {
        const y = r['d_' + k + '_m'], x = e?.['d_' + k + '_m'];
        if (y === '' || x == null || x === '') { d['delta_' + k + '_m'] = ''; continue; }
        const dd = Number(y) - Number(x);
        d['delta_' + k + '_m'] = dd.toFixed(2);
        const w = r.case_id + ' ' + k;
        worst.set(w, Math.max(worst.get(w) ?? 0, Math.abs(dd)));
      }
      diff.push(d);
    }
    writeFileSync(join(outDir, 'differences.csv'), toCsv(diff));
    console.log('Differences YuTreno − ERA (m, positive if YuTreno brakes earlier) in ' + join(outDir, 'differences.csv'));
    if (!worst.size) console.log('  no ERA value to compare: is the file still empty?');
    for (const [k, w] of worst) console.log(`  ${k.padEnd(22)} maximum deviation ${w.toFixed(1)} m`);
  }
}

const isMain = process.argv[1] && /curve-validation\.ts$/.test(process.argv[1]);
if (isMain) main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
