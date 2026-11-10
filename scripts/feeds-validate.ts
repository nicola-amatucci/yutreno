/**
 * Validation of the feeds with the official tools, outside `npm run verify` because it needs Java, xmllint and the
 * schemas downloaded apart:
 *   git clone --depth 1 https://github.com/5Tsrl/netex-italian-profile ext/netex-italian-profile
 *   git clone --depth 1 https://github.com/SIRI-CEN/SIRI ext/SIRI
 *   download gtfs-validator-<version>-cli.jar from https://github.com/MobilityData/gtfs-validator/releases
 *   npx tsx scripts/feeds-validate.ts --netex ext/netex-italian-profile --siri ext/SIRI --gtfs-validator gtfs-validator-cli.jar
 * Writes the feeds of every service scenario at several times in results/feeds/ and validates them: NeTEx against
 * xsd/NeTEx_publication_EPIP.xsd of the Italian profile, SIRI against xsd/siri.xsd, GTFS with the MobilityData
 * validator (errors fail, warnings are listed). With --railml <folder> containing railml3.xsd (railML 3.2, from
 * railML.org) the railML export is validated too. Missing tools are skipped with a message.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DEFAULT_FEED_OPTIONS as O } from '../src/feeds';
import { FeedRun, feedFiles } from '../src/server/feeds-server';
import { loadScenarios, parseArgs } from '../src/server/headless';

const a = parseArgs(process.argv.slice(2));
const out = resolve(a.output ?? 'results/feeds');
const has = (cmd: string, arg = '--version') => spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;
let failed = false;

const xml: { file: string; kind: 'netex' | 'siri' | 'railml' }[] = [], gtfs: string[] = [];
for (const { file, def } of loadScenarios('scenarios/services')) {
  for (const t of [0, 300, 600, 1e5]) {
    const run = new FeedRun(def);
    run.advance(t);
    const dir = join(out, basename(file, '.json'), String(t === 1e5 ? 'end' : t));
    mkdirSync(dir, { recursive: true });
    for (const [name, data] of Object.entries(feedFiles(run.sim, O))) writeFileSync(join(dir, name), data);
    xml.push({ file: join(dir, 'netex.xml'), kind: 'netex' }, { file: join(dir, 'siri-vm.xml'), kind: 'siri' }, { file: join(dir, 'siri-et.xml'), kind: 'siri' });
    if (t === 0) xml.push({ file: join(dir, 'railml.xml'), kind: 'railml' });
    if (t === 0) gtfs.push(join(dir, 'gtfs.zip'));
  }
}
console.log(`${xml.length} XML files and ${gtfs.length} GTFS feeds in ${out}`);

if (!has('xmllint')) console.log('xmllint not found: XML validation skipped');
else for (const [kind, root, xsd] of [['netex', a.netex, 'xsd/NeTEx_publication_EPIP.xsd'], ['siri', a.siri, 'xsd/siri.xsd'], ['railml', a.railml, 'railml3.xsd']] as const) {
  if (!root || !existsSync(join(root, xsd))) { console.log(`--${kind} <folder> not given or without ${xsd}: skipped`); continue; }
  const files = xml.filter(x => x.kind === kind).map(x => x.file);
  // xmllint resolves the includes of the schema relative to the current folder
  const r = spawnSync('xmllint', ['--noout', '--schema', xsd, ...files], { cwd: root, encoding: 'utf8' });
  const ok = (r.stderr.match(/ validates$/gm) ?? []).length;
  console.log(`${kind}: ${ok}/${files.length} valid against ${xsd}`);
  if (ok !== files.length) { failed = true; console.log(r.stderr.split('\n').filter(l => !/validates$|parser warning|Skipping import/.test(l)).slice(0, 20).join('\n')); }
}

if (!a['gtfs-validator'] || !has('java', '-version')) console.log('--gtfs-validator <jar> not given or java not found: GTFS validation skipped');
else for (const z of gtfs) {
  const dir = z.replace(/\.zip$/, '-report');
  spawnSync('java', ['-jar', a['gtfs-validator'], '-i', z, '-o', dir], { stdio: 'ignore' });
  const rep = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as { notices: { code: string; severity: string; totalNotices: number }[] };
  const errors = rep.notices.filter(n => n.severity === 'ERROR');
  console.log(`gtfs ${z.slice(out.length + 1)}: ${errors.length} errors; warnings ${rep.notices.filter(n => n.severity === 'WARNING').map(n => n.code).join(', ') || 'none'}`);
  if (errors.length) { failed = true; console.log(errors.map(e => `  ${e.code} (${e.totalNotices})`).join('\n')); }
}
process.exit(failed ? 1 : 0);
