/**
 * Import from OpenStreetMap (OpenRailwayMap tagging): the path of a line between two stations of an Overpass extract.
 *
 * The extract is the JSON output of Overpass (`[out:json]`), with the railway ways and their nodes (`out body; >; out
 * skel qt;` or `out geom`) and the station nodes; docs/INFRA_IMPORT.md gives the query. The ways tagged railway=rail
 * or narrow_gauge, without service=siding|yard|spur|crossover, form a graph on their nodes; the line is the shortest
 * path between the track nodes nearest to the two terminal stations, extended beyond them along the straightest
 * continuation. Every way of the path gives its tags to its stretch: maxspeed (with :forward and :backward),
 * tunnel, bridge, electrified with voltage and frequency, railway:etcs, railway:scmt and the other protection systems,
 * gauge. The result does not depend on the order of the elements in the extract.
 */
import { cumulative, fromPlan, haversine, normName, project, toPlan, mergeRanges, type LatLon, type XY } from './geo';
import type { Attr, ImportedStation, InfraImportOptions, MappedSignal, OsmTrack } from './types';

type Tags = Record<string, string>;
interface OsmNode { id: number; lat: number; lon: number; tags: Tags }
interface OsmWay { id: number; nodes: number[]; tags: Tags; center?: LatLon }
interface Edge { to: number; w: number; way: number; fwd: boolean }

export interface OsmData { nodes: Map<number, OsmNode>; ways: Map<number, OsmWay>; timestamp?: string; generator?: string; elements: number }

/** Reads an Overpass JSON extract */
export function parseOverpass(input: string | object): OsmData {
  const j = (typeof input === 'string' ? JSON.parse(input) : input) as { elements?: any[]; osm3s?: { timestamp_osm_base?: string }; generator?: string };
  if (!Array.isArray(j.elements)) throw new Error('not an Overpass JSON extract: no "elements"');
  const nodes = new Map<number, OsmNode>(), ways = new Map<number, OsmWay>();
  for (const e of j.elements) {
    if (e.type === 'node' && typeof e.lat === 'number') {
      const old = nodes.get(e.id);
      nodes.set(e.id, { id: e.id, lat: e.lat, lon: e.lon, tags: { ...(old?.tags ?? {}), ...(e.tags ?? {}) } });
    } else if (e.type === 'way' && Array.isArray(e.nodes)) {
      const old = ways.get(e.id);
      ways.set(e.id, { id: e.id, nodes: e.nodes, tags: { ...(old?.tags ?? {}), ...(e.tags ?? {}) }, center: e.center ?? old?.center });
      // `out geom` gives the coordinates on the way: they stand for the nodes not listed separately
      if (Array.isArray(e.geometry)) e.nodes.forEach((n: number, i: number) => {
        const g = e.geometry[i];
        if (g && !nodes.has(n)) nodes.set(n, { id: n, lat: g.lat, lon: g.lon, tags: {} });
      });
    }
  }
  return { nodes, ways, timestamp: j.osm3s?.timestamp_osm_base, generator: j.generator, elements: j.elements.length };
}

const RAIL = new Set(['rail', 'narrow_gauge']);
const SERVICE = new Set(['siding', 'yard', 'spur', 'crossover']);

/** Speed of a maxspeed value (km/h), or null if it is not a number */
export function parseSpeed(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?\s*$/i.exec(v.split(';')[0]);
  if (!m) return null;
  return Math.round(+m[1] * (m[2]?.toLowerCase() === 'mph' ? 1.609344 : 1));
}

function electrification(t: Tags): string | null {
  const e = t.electrified;
  if (!e) return null;
  if (e === 'no') return 'none';
  const f = t.frequency, v = t.voltage;
  return [e, v ? `${v} V` : '', f != null ? (+f === 0 ? 'DC' : `${f} Hz`) : ''].filter(Boolean).join(' ');
}

function protection(t: Tags): string | null {
  const out: string[] = [];
  const etcs = t['railway:etcs'];
  if (etcs && etcs !== 'no') out.push(/^\d/.test(etcs) ? `ETCS L${etcs}` : 'ETCS');
  for (const [k, n] of [['railway:scmt', 'SCMT'], ['railway:ssc', 'SSC'], ['railway:bacc', 'BACC'], ['railway:pzb', 'PZB'], ['railway:lzb', 'LZB'], ['railway:atb', 'ATB'], ['railway:kvb', 'KVB'], ['railway:tvm', 'TVM']])
    if (t[k] && t[k] !== 'no') out.push(n);
  return out.length ? out.join('+') : null;
}

function isStation(t: Tags): boolean {
  return t.railway === 'station' || t.railway === 'halt' || (t.public_transport === 'station' && (t.train === 'yes' || t.railway != null));
}
const isStop = (t: Tags): boolean => t.railway === 'stop' || (t.public_transport === 'stop_position' && t.train === 'yes');

/** Binary heap of [distance, node] ordered by distance and then by node id, for a deterministic shortest path */
class Heap {
  private a: [number, number][] = [];
  get size(): number { return this.a.length; }
  private less(i: number, j: number): boolean { const x = this.a[i], y = this.a[j]; return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(v: [number, number]): void {
    const a = this.a; a.push(v);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && this.less(l, m)) m = l;
        if (r < a.length && this.less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

/** Finds the line between two stations and reads its properties */
export function osmTrack(data: OsmData, o: InfraImportOptions): OsmTrack {
  const warnings: string[] = [];
  const radius = o.stationRadius_m ?? 300;
  // graph of the running lines
  const adj = new Map<number, Edge[]>();
  const wayIds = [...data.ways.keys()].sort((a, b) => a - b);
  for (const id of wayIds) {
    const w = data.ways.get(id)!;
    if (!RAIL.has(w.tags.railway) || (!o.serviceTracks && SERVICE.has(w.tags.service))) continue;
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = data.nodes.get(w.nodes[i]), b = data.nodes.get(w.nodes[i + 1]);
      if (!a || !b) { warnings.push(`way/${id}: node ${!a ? w.nodes[i] : w.nodes[i + 1]} missing from the extract`); continue; }
      const d = haversine(a, b);
      for (const [x, y, fwd] of [[a.id, b.id, true], [b.id, a.id, false]] as const) {
        const l = adj.get(x) ?? [];
        if (!l.some(e => e.to === y)) l.push({ to: y, w: d, way: id, fwd });
        adj.set(x, l);
      }
    }
  }
  if (!adj.size) throw new Error('no railway=rail way in the extract');
  for (const l of adj.values()) l.sort((p, q) => p.to - q.to);
  const graphNodes = [...adj.keys()].sort((a, b) => a - b);

  // stations and stop positions
  const stations: { name: string; p: LatLon; ref: string; ele?: number }[] = [];
  const stops: { name: string; id: number; p: LatLon }[] = [];
  for (const id of [...data.nodes.keys()].sort((a, b) => a - b)) {
    const n = data.nodes.get(id)!;
    if (!n.tags.name) continue;
    if (isStation(n.tags)) stations.push({ name: n.tags.name, p: n, ref: `node/${id}`, ele: n.tags.ele != null && isFinite(parseFloat(n.tags.ele)) ? parseFloat(n.tags.ele) : undefined });
    else if (isStop(n.tags)) stops.push({ name: n.tags.name, id, p: n });
  }
  for (const id of wayIds) {
    const w = data.ways.get(id)!;
    if (w.tags.name && w.center && isStation(w.tags)) stations.push({ name: w.tags.name, p: w.center, ref: `way/${id}` });
  }
  const find = (name: string) => {
    const k = normName(name);
    const exact = stations.filter(s => normName(s.name) === k);
    const hit = exact.length ? exact : stations.filter(s => normName(s.name).includes(k));
    if (!hit.length) throw new Error(`station «${name}» not found in the extract (stations: ${[...new Set(stations.map(s => s.name))].sort().join(', ') || 'none'})`);
    if (!exact.length && new Set(hit.map(s => s.name)).size > 1) throw new Error(`station «${name}» is ambiguous: ${[...new Set(hit.map(s => s.name))].join(', ')}`);
    return hit[0];
  };
  const nearestNode = (p: LatLon, name: string): number => {
    const k = normName(name);
    const own = stops.filter(s => normName(s.name) === k && adj.has(s.id) && haversine(s.p, p) < 1000);
    if (own.length) return own.sort((a, b) => haversine(a.p, p) - haversine(b.p, p) || a.id - b.id)[0].id;
    let best = -1, bd = Infinity;
    for (const id of graphNodes) { const d = haversine(data.nodes.get(id)!, p); if (d < bd) { bd = d; best = id; } }
    if (bd > radius) warnings.push(`station «${name}» is ${Math.round(bd)} m from the nearest track`);
    return best;
  };
  const A = find(o.from), B = find(o.to);
  const n0 = nearestNode(A.p, A.name), n1 = nearestNode(B.p, B.name);

  // shortest path that a train can run: at every node the next edge turns by at most 45° from the incoming one, so
  // the path cannot reverse through the points of a station (state = node and the node it comes from)
  const P = (id: number) => data.nodes.get(id)!;
  const heading = (a: number, b: number) => { const p = P(a), q = P(b); return Math.atan2(q.lat - p.lat, (q.lon - p.lon) * Math.cos(p.lat * Math.PI / 180)); };
  const turn = (h0: number, h1: number) => { let x = Math.abs(h1 - h0); if (x > Math.PI) x = 2 * Math.PI - x; return x; };
  // a train can start from any track of the first station and end on any track of the last: the path starts from
  // a track node within 300 m of the first station and ends at the first track node within 150 m of the last
  const near = (p: LatLon, r: number, also: number) => [...new Set([also, ...graphNodes.filter(id => haversine(data.nodes.get(id)!, p) <= r)])].sort((a, b) => a - b);
  const starts = near(A.p, 300, n0), ends = new Set(near(B.p, 150, n1));
  const sNode: number[] = [], sPrev: number[] = [], sDist: number[] = [], sBack: number[] = [], index = new Map<string, number>();
  const heap = new Heap();
  // a start costs three times its distance from the station, so the path starts as near to it as the tracks allow
  for (const id of starts) { const d0 = 3 * haversine(data.nodes.get(id)!, A.p); index.set(`${id},-1`, sNode.length); heap.push([d0, sNode.length]); sNode.push(id); sPrev.push(-1); sDist.push(d0); sBack.push(-1); }
  let goal = -1;
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > sDist[k]) continue;
    const u = sNode[k], p = sPrev[k];
    if (ends.has(u)) { goal = k; break; }
    const h0 = p >= 0 ? heading(p, u) : 0;
    for (const e of adj.get(u) ?? []) {
      if (e.to === p || (p >= 0 && turn(h0, heading(u, e.to)) > Math.PI / 4)) continue;
      const key = `${e.to},${u}`, nd = d + e.w;
      let j = index.get(key);
      if (j == null) { j = sNode.length; index.set(key, j); sNode.push(e.to); sPrev.push(u); sDist.push(Infinity); sBack.push(-1); }
      if (nd < sDist[j]) { sDist[j] = nd; sBack[j] = k; heap.push([nd, j]); }
    }
  }
  if (goal < 0) throw new Error(`no railway path between «${A.name}» and «${B.name}» in the extract`);
  let path: number[] = [];
  for (let k = goal; k >= 0; k = sBack[k]) path.push(sNode[k]);
  path.reverse();

  // extension beyond the terminals along the straightest continuation
  const onPath = new Set(path);
  const extend = (end: number, before: number, max: number): number[] => {
    const out: number[] = [];
    let u = end, p = before, len = 0;
    while (len < max) {
      const pu = data.nodes.get(u)!, pp = data.nodes.get(p)!;
      const h0 = Math.atan2(pu.lat - pp.lat, (pu.lon - pp.lon) * Math.cos(pu.lat * Math.PI / 180));
      let best: Edge | null = null, bt = Infinity;
      for (const e of adj.get(u) ?? []) {
        if (onPath.has(e.to)) continue;
        const q = data.nodes.get(e.to)!;
        let t = Math.abs(Math.atan2(q.lat - pu.lat, (q.lon - pu.lon) * Math.cos(pu.lat * Math.PI / 180)) - h0);
        if (t > Math.PI) t = 2 * Math.PI - t;
        if (t < bt - 1e-12) { bt = t; best = e; }
      }
      if (!best || bt > Math.PI / 4) break;
      out.push(best.to); onPath.add(best.to); len += best.w; p = u; u = best.to;
    }
    return out;
  };
  if (path.length >= 2) {
    const head = extend(path[0], path[1], 400), tail = extend(path[path.length - 1], path[path.length - 2], 400);
    path = [...head.reverse(), ...path, ...tail];
  }

  // plan and chainage
  const origin0: LatLon = { lat: data.nodes.get(path[0])!.lat, lon: data.nodes.get(path[0])!.lon };
  let xy: XY[] = path.map(id => toPlan(origin0, data.nodes.get(id)!));
  let cum = cumulative(xy);

  // stations along the path
  type Found = ImportedStation & { d: number; p: LatLon };
  const found = new Map<string, Found>();
  for (const st of stations) {
    const pr = project(xy, cum, toPlan(origin0, st.p));
    if (pr.d > radius) continue;
    const k = normName(st.name);
    let s = pr.s, prov: ImportedStation['prov'] = 'derived', ref = st.ref, at: LatLon = st.p;
    const sp = stops.filter(x => normName(x.name) === k)
      .map(x => ({ x, pr: project(xy, cum, toPlan(origin0, x.p)) }))
      .filter(q => q.pr.d < 30 && Math.abs(q.pr.s - pr.s) < 600)
      .sort((p, q) => Math.abs(p.pr.s - pr.s) - Math.abs(q.pr.s - pr.s) || p.x.id - q.x.id)[0];
    if (sp) { s = sp.pr.s; prov = 'source'; ref = `node/${sp.x.id}`; at = sp.x.p; }
    const old = found.get(k);
    if (!old || pr.d < old.d) found.set(k, { name: st.name, s, prov, ref, d: pr.d, p: at, ...(st.ele != null ? { ele: st.ele } : {}) });
  }
  let list = [...found.values()].sort((a, b) => a.s - b.s);
  const iA = list.findIndex(s => normName(s.name) === normName(A.name)), iB = list.findIndex(s => normName(s.name) === normName(B.name));
  if (iA < 0 || iB < 0) throw new Error('a terminal station is not on the path');
  if (iA > iB) throw new Error('internal: terminals out of order');
  const dropped = list.filter((_, i) => i < iA || i > iB).map(s => s.name);
  if (dropped.length) warnings.push(`stations beyond the terminals left out: ${dropped.join(', ')}`);
  list = list.slice(iA, iB + 1);

  // stubs: 150 m before the first stop marker and 300 m after the last, as on the built-in lines
  const stubs: [number, number][] = [];
  let startP: LatLon | null = null, endP: LatLon | null = null;
  if (list[0].s < 150) {
    const add = 150 - list[0].s, [ax, ay] = xy[0], [bx, by] = xy[1], l = Math.hypot(bx - ax, by - ay) || 1;
    startP = fromPlan(origin0, [ax - (bx - ax) / l * add, ay - (by - ay) / l * add]);
  }
  const after = cum[cum.length - 1] - list[list.length - 1].s;
  if (after < 300) {
    const add = 300 - after, n = xy.length, [ax, ay] = xy[n - 2], [bx, by] = xy[n - 1], l = Math.hypot(bx - ax, by - ay) || 1;
    endP = fromPlan(origin0, [bx + (bx - ax) / l * add, by + (by - ay) / l * add]);
  }
  const origin: LatLon = startP ?? origin0, pre = startP ? 1 : 0;
  xy = [...(startP ? [startP] : []), ...path.map(id => data.nodes.get(id)!), ...(endP ? [endP] : [])].map(p => toPlan(origin, p));
  cum = cumulative(xy);
  if (startP) stubs.push([0, cum[1]]);
  if (endP) stubs.push([cum[cum.length - 2], cum[cum.length - 1]]);
  if (stubs.length) warnings.push(`the mapped track ends near a terminal: ${stubs.map(s => Math.round(s[1] - s[0])).join(' + ')} m of straight track added`);
  for (const st of list) st.s = project(xy, cum, toPlan(origin, st.p)).s;

  // properties of the ways, stretch by stretch
  const speed: Attr<number>[] = [], tunnels: Attr<true>[] = [], bridges: Attr<true>[] = [];
  const electr: Attr<string>[] = [], prot: Attr<string>[] = [], gauge: Attr<string>[] = [];
  const ways: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const e = adj.get(path[i])!.find(x => x.to === path[i + 1])!;
    const w = data.ways.get(e.way)!, t = w.tags, a = cum[i + pre], b = cum[i + pre + 1], ref = `way/${w.id}`;
    if (ways[ways.length - 1] !== w.id) ways.push(w.id);
    const v = parseSpeed(t[e.fwd ? 'maxspeed:forward' : 'maxspeed:backward']) ?? parseSpeed(t.maxspeed);
    if (v != null) speed.push({ a, b, v, prov: 'source', src: 'osm', ref });
    if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'culvert') tunnels.push({ a, b, v: true, prov: 'source', src: 'osm', ref });
    if (t.bridge && t.bridge !== 'no') bridges.push({ a, b, v: true, prov: 'source', src: 'osm', ref });
    const el = electrification(t);
    if (el) electr.push({ a, b, v: el, prov: 'source', src: 'osm', ref });
    const pr = protection(t);
    if (pr) prot.push({ a, b, v: pr, prov: 'source', src: 'osm', ref });
    if (t.gauge) gauge.push({ a, b, v: t.gauge, prov: 'source', src: 'osm', ref });
  }
  const merge = <T>(r: Attr<T>[], gap = 0.5): Attr<T>[] => mergeRanges(r.map(x => [x.a, x.b, x] as [number, number, Attr<T>]), gap, (x, y) => x.v === y.v)
    .map(([a, b, x]) => ({ ...x, a, b, ref: undefined }));
  const refs = <T>(r: Attr<T>[], m: Attr<T>[]): Attr<T>[] => m.map(x => ({ ...x, ref: [...new Set(r.filter(y => y.a < x.b && y.b > x.a).map(y => y.ref))].join(' ') }));

  // signals and elevations of the nodes of the path
  const signals: MappedSignal[] = [], elevation: OsmTrack['elevation'] = [];
  path.forEach((id, i) => {
    const t = data.nodes.get(id)!.tags, s = cum[i + pre];
    if (t.railway === 'signal') {
      const kind: MappedSignal['kind'] = t['railway:signal:combined'] ? 'combined' : t['railway:signal:main'] ? 'main' : t['railway:signal:distant'] ? 'distant' : 'other';
      signals.push({ s, kind, ref: `node/${id}`, ...(t.ref ? { name: t.ref } : {}) });
    }
    if (t.ele != null && isFinite(parseFloat(t.ele))) elevation.push({ s, ele: parseFloat(t.ele), ref: `node/${id}` });
  });
  for (const st of list) if (st.ele != null && !elevation.some(e => Math.abs(e.s - st.s) < 50)) elevation.push({ s: st.s, ele: st.ele, ref: st.ref });
  elevation.sort((a, b) => a.s - b.s);

  const out = (r: Attr<any>[], gap?: number) => refs(r, merge(r, gap));
  return {
    origin, plan: xy, len: cum[cum.length - 1], ways,
    stations: list.map(({ d: _d, p: _p, ...s }) => s),
    speed: out(speed), tunnels: out(tunnels, 5), bridges: out(bridges, 5), electrification: out(electr), signalling: out(prot), gauge: out(gauge),
    signals, elevation, stubs,
    extract: { ...(data.timestamp ? { timestamp: data.timestamp } : {}), ...(data.generator ? { generator: data.generator } : {}), elements: data.elements },
    warnings,
  };
}
