// Golden master of the page (phase 8, R3): the safety net of the refactoring of the interface. In a real browser,
// from the build in dist/ (first: npm run build), with the clock of the page replaced by a manual one so that the
// page is a function of what the check does, it records for a set of states:
//   - the text and the values of the fields of every tab;
//   - in the Drive tab, the description of the 3D scene (YuTreno.scene3d(): objects, transforms, geometries,
//     instances, materials) after two frames.
// The states: the page as it opens; the default run at 300 s; the branch network (automatic block) at 1000 s, also
// riding R 3101 on the branch; a run with rain; the real network riding R 7101 on its second line.
//   node scripts/page-golden.mjs            compares with golden/page.json (exit 1 on any difference)
//   node scripts/page-golden.mjs --update   writes golden/page.json
// Requires Playwright with Chromium, as scripts/page-checks.mjs (CHROME=/usr/bin/google-chrome to use a system one).
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'golden', 'page.json');
const update = process.argv.includes('--update');
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const TABS = ['drive', 'line', 'train', 'scenarios', 'timetable', 'control', 'controller', 'data'];

const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// the clock of the page: time moves only when the check runs a frame
await p.addInitScript(() => {
  let t = 1000;
  const q = [];
  performance.now = () => t;
  Date.now = () => 1_800_000_000_000 + t;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__frame = (ms = 16) => { t += ms; const c = q.splice(0); for (const f of c) f(t); };
  Math.random = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
});
await p.goto(pathToFileURL(join(root, 'dist', 'yutreno.html')).href);
for (let i = 0; i < 3; i++) await p.evaluate(() => window.__frame());

const frames = n => p.evaluate(n => { for (let i = 0; i < n; i++) window.__frame(); }, n);
const show = async tab => { await p.evaluate(t => { location.hash = '#' + t; }, tab); await p.waitForTimeout(50); await frames(2); };
/** Text and fields of a tab */
const tabState = tab => p.evaluate(t => {
  const el = document.getElementById('tab-' + t);
  const fields = [...el.querySelectorAll('input,select,textarea')].map(f => (f.id || f.name || f.type) + '=' + (f.type === 'checkbox' || f.type === 'radio' ? f.checked : f.value));
  return { text: el.innerText, fields: fields.join('\n') };
}, tab);
/** Advances the run to time `at` with the built-in style driver of page-checks.mjs (the page itself stays paused) */
const advance = at => p.evaluate(at => {
  document.getElementById('brief').hidden = true;
  const sim = window.YuTreno.simulation(), mem = {}; let next = 0;
  const drive = o => { const c = {}; if (o.vigilance_alarm) c.vigilance = true; if (o.emergency || o.doors_open) return Object.assign(c, { traction: 0, brake: .5 });
    let vt = o.supervision.v_permitted_ms - 2; const tg = o.supervision.target; if (tg && tg.speed_ms === 0) vt = Math.min(vt, Math.sqrt(2 * .45 * Math.max(0, tg.distance_m - 25)));
    const st = o.next_stop; if (st) { const d = st.pos_m - o.pos_m; if (d < 600) vt = Math.min(vt, Math.max(d > 2 ? .8 : 0, Math.sqrt(2 * .45 * Math.max(0, d - .5)))); if (d < .6) return Object.assign(c, { traction: 0, brake: 1 }); }
    const er = vt - o.vel_ms; mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + er * o.dt)); const u = .55 * er + .08 * mem.i; return u >= 0 ? Object.assign(c, { traction: Math.min(1, u), brake: 0 }) : Object.assign(c, { traction: 0, brake: Math.min(1, -u * .8) }); };
  while (sim.time < at && !sim.done) { if (!sim.S.finished && sim.S.t + 1e-9 >= next) { sim.applyCommand(drive(sim.observe(.2))); next = sim.S.t + .2 - 1e-9; } sim.step(); }
}, at);
const scenario = async id => {
  await show('scenarios');
  await p.selectOption('#scnSel', id);
  await p.click('#scnApply');
  await frames(2);
};
const ride = async id => { await show('drive'); await p.selectOption('#scRide', id); await frames(3); };

const now = {};
const record = async (state, tabs, scene = true) => {
  for (const t of tabs) {
    await show(t);
    const s = await tabState(t);
    now[`${state}#${t}`] = { text: sha(s.text), fields: sha(s.fields), text_start: s.text.slice(0, 120).replace(/\s+/g, ' ') };
  }
  if (scene) {
    await show('drive');
    const d = await p.evaluate(() => window.YuTreno.scene3d());
    const rideChip = await p.evaluate(() => { const h = document.getElementById('hudRide'); return h.hidden ? '' : h.textContent; });
    now[`${state}#scene`] = { objects: d.length, scene: sha(d.join('\n')), ride: rideChip.replace(/ · \d+ km\/h.*/, ''), lines: d };
  }
};

await record('open', TABS);
await advance(300);
await record('default-300s', ['drive', 'timetable', 'control']);
await scenario('services/branch');
await advance(1000);
await record('branch-1000s', ['drive', 'timetable', 'control']);
await ride('R 3101');
await record('branch-1000s-ride-R3101', ['drive'], true);
await ride('');
await scenario('wet-descent-worksite');
await advance(400);
await record('rain-400s', ['drive']);
await scenario('services/benevento');
await advance(1500);
await ride('R 7101');
await record('benevento-1500s-ride-R7101', ['drive', 'control']);

await b.close();
if (errors.length) { console.log('errors in the page:\n' + errors.join('\n')); process.exit(1); }
const slim = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([f]) => f !== 'lines'))]));
if (update) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(slim(now), null, 1) + '\n');
  writeFileSync(join(root, 'golden', 'page-scene.txt'), Object.entries(now).filter(([, v]) => v.lines).map(([k, v]) => `## ${k}\n${v.lines.join('\n')}`).join('\n') + '\n');
  console.log(`page golden: ${Object.keys(now).length} states written to golden/page.json`);
  process.exit(0);
}
if (!existsSync(FILE)) { console.log('golden/page.json missing: run with --update first'); process.exit(1); }
const old = JSON.parse(readFileSync(FILE, 'utf8')), cur = slim(now), diffs = [];
for (const k of new Set([...Object.keys(old), ...Object.keys(cur)])) {
  const a = old[k], c = cur[k];
  if (!a || !c) { diffs.push(`${k}: ${a ? 'missing' : 'new'}`); continue; }
  const parts = Object.keys({ ...a, ...c }).filter(f => f !== 'text_start' && a[f] !== c[f]);
  if (parts.length) diffs.push(`${k}: ${parts.map(f => `${f} ${a[f]} → ${c[f]}`).join(', ')}`);
}
if (diffs.length) {
  console.log(diffs.join('\n'));
  // the scene lines of the states that changed, to see what moved
  mkdirSync(join(root, 'results'), { recursive: true });
  writeFileSync(join(root, 'results', 'page-scene-now.txt'), Object.entries(now).filter(([, v]) => v.lines).map(([k, v]) => `## ${k}\n${v.lines.join('\n')}`).join('\n') + '\n');
  console.log(`page golden: ${diffs.length} of ${Object.keys(cur).length} states differ (scene now in results/page-scene-now.txt, before in golden/page-scene.txt)`);
  process.exit(1);
}
console.log(`page golden: ${Object.keys(cur).length} states identical to golden/page.json`);
