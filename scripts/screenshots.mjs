// Regenerates the screenshots of docs/img from the build in dist/ (first: npm run build).
// Requires Playwright with Chromium, which is not among the project dependencies:
//   npm install --no-save playwright && npx playwright install chromium && node scripts/screenshots.mjs
// The screenshots are saved as PNG; for the repository convert them to JPEG at quality 80-85.
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'docs/img');
const page = (f) => pathToFileURL(join(root, 'dist', f)).href;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await p.goto(page('yutreno.html')); await p.waitForTimeout(1000);
  const line = async (id) => { await p.evaluate(() => { location.hash = '#line'; }); await p.waitForTimeout(400);
    await p.evaluate((id) => { const e = document.getElementById('lnPreset'); e.value = 'p:' + id; e.dispatchEvent(new Event('change')); document.getElementById('lnApply').click(); location.hash = '#drive'; }, id); await p.waitForTimeout(500); };
  const cab = async (name, tod, met, sig, pos, v = 22) => {
    await p.evaluate(([tod, met, sig, pos, v]) => {
      const set = (id, x) => { const e = document.getElementById(id); e.value = x; e.dispatchEvent(new Event('change')); };
      set('scSig', sig); set('scTod', tod); set('scMet', met);
      document.getElementById('brief').hidden = true;
      const sim = window.YuTreno.simulation(); sim.place(pos === 'F' ? sim.leader.S.s - sim.leader.TR.L - 120 : +pos, v); sim.step(1 / 200);
    }, [tod, met, sig, pos, v]);
    await p.waitForTimeout(3500);
    await p.locator('.view').screenshot({ path: `${OUT}/${name}.png` });
  };
  await cab('cab-day', 'day', 'clear', 'BACC', '4720');
  await cab('station-dusk', 'dusk', 'clear', 'ETCS', '5040', 12);
  await line('appennino');
  await cab('tunnel-portal', 'day', 'clear', 'ETCS', '3200');
  await cab('night-rain', 'night', 'rain', 'BACC', '6380', 18);
  await line('valle-lauro');
  await cab('fog', 'day', 'fog', 'ETCS', '2200');
  await cab('station-two-tracks', 'day', 'clear', 'ETCS', '10385', 0);
  // whole page of the Drive tab
  await p.evaluate(() => { window.scrollTo(0, 0); });
  await p.screenshot({ path: `${OUT}/interface.png`, fullPage: false });
  // a crossing: the scenario with a service running back, advanced to the meeting at San Felice Scalo
  await p.evaluate(() => { location.hash = '#scenarios'; });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const e = document.getElementById('scnSel'); e.value = 'services/crossing'; e.dispatchEvent(new Event('change')); document.getElementById('scnApply').click(); location.hash = '#drive'; document.getElementById('brief').hidden = true; });
  await p.evaluate(() => {
    const sim = window.YuTreno.simulation(), mem = {}; let next = 0;
    const drive = (o) => { const c = {}; if (o.vigilance_alarm) c.vigilance = true; if (o.emergency || o.doors_open) return Object.assign(c, { traction: 0, brake: .5 });
      let vt = o.supervision.v_permitted_ms - 2; const tg = o.supervision.target; if (tg && tg.speed_ms === 0) vt = Math.min(vt, Math.sqrt(2 * .45 * Math.max(0, tg.distance_m - 25)));
      const st = o.next_stop; if (st) { const d = st.pos_m - o.pos_m; if (d < 600) vt = Math.min(vt, Math.max(d > 2 ? .8 : 0, Math.sqrt(2 * .45 * Math.max(0, d - .5)))); if (d < .6) return Object.assign(c, { traction: 0, brake: 1 }); }
      const e = vt - o.vel_ms; mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + e * o.dt)); const u = .55 * e + .08 * mem.i; return u >= 0 ? Object.assign(c, { traction: Math.min(1, u), brake: 0 }) : Object.assign(c, { traction: 0, brake: Math.min(1, -u * .8) }); };
    while (sim.time < 503) { if (sim.S.t + 1e-9 >= next) { sim.applyCommand(drive(sim.observe(.2))); next = sim.S.t + .2 - 1e-9; } sim.step(1 / 200); sim.sample(); }
  });
  await p.waitForTimeout(3500);
  await p.locator('.view').screenshot({ path: `${OUT}/crossing.png` });
  for (const t of ['line', 'train', 'scenarios', 'timetable']) {
    await p.evaluate((t) => { location.hash = '#' + t; window.scrollTo(0, 0); }, t); await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/tab-${t}.png` });
  }
  await p.goto(page('model.html')); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/model-page.png` });
  await b.close();
})();
