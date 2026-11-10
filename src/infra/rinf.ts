/**
 * Import from RINF, the register of infrastructure of the European Union Agency for Railways.
 *
 * The input is the result, in the SPARQL 1.1 JSON format, of the query of docs/INFRA_IMPORT.md on the ERA knowledge
 * graph: one row per track of a section of line, with the two operational points, the length, the maximum speed, the
 * ETCS level, the national protection system, the contact line system and the gradient profile. The column names are
 * those of the query.
 *
 * The sections are laid on the imported line between its stations: the operational points are matched to the
 * stations by name; a chain of sections between two consecutive stations, through operational points that are not
 * stations of the line (junctions, block posts), is laid proportionally to the RINF lengths.
 */
import { normName } from './geo';
import type { Attr, ConsistencyRow, ImportedStation, RinfSection } from './types';

/** Reads the SPARQL JSON result of the RINF query */
export function parseRinf(input: string | object): RinfSection[] {
  const j = (typeof input === 'string' ? JSON.parse(input) : input) as { head?: { vars?: string[] }; results?: { bindings?: Record<string, { value: string }>[] } };
  const rows = j.results?.bindings;
  if (!Array.isArray(rows)) throw new Error('not a SPARQL JSON result: no "results.bindings"');
  const num = (v?: { value: string }) => v != null && isFinite(parseFloat(v.value)) ? parseFloat(v.value) : undefined;
  const txt = (v?: { value: string }) => { const x = v?.value ? label(v.value).replace(/^null\s*/i, '').trim() : ''; return x && !/^(none|null|n\/a)$/i.test(x) ? x : undefined; };
  const out: RinfSection[] = [];
  for (const r of rows) {
    if (!r.sol || !r.opStart || !r.opEnd) continue;
    const g = num(r.gradient);
    // gradient profile: «+19.9(8.275) +18.0(6.793)» in any order (an RDF set)
    const gp = [...(r.gradientProfile?.value ?? '').matchAll(/([+-]?\d+(?:\.\d+)?)\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g)].map(m => ({ km: +m[2], g: +m[1] })).sort((a, b) => a.km - b.km || a.g - b.g);
    out.push({
      sol: r.sol.value, opStart: r.opStart.value, opEnd: r.opEnd.value,
      opStartName: r.opStartName?.value ?? r.opStart.value, opEndName: r.opEndName?.value ?? r.opEnd.value,
      ...(num(r.length) != null ? { length_m: num(r.length) } : {}),
      ...(num(r.maxSpeed) != null ? { maxSpeed_kmh: num(r.maxSpeed) } : {}),
      ...(txt(r.etcsLevel) ? { etcsLevel: txt(r.etcsLevel) } : {}),
      ...(txt(r.protection) ? { protection: txt(r.protection) } : {}),
      ...(txt(r.contactLine) ? { contactLine: txt(r.contactLine) } : {}),
      ...(g != null ? { gradient: g } : {}),
      ...(gp.length ? { gradientProfile: gp } : {}),
      ...(kmAt(r.opStartKm?.value, r.lineId?.value) != null ? { opStartKm: kmAt(r.opStartKm?.value, r.lineId?.value) } : {}),
      ...(kmAt(r.opEndKm?.value, r.lineId?.value) != null ? { opEndKm: kmAt(r.opEndKm?.value, r.lineId?.value) } : {}),
      ...(r.lineId?.value ? { lineId: r.lineId.value } : {}),
    });
  }
  return out.sort((a, b) => a.sol < b.sol ? -1 : a.sol > b.sol ? 1 : (a.maxSpeed_kmh ?? 0) - (b.maxSpeed_kmh ?? 0));
}

/** Kilometre of an operational point on a line, from the labels of its coordinates: `C148 | 9+456;C215 | 43+664` */
function kmAt(labels: string | undefined, lineId: string | undefined): number | undefined {
  for (const l of (labels ?? '').split(';')) {
    const m = /^\s*(.+?)\s*\|\s*(\d+)\+(\d+(?:\.\d+)?)\s*$/.exec(l);
    if (m && (lineId == null || m[1] === lineId)) return +m[2] + +m[3] / 1000;
  }
  return undefined;
}

/** Last part of an IRI of the ERA vocabulary (`http://data.europa.eu/949/concepts/etcs-levels/rinf/30` → `30`), or the text */
function label(v: string): string {
  return /^https?:\/\//.test(v) ? decodeURIComponent(v.replace(/[#/]+$/, '').split(/[#/]/).pop() ?? v) : v;
}

/**
 * Whether a RINF name, which is often shortened, names an OSM station: RINF `S.MARIA A VICO` for `Santa Maria a Vico`,
 * `TUFARA VALLE` for `Tufara Valle - Arpaise - Ceppaloni`, `BENEVENTO PONTE CORVO` for `Benevento Pontecorvo -
 * Castelpoto`. The RINF name (normalised) must cover one whole part of the OSM name between hyphens; a one-letter word
 * stands for any word with that initial, and spaces may be missing.
 */
export function abbreviated(rinfNorm: string, osmName: string): boolean {
  const words = rinfNorm.split(' ').filter(Boolean);
  if (!words.length) return false;
  const re = new RegExp('^' + words.map(w => w.length === 1 ? `${w}[a-z]*` : w).join(' ?') + '$');
  return osmName.split('-').map(normName).some(part => re.test(part));
}

export interface RinfOverlay {
  speed: Attr<number>[];
  gradient: Attr<number>[];
  signalling: Attr<string>[];
  electrification: Attr<string>[];
  consistency: ConsistencyRow[];
  /** Operational points matched to stations of the line */
  matched: Record<string, string>;
  warnings: string[];
}

/** Lays the RINF sections on the stations of the line */
export function rinfOverlay(rows: RinfSection[], stations: ImportedStation[]): RinfOverlay {
  const warnings: string[] = [];
  // one entry per section of line: the tracks of a double-track section are merged (highest maximum speed, first
  // non-empty value of the other properties)
  const sols = new Map<string, RinfSection>();
  for (const r of rows) {
    const o = sols.get(r.sol);
    if (!o) { sols.set(r.sol, { ...r }); continue; }
    if ((r.maxSpeed_kmh ?? -1) > (o.maxSpeed_kmh ?? -1)) o.maxSpeed_kmh = r.maxSpeed_kmh;
    o.etcsLevel ??= r.etcsLevel; o.protection ??= r.protection; o.contactLine ??= r.contactLine;
    o.length_m ??= r.length_m; o.gradient ??= r.gradient;
    if (r.gradientProfile) o.gradientProfile = [...new Map([...(o.gradientProfile ?? []), ...r.gradientProfile].map(x => [`${x.km}|${x.g}`, x])).values()].sort((a, b) => a.km - b.km || a.g - b.g);
  }
  // an operational point can have several names (BENEVENTO and BENEVENTO CENTRALE): every one is matched
  const names = new Map<string, Set<string>>();
  const addName = (op: string, n: string) => { const x = names.get(op) ?? new Set(); x.add(normName(n)); names.set(op, x); };
  for (const r of rows) { addName(r.opStart, r.opStartName); addName(r.opEnd, r.opEndName); }
  // operational points of the stations
  const opOf = new Map<number, string>(), matched: Record<string, string> = {};
  stations.forEach((st, i) => {
    const k = normName(st.name);
    let ops = [...names].filter(([, n]) => n.has(k)).map(([op]) => op).sort();
    if (!ops.length) ops = [...names].filter(([, n]) => [...n].some(x => abbreviated(x, st.name))).map(([op]) => op).sort();
    if (ops.length) { opOf.set(i, ops[0]); matched[st.name] = ops[0]; }
    else warnings.push(`RINF: no operational point named «${st.name}»`);
  });
  const stationOps = new Set(opOf.values());
  const adj = new Map<string, { to: string; sol: RinfSection; fwd: boolean }[]>();
  for (const s of [...sols.values()]) {
    for (const [x, y, fwd] of [[s.opStart, s.opEnd, true], [s.opEnd, s.opStart, false]] as const) adj.set(x, [...(adj.get(x) ?? []), { to: y, sol: s, fwd }]);
  }
  for (const l of adj.values()) l.sort((a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : 0);

  const speed: Attr<number>[] = [], gradient: Attr<number>[] = [], signalling: Attr<string>[] = [], electrification: Attr<string>[] = [];
  const consistency: ConsistencyRow[] = [];
  const placed: { sol: RinfSection; a: number; b: number }[] = [];
  const idx = [...opOf.keys()].sort((a, b) => a - b);
  for (let q = 0; q < idx.length - 1; q++) {
    const i = idx[q], j = idx[q + 1], from = opOf.get(i)!, to = opOf.get(j)!;
    // shortest chain of sections from one station to the next, not through other stations of the line
    const dist = new Map([[from, 0]]), prev = new Map<string, { at: string; sol: RinfSection; fwd: boolean }>();
    const todo = [from];
    while (todo.length) {
      todo.sort((a, b) => dist.get(a)! - dist.get(b)! || (a < b ? -1 : 1));
      const u = todo.shift()!;
      if (u === to) break;
      if (u !== from && stationOps.has(u)) continue;
      for (const e of adj.get(u) ?? []) {
        const d = dist.get(u)! + (e.sol.length_m ?? 1);
        if (d < (dist.get(e.to) ?? Infinity)) { if (!dist.has(e.to)) todo.push(e.to); dist.set(e.to, d); prev.set(e.to, { at: u, sol: e.sol, fwd: e.fwd }); }
      }
    }
    if (!prev.has(to)) { warnings.push(`RINF: no sections between «${stations[i].name}» and «${stations[j].name}»`); continue; }
    const chain: { sol: RinfSection; fwd: boolean }[] = [];
    for (let u = to; u !== from;) { const p = prev.get(u)!; chain.unshift({ sol: p.sol, fwd: p.fwd }); u = p.at; }
    const a = stations[i].s, b = stations[j].s, total = chain.reduce((x, c) => x + (c.sol.length_m ?? 0), 0);
    const known = chain.every(c => c.sol.length_m != null && c.sol.length_m > 0);
    if (known) consistency.push({ from: stations[i].name, to: stations[j].name, osm_m: Math.round(b - a), rinf_m: Math.round(total), diff_pct: +((b - a - total) / total * 100).toFixed(2) });
    let s = a;
    chain.forEach((c, n) => {
      const e = n === chain.length - 1 ? b : s + (b - s) * (known ? c.sol.length_m! / chain.slice(n).reduce((x, y) => x + y.sol.length_m!, 0) : 1 / (chain.length - n));
      const prov = chain.length > 1 ? 'derived' : 'source', ref = c.sol.sol;
      if (c.sol.maxSpeed_kmh != null) speed.push({ a: s, b: e, v: c.sol.maxSpeed_kmh, prov, src: 'rinf', ref });
      if (c.sol.gradient != null && !c.sol.gradientProfile) gradient.push({ a: s, b: e, v: c.fwd ? c.sol.gradient : -c.sol.gradient, prov, src: 'rinf', ref });
      placed.push({ sol: c.sol, a: s, b: e });
      const sig = [c.sol.etcsLevel != null && !/^(n|none|no|not|0|$)/i.test(c.sol.etcsLevel) ? `ETCS ${/^\d$/.test(c.sol.etcsLevel) ? 'L' + c.sol.etcsLevel : c.sol.etcsLevel}` : '', c.sol.protection ?? ''].filter(Boolean).join('+');
      if (sig) signalling.push({ a: s, b: e, v: sig, prov, src: 'rinf', ref });
      if (c.sol.contactLine) electrification.push({ a: s, b: e, v: c.sol.contactLine, prov, src: 'rinf', ref });
      s = e;
    });
  }
  // kilometres of the stations on this line, from the operational points of RINF
  const kmOf = new Map<string, number>();
  for (const r of rows) for (const [op, k] of [[r.opStart, r.opStartKm], [r.opEnd, r.opEndKm]] as const) if (k != null && !kmOf.has(op)) kmOf.set(op, k);
  const anchors = [...opOf].filter(([, op]) => kmOf.has(op)).map(([i, op]) => ({ s: stations[i].s, km: kmOf.get(op)!, name: stations[i].name }));
  gradient.push(...profileOverlay(placed, anchors, warnings));
  return { speed, gradient, signalling, electrification, consistency, matched, warnings };
}

/**
 * Lays the gradient profiles of RINF on the line. The changes of gradient are at kilometres of the national line, and
 * so are the operational points (`C148 | 9+456`): the stations of the line are the anchors that turn a kilometre into
 * a chainage, linearly between two stations. An anchor that disagrees with its neighbours (a station shared by several
 * lines can carry the kilometre of another one) is left out, and beyond the last anchor the kilometres follow the
 * chainage. The changes of all the sections form one profile: each gradient holds from its kilometre to the next
 * change, across the stations; a change outside the line (a kilometre written wrong) is left out with a warning; before
 * the first change the line has no RINF gradient (docs/INFRA_IMPORT.md).
 */
function profileOverlay(placed: { sol: RinfSection; a: number; b: number }[], anchors: { s: number; km: number; name: string }[], warnings: string[]): Attr<number>[] {
  const changes = [...new Map(placed.flatMap(p => (p.sol.gradientProfile ?? []).map(x => [`${x.km}|${x.g}`, { ...x, ref: p.sol.sol }] as const))).values()].sort((x, y) => x.km - y.km || x.g - y.g);
  if (!changes.length || !placed.length) return [];
  // anchors: kilometre and chainage of the stations, those agreeing with a neighbour (within 10 % and 200 m)
  const A = anchors.slice().sort((x, y) => x.s - y.s);
  const agree = (x: typeof A[number], y: typeof A[number]) => Math.abs(Math.abs(y.km - x.km) * 1000 - (y.s - x.s)) <= 0.1 * (y.s - x.s) + 200;
  const good = A.filter((x, i) => (i > 0 && agree(A[i - 1], x)) || (i < A.length - 1 && agree(x, A[i + 1])));
  for (const x of A) if (!good.includes(x)) warnings.push(`RINF: kilometre ${x.km.toFixed(3)} of ${x.name} does not agree with the next stations, not used for the gradients`);
  if (!good.length) { warnings.push('RINF: no kilometres of the stations, gradient profile not used'); return []; }
  const dir = good.length > 1 && good[good.length - 1].km < good[0].km ? -1 : 1;
  const sOf = (km: number) => {
    if (good.length === 1 || dir * km <= dir * good[0].km) return good[0].s + dir * (km - good[0].km) * 1000;
    for (let i = 0; i < good.length - 1; i++) {
      const x = good[i], y = good[i + 1];
      if (dir * km <= dir * y.km) return x.s + (y.s - x.s) * (km - x.km) / (y.km - x.km);
    }
    const z = good[good.length - 1];
    return z.s + dir * (km - z.km) * 1000;
  };
  const start = placed[0].a, end = placed[placed.length - 1].b;
  const inLine = changes.filter(c => { const x = sOf(c.km); const ok = x >= start - 100 && x <= end + 100; if (!ok) warnings.push(`RINF: change of gradient at km ${c.km.toFixed(3)} outside the line, left out`); return ok; });
  // pieces in kilometres, then on the chainage; against the kilometres the sign changes and a piece runs back
  const out: Attr<number>[] = [];
  const kEnd = dir > 0 ? Math.max(...good.map(g => g.km)) + (end - good[good.length - 1].s) / 1000 : Math.max(...good.map(g => g.km)) + (good[0].s - start) / 1000;
  for (let i = 0; i < inLine.length; i++) {
    const k0 = inLine[i].km, k1 = i + 1 < inLine.length ? inLine[i + 1].km : kEnd;
    if (k1 <= k0) continue;
    const x0 = Math.min(end, Math.max(start, sOf(k0))), x1 = Math.min(end, Math.max(start, sOf(k1)));
    const a = Math.min(x0, x1), b = Math.max(x0, x1);
    if (b > a + 0.5) out.push({ a, b, v: dir * inLine[i].g, prov: 'source', src: 'rinf', ref: inLine[i].ref });
  }
  return out.sort((x, y) => x.a - y.a);
}
