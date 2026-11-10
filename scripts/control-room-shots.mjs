// Opens the control room with every scenario included in the page, advances the run and saves a screenshot, failing on
// any error of the page (docs/CONTROL_ROOM.md). From the build in dist/ (first: npm run build).
// Requires Playwright with Chromium, which is not among the project dependencies:
//   npm install --no-save playwright && npx playwright install chromium && node scripts/control-room-shots.mjs
// With a Chrome already installed: CHROME=/usr/bin/google-chrome node scripts/control-room-shots.mjs
// Options: --only <scenario id> --at <s> (simulated time to reach, default 900) --out <folder> (default results/control-room)
//          --interlocking (every ETCS scenario with the reference onboard and the interlocking trackside)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = join(root, arg('--out', 'results/control-room')), AT = Number(arg('--at', 900)), ONLY = arg('--only', null), IXL = process.argv.includes('--interlocking');
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1320, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(pathToFileURL(join(root, 'dist', 'yutreno.html')).href);
await p.waitForTimeout(800);
const ids = await p.evaluate(() => [...document.getElementById('scnSel').options].map(o => o.value).filter(Boolean));
let failed = 0;
for (const id of ids) {
  if (ONLY && id !== ONLY) continue;
  const before = errors.length;
  await p.evaluate(([id, at, ixl]) => {
    location.hash = '#scenarios';
    const e = document.getElementById('scnSel'); e.value = id; e.dispatchEvent(new Event('change')); document.getElementById('scnApply').click();
    if (ixl) for (const [k, v] of [['scSig', 'ETCS'], ['scOnboard', 'reference'], ['scTrackside', 'interlocking']]) { const s = document.getElementById(k); s.value = v; s.dispatchEvent(new Event('change')); }
    document.getElementById('brief').hidden = true;
    // a simple driver for the controlled train, as in scripts/screenshots.mjs; the services drive themselves
    const sim = window.YuTreno.simulation(), mem = {}; let next = 0;
    const drive = (o) => { const c = {}; if (o.vigilance_alarm) c.vigilance = true; if (o.emergency || o.doors_open) return Object.assign(c, { traction: 0, brake: .5 });
      let vt = o.supervision.v_permitted_ms - 2; const tg = o.supervision.target; if (tg && tg.speed_ms === 0) vt = Math.min(vt, Math.sqrt(2 * .45 * Math.max(0, tg.distance_m - 25)));
      const st = o.next_stop; if (st) { const d = st.pos_m - o.pos_m; if (d < 600) vt = Math.min(vt, Math.max(d > 2 ? .8 : 0, Math.sqrt(2 * .45 * Math.max(0, d - .5)))); if (d < .6) return Object.assign(c, { traction: 0, brake: 1 }); }
      const er = vt - o.vel_ms; mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + er * o.dt)); const u = .55 * er + .08 * mem.i; return u >= 0 ? Object.assign(c, { traction: Math.min(1, u), brake: 0 }) : Object.assign(c, { traction: 0, brake: Math.min(1, -u * .8) }); };
    while (sim.time < at && !sim.done) { if (!sim.S.finished && sim.S.t + 1e-9 >= next) { sim.applyCommand(drive(sim.observe(.2))); next = sim.S.t + .2 - 1e-9; } sim.step(1 / 200); sim.sample(); }
    location.hash = '#control';
  }, [id, AT, IXL]);
  await p.waitForTimeout(400);
  await p.waitForSelector('#crMap svg');
  await p.waitForTimeout(400);
  // every active train of the snapshot is drawn on the schematic
  const check = await p.evaluate(() => {
    const c = window.YuTreno.simulation().controlRoom();
    const drawn = new Set([...document.querySelectorAll('#crMap [data-train]')].map(e => e.getAttribute('data-train')));
    return { missing: c.trains.filter(t => t.line != null && !drawn.has(t.id)).map(t => t.id), rows: document.querySelectorAll('#crTrains tr[data-train]').length, trains: c.trains.length };
  });
  const name = id.replace(/[\\/]/g, '_') + (IXL ? '-interlocking' : '');
  await p.screenshot({ path: join(OUT, name + '.png'), fullPage: true });
  const errs = errors.slice(before);
  const ok = !errs.length && !check.missing.length && check.rows === check.trains;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}: ${check.trains} trains in the table, ${check.missing.length ? 'not drawn: ' + check.missing.join(', ') : 'all active trains drawn'}${errs.length ? ', errors: ' + errs.join(' | ') : ''}`);
}
await b.close();
console.log(failed ? `${failed} scenarios with problems` : `control room: every scenario shown without errors, screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
