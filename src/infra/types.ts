/** Types of the import of the real infrastructure (docs/INFRA_IMPORT.md) */
import type { LineDef } from '../core/types';
import type { LatLon, XY } from './geo';

/**
 * Where an imported datum comes from: taken as it is from a source, derived from source data by a declared rule
 * (a stop marker projected from a station node, a block length from the spacing of the mapped signals), or generated
 * by YuTreno where the sources say nothing (a default speed, a flat profile, a timetable).
 */
export type Provenance = 'source' | 'derived' | 'generated';
export type SourceId = 'osm' | 'rinf' | 'dem' | 'yutreno';

/** A property along the line, from chainage `a` to `b` (m) */
export interface Attr<T> { a: number; b: number; v: T; prov: Provenance; src: SourceId; ref?: string }

export interface ImportedStation {
  name: string;
  /** Stop marker (m) */
  s: number;
  prov: Provenance;
  /** OSM element the position comes from, e.g. `node/123` */
  ref: string;
  /** Altitude of the station node, if tagged */
  ele?: number;
}

export interface MappedSignal { s: number; kind: 'main' | 'distant' | 'combined' | 'other'; ref: string; name?: string }

/** What the OpenStreetMap import finds along the path between the two terminal stations */
export interface OsmTrack {
  /** WGS84 position of the start of the plan */
  origin: LatLon;
  /** Polyline of the line in the local plan (m), stubs included */
  plan: XY[];
  len: number;
  /** Ways of the path in order, each once */
  ways: number[];
  stations: ImportedStation[];
  speed: Attr<number>[];
  tunnels: Attr<true>[];
  bridges: Attr<true>[];
  electrification: Attr<string>[];
  signalling: Attr<string>[];
  gauge: Attr<string>[];
  signals: MappedSignal[];
  elevation: { s: number; ele: number; ref: string }[];
  /** Straight stretches added by YuTreno beyond a terminal station where the mapped track ends too early */
  stubs: [number, number][];
  /** OSM timestamp and generator of the extract, if present */
  extract: { timestamp?: string; generator?: string; elements: number };
  warnings: string[];
}

/** One row of the RINF query of docs/INFRA_IMPORT.md: a track of a section of line */
export interface RinfSection {
  sol: string;
  opStart: string;
  opEnd: string;
  /** Names as registered in RINF */
  opStartName: string;
  opEndName: string;
  length_m?: number;
  maxSpeed_kmh?: number;
  /** ETCS level, national train protection, contact line system, as text */
  etcsLevel?: string;
  protection?: string;
  contactLine?: string;
  /** Mean gradient of the section (‰, positive in the direction opStart → opEnd), if the query provides it */
  gradient?: number;
  /**
   * Gradient profile of the tracks (`era:gradientProfile`): changes of gradient, each one the gradient in ‰ in the
   * direction of the kilometres of the national line and the kilometre from which it holds, as written in RINF:
   * `+19.9(8.275)`
   */
  gradientProfile?: { km: number; g: number }[];
  /** Kilometres of the two operational points on the national line, from `era:hasLrsCoordinate` (`C148 | 9+456`) */
  opStartKm?: number;
  opEndKm?: number;
  lineId?: string;
}

export interface InfraImportOptions {
  /** Names of the terminal stations, as in OSM */
  from: string;
  to: string;
  /** Id and name of the line (default from the station names) */
  id?: string;
  name?: string;
  /** Speed where no source gives one (km/h, default 80) */
  defaultSpeed_kmh?: number;
  /** Speed where both sources give one: 'rinf' (default, the official register) or 'lower' (the lower of the two) */
  speedPolicy?: 'rinf' | 'lower';
  /** Block length where the mapped signals do not give one (m, default 1300) */
  defaultBlock_m?: number;
  /** Also follow ways tagged service=siding|yard|spur|crossover (default false) */
  serviceTracks?: boolean;
  /** Stations further than this from the path are ignored (m, default 300) */
  stationRadius_m?: number;
  /** Description of the elevation model, for the report (default EU-DEM v1.1 25 m through OpenTopoData) */
  demSource?: string;
}

export interface ShareOf { source: number; derived: number; generated: number }

export interface ConsistencyRow { from: string; to: string; osm_m: number; rinf_m: number; diff_pct: number }

export interface InfraReport {
  format: 'yutreno-infra-report';
  version: 1;
  line: { id: string; name: string; length_m: number; from: string; to: string };
  sources: { id: SourceId; description: string; licence: string; attribution: string; elements?: number; timestamp?: string }[];
  /** Metres of line by provenance, for every property */
  shares: Record<'alignment' | 'stations' | 'speed' | 'gradient' | 'tunnels' | 'signals' | 'signalling' | 'electrification', ShareOf>;
  stations: ImportedStation[];
  speed: Attr<number>[];
  gradient: Attr<number>[];
  signalling: Attr<string>[];
  electrification: Attr<string>[];
  signals: { mapped: number; main: number; block_m: number; block_prov: Provenance };
  /** Suggested signalling of the scenario, from the protection systems found */
  suggested_sig: 'ETCS' | 'BACC';
  /** Section lengths of RINF against the chainage of OSM between the same stations */
  consistency: ConsistencyRow[];
  /** Climb from station to station with the gradients of RINF and with the DEM, where both cover the stretch (m) */
  gradient_check: { from: string; to: string; rinf_m: number; dem_m: number }[];
  /** Stretches where OSM gives a speed above the RINF maximum, which RINF caps */
  /** Stretches where the two sources give different speeds, and which one was kept */
  speed_conflicts: { a: number; b: number; osm: number; rinf: number; kept: 'osm' | 'rinf' }[];
  warnings: string[];
}

export interface InfraImport { line: LineDef & { id: string }; report: InfraReport }
