// Checks of the page added in phase 7, in a real browser, from the build in dist/ (first: npm run build), failing on
// any error of the page and saving screenshots (docs/CONTROL_ROOM.md, docs/GUIDE.md):
//   1. Scenarios tab, "Make a scenario": a line, four trains in both directions and passengers make a valid scenario
//   2. Drive tab: the passenger chip shows who boards and alights at a stop of the driven train
//   3. Control room: people waiting at the stations and on board of every train
//   4. Choosing a train in the control room highlights it in the space-time diagram
//   5. Riding in the cab of another train: the 3D view follows R 101, also running back (R 102), the driver keeps the lever
//   6. Dispatcher in the control room: a speed restriction and a train held, recorded with their time
//   7. "Make a scenario" with a real line and its real timetable
//   8. Riding in the cab of a train on another line of a network: the 3D world is rebuilt from that line
// Requires Playwright with Chromium, as scripts/control-room-shots.mjs:
//   npm install --no-save playwright && npx playwright install chromium && node scripts/page-checks.mjs
//   CHROME=/usr/bin/google-chrome node scripts/page-checks.mjs [--out <folder>] (default results/page-checks)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = join(root, arg('--out', 'results/page-checks'));
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(pathToFileURL(join(root, 'dist', 'yutreno.html')).href);
await p.waitForTimeout(800);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

/** Advances the run in the page to time `at` with a simple driver (as control-room-shots.mjs) and, if `stopAt`, stops at the first stop with doors open after it */
const advance = (at, untilDoors = false) => p.evaluate(([at, untilDoors]) => {
  document.getElementById('brief').hidden = true;
  const sim = window.YuTreno.simulation(), mem = {}; let next = 0;
  const drive = (o) => { const c = {}; if (o.vigilance_alarm) c.vigilance = true; if (o.emergency || o.doors_open) return Object.assign(c, { traction: 0, brake: .5 });
    let vt = o.supervision.v_permitted_ms - 2; const tg = o.supervision.target; if (tg && tg.speed_ms === 0) vt = Math.min(vt, Math.sqrt(2 * .45 * Math.max(0, tg.distance_m - 25)));
    const st = o.next_stop; if (st) { const d = st.pos_m - o.pos_m; if (d < 600) vt = Math.min(vt, Math.max(d > 2 ? .8 : 0, Math.sqrt(2 * .45 * Math.max(0, d - .5)))); if (d < .6) return Object.assign(c, { traction: 0, brake: 1 }); }
    const er = vt - o.vel_ms; mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + er * o.dt)); const u = .55 * er + .08 * mem.i; return u >= 0 ? Object.assign(c, { traction: Math.min(1, u), brake: 0 }) : Object.assign(c, { traction: 0, brake: Math.min(1, -u * .8) }); };
  while (sim.time < at && !sim.done) {
    if (untilDoors && sim.time > 60 && sim.S.doors) break;
    if (!sim.S.finished && sim.S.t + 1e-9 >= next) { sim.applyCommand(drive(sim.observe(.2))); next = sim.S.t + .2 - 1e-9; }
    sim.step(1 / 200); sim.sample();
  }
  return sim.time;
}, [at, untilDoors]);

// 1
await p.evaluate(() => { location.hash = '#scenarios'; });
await p.waitForTimeout(300);
await p.selectOption('#mkLine', 'valle-lauro');
await p.fill('#mkCount', '4'); await p.fill('#mkHead', '10'); await p.selectOption('#mkDir', 'both');
await p.fill('#mkPax', '900'); await p.selectOption('#mkArr', 'poisson');
await p.click('#mkApply');
await p.waitForTimeout(200);
const made = await p.evaluate(() => { const sc = window.YuTreno.simulation().scenario; return { services: sc?.services?.length ?? 0, demand: sc?.passengers?.demand?.length ?? 0, msg: document.getElementById('mkMsg').textContent }; });
check(made.services === 4 && made.demand === 12, `make a scenario: ${made.services} services, ${made.demand} flows of passengers (${made.msg})`);
await p.screenshot({ path: join(OUT, '1-make-scenario.png') });

// 2
await p.evaluate(() => { location.hash = '#drive'; });
await advance(205);
await p.waitForTimeout(500);
await p.screenshot({ path: join(OUT, '2-platform-people.png') });
const t = await advance(400, true);
await p.waitForTimeout(400);
const chip = await p.evaluate(() => ({ hidden: document.getElementById('hudPax').hidden, text: document.getElementById('hudPax').textContent }));
check(!chip.hidden && /off · \d+ on · \d+ on board/.test(chip.text), `drive: passenger chip at the stop at ${t.toFixed(0)} s: «${chip.text}»`);
await p.screenshot({ path: join(OUT, '2-drive-stop.png') });

// 3
await advance(1300);
await p.evaluate(() => { location.hash = '#control'; });
await p.waitForSelector('#crMap .cr-wait', { timeout: 5000 }).catch(() => {});
await p.waitForTimeout(400);
const cr = await p.evaluate(() => ({ waiting: document.querySelectorAll('#crMap .cr-wait').length, pax: [...document.querySelectorAll('#crTrains td')].filter(td => /on board/.test(td.textContent)).length }));
check(cr.waiting === 4 && cr.pax >= 3, `control room: ${cr.waiting} stations with people waiting, ${cr.pax} trains with people on board`);
await p.screenshot({ path: join(OUT, '3-control-room.png'), fullPage: true });

// 4
await p.click('#crTrains tr[data-train="R 101"]');
await p.evaluate(() => { location.hash = '#timetable'; });
await p.waitForTimeout(600);
const sel = await p.evaluate(() => document.querySelector('#crTrains tr.sel')?.getAttribute('data-train'));
check(sel === 'R 101', 'control room: R 101 chosen and highlighted in the space-time diagram');
await p.screenshot({ path: join(OUT, '4-timetable-highlight.png') });

// 5
await p.evaluate(() => { location.hash = '#drive'; document.getElementById('summary').hidden = true; });
await p.waitForTimeout(300);
for (const id of ['R 101', 'R 102']) {
  await p.selectOption('#scRide', id);
  await p.waitForTimeout(500);
  const ride = await p.evaluate(() => document.getElementById('hudRide').textContent);
  check(ride.startsWith('In the cab of ' + id), `ride: «${ride}»`);
  await p.screenshot({ path: join(OUT, `5-ride-${id.replace(' ', '-')}.png`) });
}
await p.selectOption('#scRide', '');
await p.waitForTimeout(300);
check(await p.evaluate(() => document.getElementById('hudRide').hidden), 'ride: back in the driven train');

// 6
await p.evaluate(() => { location.hash = '#control'; });
await p.waitForTimeout(300);
await p.fill('#dpFrom', '9.0'); await p.fill('#dpTo', '10.0'); await p.fill('#dpV', '40');
await p.click('#dpTsr');
await p.click('#crTrains tr[data-train="R 103"]');
await p.click('#dpHold');
await p.waitForTimeout(300);
const dp = await p.evaluate(() => ({ n: window.YuTreno.simulation().dispatched.length, msg: document.getElementById('dpMsg').textContent, count: document.getElementById('dpCount').textContent, log: [...document.querySelectorAll('#crLog li')].map(li => li.textContent).filter(t => /Dispatcher/.test(t)).length }));
check(dp.n === 2 && dp.count === '2' && dp.log >= 2, `dispatcher: ${dp.n} commands recorded and in the log (${dp.msg})`);
await p.screenshot({ path: join(OUT, '6-dispatcher.png'), fullPage: true });
// the commands written into the scenario, applied from the Scenario tab: the new run has them as events
await p.evaluate(() => { document.getElementById('dpLog').closest('details').open = true; });
await p.click('#dpScenario');
await p.evaluate(() => { location.hash = '#scenarios'; });
await p.waitForTimeout(200);
await p.click('#scnFromJson');
await p.waitForTimeout(300);
const ev = await p.evaluate(() => window.YuTreno.simulation().scenarioEvents.filter(e => e.def.type === 'dispatch').map(e => e.def.dispatch.type));
check(ev.join(',') === 'speed_restriction,retime', `dispatcher commands as scenario events: ${ev.join(', ')}`);

// 7
await p.evaluate(() => { location.hash = '#scenarios'; });
await p.waitForTimeout(300);
await p.selectOption('#mkLine', 'real:salerno-mercato-s-severino');
await p.selectOption('#mkReal', 'real'); await p.fill('#mkFrom', '07:00'); await p.fill('#mkCount', '3'); await p.fill('#mkPax', '0');
await p.click('#mkApply');
await p.waitForTimeout(200);
const real = await p.evaluate(() => { const sc = window.YuTreno.simulation().scenario; return { ids: (sc?.services ?? []).map(s => s.id), line: window.YuTreno.simulation().L.def.name }; });
check(real.ids.join(',') === '5021,5010,5001' && /Salerno/.test(real.line), `real timetable: trips ${real.ids.join(', ')} on ${real.line}`);

// 8
await p.evaluate(() => { location.hash = '#scenarios'; });
await p.waitForTimeout(200);
await p.selectOption('#scnSel', 'services/benevento');
await p.click('#scnApply');
await p.evaluate(() => { location.hash = '#drive'; document.getElementById('summary').hidden = true; });
await advance(1500);
await p.selectOption('#scRide', 'R 7101');
await p.waitForTimeout(800);
const other = await p.evaluate(() => document.getElementById('hudRide').textContent);
check(/^In the cab of R 7101 on Avellino/.test(other), `ride on another line of the network: «${other}»`);
await p.screenshot({ path: join(OUT, '8-ride-other-line.png') });
await p.selectOption('#scRide', '');
await p.waitForTimeout(500);
check(await p.evaluate(() => document.getElementById('hudRide').hidden), 'ride: back in the driven train, on the main line');

check(!errors.length, `no errors in the page${errors.length ? ': ' + errors.join(' | ') : ''}`);
await b.close();
console.log(failed ? `${failed} checks failed` : `page: every check passed, screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
