/**
 * Writes scenarios/services/benevento.json: the network of the two real lines imported in examples/infra, Cancello –
 * Benevento (main line) and Avellino – Benevento, which meet at Benevento (docs/INFRA_IMPORT.md). The lines are written
 * in full into the scenario, with their attribution, so that the scenario is self-contained. The timetables are the
 * ones the import generates from the speed limits; no real timetable of trains exists for these lines in 2026.
 *   npx tsx scripts/real-network.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { LineDef, ScenarioDef, ServiceDef } from '../src/core';

type Line = LineDef & { id: string };
export function beneventoScenario(): ScenarioDef {
  const cb: Line = JSON.parse(readFileSync('examples/infra/cancello-benevento/line.json', 'utf8'));
  const ab: Line = JSON.parse(readFileSync('examples/infra/avellino-benevento/line.json', 'utf8'));
  // R 7101 Avellino → Benevento, 15 minutes after the controlled train leaves Cancello
  const t1 = 900;
  const r7101: ServiceDef = {
    id: 'R 7101', train: 'regional', route: [ab.id],
    stops: ab.stations.map((s, i) => i === 0 ? { station: s.name, departure_s: t1 }
      : i === ab.stations.length - 1 ? { station: s.name, arrival_s: s.arr! + t1 } : { station: s.name, arrival_s: s.arr! + t1, departure_s: s.dep! + t1 }),
  };
  // R 7102 Benevento → Cancello, in connection with R 7101: it crosses the controlled train on the single track
  const t2 = 3300, st = cb.stations, back: ServiceDef['stops'] = [{ station: st[st.length - 1].name, departure_s: t2 }];
  let t = t2;
  for (let i = st.length - 2; i >= 0; i--) {
    t += st[i + 1].arr! - st[i].dep!;
    if (i > 0) { back.push({ station: st[i].name, arrival_s: t, departure_s: t + 30 }); t += 30; } else back.push({ station: st[i].name, arrival_s: t });
  }
  const r7102: ServiceDef = { id: 'R 7102', train: 'regional', route: [cb.id], stops: back };
  return {
    name: 'Benevento: two real lines',
    description: 'Network of two real lines imported from OpenStreetMap, RINF and EU-DEM (examples/infra), Cancello – Benevento and Avellino – Benevento, which meet at Benevento; automatic block. The controlled train runs from Cancello to Benevento. R 7101 runs from Avellino to Benevento, and R 7102 leaves Benevento for Cancello in connection with it, crossing the controlled train on the single track. The timetables are generated from the speed limits: no real timetable of trains exists for these lines in 2026.',
    network: { name: 'Cancello – Benevento – Avellino', lines: [cb, ab] },
    train: 'regional',
    signalling: 'BACC',
    leader: { on: false },
    services: [r7101, r7102],
    connections: [{ station: 'Benevento', from_service: 'R 7101', to_service: 'R 7102', transfer_s: 120, max_wait_s: 600 }],
  };
}

/** The scenario as written in the file: indented, with the two lines of the network on one line each */
export function beneventoJson(): string {
  const sc = beneventoScenario(), net = sc.network as { name: string; lines: Line[] };
  const lines = net.lines.map(l => '   ' + JSON.stringify(l)).join(',\n');
  return JSON.stringify({ ...sc, network: '__NET__' }, null, 1).replace('"__NET__"', `{"name": ${JSON.stringify(net.name)}, "lines": [\n${lines}\n  ]}`) + '\n';
}

if (process.argv[1] && /real-network\.ts$/.test(process.argv[1])) {
  writeFileSync('scenarios/services/benevento.json', beneventoJson());
  console.log('scenarios/services/benevento.json written');
}
