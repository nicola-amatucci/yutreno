/**
 * Open data server of a run: the simulation advances with the clock (or faster) and every request returns the feeds
 * at the current simulated time.
 *   npm run feeds -- --scenario scenarios/services/crossing.json --speed 10 --port 8090
 *   npm run feeds -- --scenario scenarios/services/crossing.json --at 600 --out feeds/   (files at t = 600 s, no server)
 *
 * Endpoints (GET):
 *   /                                     JSON index of the endpoints and state of the run
 *   /gtfs/gtfs.zip                        GTFS static
 *   /gtfs-rt/vehicle-positions            GTFS-Realtime VehiclePositions (protobuf; ?format=json for JSON)
 *   /gtfs-rt/trip-updates                 GTFS-Realtime TripUpdates (protobuf; ?format=json for JSON)
 *   /siri-lite/vehicle-monitoring         SIRI 2.1 VM (XML, SIRI Lite as in the dynamic RAP interface of the Italian
 *   /siri-lite/estimated-timetable          profile, filters LineRef, OperatorRef, datasetId, maxSize); also /siri/...
 *   /netex/timetable.xml                  NeTEx, Italian EPIP profile
 *   /netex/api/v1/convertedNetex          the same, through the interface of the Regional Access Points (RAP) of the
 *   /netex/api/v1/downloadVersion           Italian profile: list of versions and download (gzip or XML)
 *   /railml/timetable.xml                 railML 3.2 timetable
 *   /control-room                         snapshot of the control room (JSON, docs/CONTROL_ROOM.md; ?log=<n> events)
 *
 * The controlled train is driven by the built-in ATO; the service trains by their own driver ('ato'). The run is
 * deterministic: the clock only decides when the feeds are sampled, not what the simulation does.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { FIXED_DT, Simulation, autoDriver, resolveScenario, type ScenarioDef } from '../core';
import {
  DEFAULT_FEED_OPTIONS, encodeFeed, gtfsFiles, gtfsRealtime, netexTimetable, railmlTimetable, siriEstimatedTimetable, siriVehicleMonitoring, zip, type FeedOptions,
} from '../feeds';
import { loadScenarios, parseArgs } from './headless';

const HELP = `Usage: npm run feeds -- [options]
  --scenario <file.json>   scenario with service trains (default scenarios/services/crossing.json)
  --port <n>               HTTP port (default 8090)
  --speed <x>              simulated seconds per second of clock (default 1)
  --date YYYY-MM-DD        service day of the feeds (default ${DEFAULT_FEED_OPTIONS.date})
  --start HH:MM:SS         local time of t = 0 (default ${DEFAULT_FEED_OPTIONS.start})
  --timezone <IANA>        default ${DEFAULT_FEED_OPTIONS.timezone}
  --region <NUTS>          region in the identifiers of the Italian profile (default ${DEFAULT_FEED_OPTIONS.region})
  --codespace <id>         codespace of the identifiers (default ${DEFAULT_FEED_OPTIONS.codespace})
  --vat <number>           VAT number of the operator: Operator identifier as the Italian SIRI profile asks
  --at <s> --out <folder>  instead of serving, runs to t = <s> and writes all the feeds in the folder
`;

/** A run that advances with the built-in ATO on the controlled train */
export class FeedRun {
  sim: Simulation;
  private mem = {};
  private next = 0;
  constructor(readonly def: ScenarioDef) {
    if (def.services?.some(s => s.driver === 'agent')) throw new Error('the feeds server drives the services with the built-in ATO: remove driver "agent"');
    const { line, train, scen } = resolveScenario(def);
    this.sim = new Simulation(line, train, scen, def);
  }
  /** Advances the simulation to time t (s), in fixed steps */
  advance(t: number): void {
    const sim = this.sim;
    while (!sim.done && sim.time + FIXED_DT / 2 < t) {
      if (!sim.S.finished && sim.S.t + 1e-9 >= this.next) { sim.applyCommand(autoDriver(sim.observe(0.2), this.mem)); this.next = sim.S.t + 0.2 - 1e-9; }
      sim.step(FIXED_DT);
      sim.sample();
    }
  }
}

/** All the feeds at the current time of the run (name → content) */
export function feedFiles(sim: Simulation, o: FeedOptions): Record<string, string | Uint8Array> {
  return {
    'gtfs.zip': zip(gtfsFiles(sim, o)),
    'vehicle-positions.pb': encodeFeed(gtfsRealtime(sim, o, 'vehicles')),
    'vehicle-positions.json': JSON.stringify(gtfsRealtime(sim, o, 'vehicles'), null, 1),
    'trip-updates.pb': encodeFeed(gtfsRealtime(sim, o, 'trips')),
    'trip-updates.json': JSON.stringify(gtfsRealtime(sim, o, 'trips'), null, 1),
    'siri-vm.xml': siriVehicleMonitoring(sim, o),
    'siri-et.xml': siriEstimatedTimetable(sim, o),
    'netex.xml': netexTimetable(sim, o),
    'railml.xml': railmlTimetable(sim, o),
  };
}

function options(a: Record<string, string>): FeedOptions {
  const o = { ...DEFAULT_FEED_OPTIONS };
  if (a.date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new Error('--date must be YYYY-MM-DD'); o.date = a.date; }
  if (a.start) { if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(a.start)) throw new Error('--start must be HH:MM:SS'); o.start = a.start; }
  if (a.timezone) { new Intl.DateTimeFormat('en', { timeZone: a.timezone }); o.timezone = a.timezone; }
  if (a.region) o.region = a.region;
  if (a.codespace) o.codespace = a.codespace;
  if (a.vat) o.operator = { ...o.operator, vat: a.vat };
  return o;
}

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { process.stdout.write(HELP); return; }
  const [{ def }] = loadScenarios(a.scenario ?? 'scenarios/services/crossing.json');
  const o = options(a);
  if (a.at != null || a.out != null) {
    if (a.at == null || a.out == null) throw new Error('--at and --out go together');
    const run = new FeedRun(def);
    run.advance(+a.at);
    mkdirSync(a.out, { recursive: true });
    for (const [name, data] of Object.entries(feedFiles(run.sim, o))) writeFileSync(join(a.out, name), data);
    writeFileSync(join(a.out, 'control-room.json'), JSON.stringify(run.sim.controlRoom(), null, 1));
    console.log(`feeds at t = ${run.sim.time.toFixed(1)} s written in ${a.out}`);
    return;
  }
  const port = +(a.port ?? 8090), speed = +(a.speed ?? 1);
  if (!(speed > 0)) throw new Error('--speed must be positive');
  const run = new FeedRun(def), t0 = Date.now();
  // the simulation follows the clock; requests read the state between two advances
  const timer = setInterval(() => { run.advance((Date.now() - t0) / 1000 * speed); if (run.sim.done) clearInterval(timer); }, 50);

  const send = (res: ServerResponse, status: number, type: string, body: string | Uint8Array) => {
    res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const error = (res: ServerResponse, status: number, title: string, detail: string) =>
    send(res, status, 'application/json', JSON.stringify({ title, detail, status, type: 'about:blank' }));

  createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost'), p = url.pathname.replace(/\/+$/, '') || '/', sim = run.sim;
    const json = url.searchParams.get('format') === 'json';
    if (req.method !== 'GET') return error(res, 405, 'Method not allowed', 'only GET');
    switch (p) {
      case '/':
        return send(res, 200, 'application/json', JSON.stringify({
          scenario: def.name, time_s: +sim.time.toFixed(1), done: sim.done, speed, date: o.date, start: o.start, timezone: o.timezone,
          trains: sim.trains.map(r => ({ id: r.id, active: r.active, finished: r.S.finished, s_m: +r.S.s.toFixed(1), speed_kmh: +(r.S.v * 3.6).toFixed(1) })),
          endpoints: ['/gtfs/gtfs.zip', '/gtfs-rt/vehicle-positions', '/gtfs-rt/trip-updates', '/siri-lite/vehicle-monitoring', '/siri-lite/estimated-timetable',
            '/netex/timetable.xml', '/railml/timetable.xml', '/control-room', '/netex/api/v1/convertedNetex', '/netex/api/v1/downloadVersion?level=1&agencyCode=' + o.codespace],
        }, null, 1));
      case '/gtfs/gtfs.zip': return send(res, 200, 'application/zip', zip(gtfsFiles(sim, o)));
      case '/control-room': {
        const n = Number(url.searchParams.get('log') ?? 200);
        return send(res, 200, 'application/json', JSON.stringify(sim.controlRoom(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 200)));
      }
      case '/gtfs-rt/vehicle-positions':
      case '/gtfs-rt/trip-updates': {
        const m = gtfsRealtime(sim, o, p.endsWith('positions') ? 'vehicles' : 'trips');
        return json ? send(res, 200, 'application/json', JSON.stringify(m)) : send(res, 200, 'application/x-protobuf', encodeFeed(m));
      }
      case '/siri-lite/vehicle-monitoring': case '/siri/vehicle-monitoring':
      case '/siri-lite/estimated-timetable': case '/siri/estimated-timetable': {
        // filters of the dynamic RAP interface of the Italian profile
        const g = (k: string) => url.searchParams.get(k) ?? undefined;
        const q = { LineRef: g('LineRef'), OperatorRef: g('OperatorRef'), datasetId: g('datasetId'), maxSize: g('maxSize') != null ? +(g('maxSize') as string) : undefined };
        return send(res, 200, 'application/xml; charset=utf-8', p.endsWith('monitoring') ? siriVehicleMonitoring(sim, o, q) : siriEstimatedTimetable(sim, o, q));
      }
      case '/netex/timetable.xml': return send(res, 200, 'application/xml; charset=utf-8', netexTimetable(sim, o));
      case '/railml/timetable.xml': return send(res, 200, 'application/xml; charset=utf-8', railmlTimetable(sim, o));
      case '/netex/api/v1/convertedNetex':
        return send(res, 200, 'application/json', JSON.stringify([{ agencyCode: o.codespace, convertionDate: `${o.date} 00:00:00`, idVersion: 1, xsdVersion: 1 }]));
      case '/netex/api/v1/downloadVersion': {
        const level = url.searchParams.get('level'), agency = url.searchParams.get('agencyCode'), gz = url.searchParams.get('gzVersion') !== 'false';
        if (level !== '1' && level !== '2') return error(res, 400, 'Bad request', 'level must be 1 or 2');
        if (agency !== o.codespace) return error(res, 404, 'Not found', `unknown agencyCode; available: ${o.codespace}`);
        const x = netexTimetable(sim, o);
        return gz ? send(res, 200, 'application/gzip', gzipSync(x)) : send(res, 200, 'application/xml; charset=utf-8', x);
      }
      case '/netex/api/v1/xsdzip':
        return error(res, 404, 'Not found', 'the schemas are those of the Italian NeTEx profile, https://github.com/5Tsrl/netex-italian-profile');
      default: return error(res, 404, 'Not found', p);
    }
  }).listen(port, () => console.log(`YuTreno feeds on http://localhost:${port}/ (scenario ${def.name}, ×${speed})`));
}

const isMain = process.argv[1] && /feeds-server\.ts$/.test(process.argv[1]);
if (isMain) try { main(); } catch (e) { console.error(String((e as Error)?.message ?? e)); process.exit(1); }
