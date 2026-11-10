/**
 * Control table in the style of RFI («Tabella delle Condizioni») and translator to the routes of the interlocking.
 *
 * The designer describes each site (a station, or the line for the block) as is done for an Italian computer-based
 * interlocking (ACC): the field elements (points with their normal position, track circuits, signals or stop
 * markers) and, for every route, its origin and end, the points with the required position (1N, 2R), the track
 * circuits to prove vacant, the overlap beyond the end, the diverging speed, the conflicting routes and the release
 * mode. The format is a reconstruction of Italian practice made for YuTreno, to be validated by people who know
 * it: it is not an RFI document.
 *
 * `translateControlTables()` produces the configuration of the interlocking: sections, points and markers with
 * their positions, and routes with the identifiers of the elements used towards the field (SCI-P, SCI-TDS).
 * Declared conflicts are completed with those that follow from shared elements.
 */
import type { PointConfig, RouteConfig, MarkerConfig, TvpsConfig } from './types';

export interface ControlTable {
  /** Name of the site (station or line) and its index in the timetable, null for the line */
  site: string;
  station: number | null;
  elements: {
    points: { number: string; chainage_m: number; normal: 'right' | 'left'; reverse_to: string; type: 'diverging' | 'converging' | 'junction'; move_time_s: number; junction?: string }[];
    /** Track circuits (or axle-counter sections) with the track they are on: 'I', 'II'… */
    track_circuits: { name: string; from_m: number; to_m: number; track: string }[];
    /** Signals or ETCS stop markers with their track */
    signals: { name: string; chainage_m: number; track: string; direction?: 'reverse'; /** Marker at a node of a network: id of the boundary */ node?: string }[];
  };
  routes: {
    number: string;
    designation: string;
    type: 'departure' | 'entry' | 'arrival' | 'block';
    /** Origin and end signal or marker */
    from: string;
    to: string;
    /** Points with their position: '1N' normal, '2R' reverse */
    points: string[];
    /** Track circuits to prove vacant along the route, in order */
    track_circuits: string[];
    /** Overlap beyond the end signal or marker */
    overlap_path: { length_m: number; track_circuits: string[] };
    diverging_speed_kmh: number | null;
    conflicting: string[];
    /** Sectional release (progressive, as the train passes) or release of the whole route */
    release_mode: 'sectional' | 'whole_route';
    automatic?: boolean;
    /** Route for trains running towards the origin of the line (default: the nominal direction) */
    direction?: 'reverse';
    /** Single-track segment of the line the route enters (departures and block), for the block consent */
    line_segment?: number;
    /** Node route of a network: towards the line with this id (out) or from it (in) */
    link?: { line: string; side: 'out' | 'in'; boundary: string };
  }[];
}

/**
 * Name of the branch used by the interlocking and the field: track I is the main track shared by the whole line,
 * '*' marks a points zone (occupied whatever branch the train took), the other tracks belong to their station.
 */
export const branch = (site: string, track: string): string => (track === 'I' || track === '*' ? track : track + ':' + site);

export interface Translation {
  tvps: TvpsConfig[];
  points: PointConfig[];
  markers: MarkerConfig[];
  routes: RouteConfig[];
  /** Inconsistencies found in the tables (elements referenced but not declared, unknown positions) */
  warnings: string[];
}

/** Translates one or more control tables into the configuration of the interlocking */
export function translateControlTables(tables: ControlTable[]): Translation {
  const out: Translation = { tvps: [], points: [], markers: [], routes: [], warnings: [] };
  const pointPos = new Map<string, number>();
  // signals of every site: routes may refer to elements of another site as «Site/name» (the line block of the reverse
  // direction runs over the first sections owned by the departures of the stations)
  const allSignals = new Map<string, { chainage_m: number; track: string; site: string }>();
  for (const t of tables) for (const s of t.elements.signals) allSignals.set(t.site + '/' + s.name, { ...s, site: t.site });
  for (const t of tables) {
    const id = (n: string) => (n.includes('/') ? n : t.site + '/' + n);
    for (const d of t.elements.points) {
      out.points.push({ id: id(d.number), s_m: d.chainage_m, normal: d.normal, reverse_branch: branch(t.site, d.reverse_to), type: d.type, move_time_s: d.move_time_s, ...(d.junction ? { junction: d.junction } : {}) });
      pointPos.set(id(d.number), d.chainage_m);
    }
    for (const c of t.elements.track_circuits) out.tvps.push({ id: id(c.name), from_m: c.from_m, to_m: c.to_m, branch: branch(t.site, c.track) });
    for (const s of t.elements.signals) out.markers.push({ id: id(s.name), s_m: s.chainage_m, branch: branch(t.site, s.track), ...(s.direction === 'reverse' ? { dir: -1 as const } : {}), ...(s.node ? { node: s.node } : {}) });
    const signals = new Map<string, { chainage_m: number; track: string; site?: string }>(t.elements.signals.map(s => [s.name, s]));
    for (const [k, v] of allSignals) if (k.includes('/')) signals.set(k, v);
    const tcNames = new Set(t.elements.track_circuits.map(c => c.name));
    for (const r of t.routes) {
      const from = signals.get(r.from), to = signals.get(r.to);
      if (!from || !to) { out.warnings.push(`${t.site}, route ${r.number}: origin or end signal not declared`); continue; }
      const points = r.points.map(x => {
        const m = /^(.+?)([NR])$/.exec(x);
        if (!m || !t.elements.points.some(d => d.number === m[1])) out.warnings.push(`${t.site}, route ${r.number}: point «${x}» not declared`);
        return { id: id(m ? m[1] : x), position: (m ? m[2] : 'N') as 'N' | 'R' };
      });
      for (const c of [...r.track_circuits, ...r.overlap_path.track_circuits]) if (!c.includes('/') && !tcNames.has(c)) out.warnings.push(`${t.site}, route ${r.number}: track circuit «${c}» not declared`);
      const branchStart = branch(from.site ?? t.site, from.track), branchEnd = branch(to.site ?? t.site, to.track);
      const speeds: [number, number, number][] = [];
      if (r.diverging_speed_kmh != null) {
        // the stretch run on the diverging branch: from the reversed points (±10 m) to the end of the route on the loop
        const rev = points.filter(d => d.position === 'R').map(d => pointPos.get(d.id) as number);
        if (rev.length) {
          const xs = [Math.min(...rev) - 10, Math.max(...rev) + 10];
          if (branchStart !== 'I') xs.push(from.chainage_m);
          if (branchEnd !== 'I') xs.push(to.chainage_m);
          speeds.push([Math.min(...xs), Math.max(...xs), r.diverging_speed_kmh]);
        }
      }
      out.routes.push({
        id: id(r.number), name: r.designation, type: r.type, station: t.station,
        start_m: from.chainage_m, end_m: to.chainage_m, branch_start: branchStart, branch_end: branchEnd,
        points, tvps: r.track_circuits.map(id), overlap_m: r.overlap_path.length_m, tvps_overlap: r.overlap_path.track_circuits.map(id),
        speeds, incompatible: r.conflicting.map(id), automatic: !!r.automatic,
        ...(r.direction === 'reverse' ? { dir: -1 as const } : {}), ...(r.line_segment != null ? { segment: r.line_segment } : {}),
        ...(r.link ? { link: { ...r.link } } : {}),
      });
    }
  }
  // conflicts that follow from the elements: the same point in different positions, or shared sections
  const rs = out.routes;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    const pointConflict = a.points.some(x => b.points.some(y => y.id === x.id && y.position !== x.position));
    const tvpsShared = a.tvps.some(x => b.tvps.includes(x));
    // opposing movements: the overlap of one must not be the path of the other
    const opposing = (a.dir ?? 1) !== (b.dir ?? 1) && (a.tvps_overlap.some(x => b.tvps.includes(x)) || b.tvps_overlap.some(x => a.tvps.includes(x)));
    if (pointConflict || tvpsShared || opposing) {
      if (!a.incompatible.includes(b.id)) a.incompatible.push(b.id);
      if (!b.incompatible.includes(a.id)) b.incompatible.push(a.id);
    }
  }
  return out;
}
