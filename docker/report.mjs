// HTML report of the demo: reads the test folders (test.json, summary.json, console.txt) and writes index.html with a
// table per test and the links to the data of every run. One row per run, for the controlled train; the other trains
// of the run (the freight train ahead, the services) are summed up under it. `expected` in test.json lists the
// scenarios (file names without .json) whose expected outcome in that test is «failed».
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, seconds] = process.argv.slice(2);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (x, d = 1) => (x == null ? '—' : Number(x).toFixed(d));
const sections = [];
let tot = 0, ok = 0, exp = 0;
for (const name of readdirSync(dir).sort()) {
  const p = join(dir, name);
  if (!statSync(p).isDirectory()) continue;
  const info = existsSync(join(p, 'test.json')) ? JSON.parse(readFileSync(join(p, 'test.json'), 'utf8')) : { title: name };
  const consoleText = existsSync(join(p, 'console.txt')) ? readFileSync(join(p, 'console.txt'), 'utf8') : '';
  let rows = '';
  if (existsSync(join(p, 'summary.json'))) {
    const all = readdirSync(p).filter(f => f.endsWith('_summary.json')).sort();
    // the run itself is <scenario>_<NNN>_summary.json; <scenario>_<NNN>_<train>_summary.json are its other trains
    for (const f of all.filter(f => /_\d{3}_summary\.json$/.test(f))) {
      const r = JSON.parse(readFileSync(join(p, f), 'utf8')), base = f.replace('_summary.json', '');
      const expected = (info.expected || []).includes(base.replace(/_\d{3}$/, ''));
      tot++; if (r.outcome === 'passed') ok++; else if (expected) exp++;
      const ko = (r.checks || []).filter(c => !c.ok).map(c => c.name).join(', ');
      const others = all.filter(g => g !== f && g.startsWith(base + '_')).map(g => JSON.parse(readFileSync(join(p, g), 'utf8')));
      const othersText = others.length ? `${others.length} other train${others.length > 1 ? 's' : ''} of the run, ${others.filter(o => o.outcome === 'passed').length} passed` : '';
      const cls = r.outcome === 'passed' ? 'ok' : expected ? 'exp' : 'ko';
      rows += `<tr><td>${esc(r.scenario ?? 'Run without scenario')}<div class="sub">${esc(r.line)} · ${esc(r.signalling)}${r.onboard ? ' · onboard ' + esc(r.onboard) : ''} · dynamics ${esc(r.model)}</div>${othersText ? `<div class="sub">${esc(othersText)}</div>` : ''}</td>` +
        `<td><span class="outcome ${cls}">${esc(r.outcome)}${expected && r.outcome !== 'passed' ? ', as expected' : ''}</span>${ko ? `<div class="sub">${esc(ko)}</div>` : ''}</td>` +
        `<td class="n">${num(r.t_s, 0)} s</td><td class="n">${num(r.mean_stop_error_m, 2)} m</td>` +
        `<td class="n">${num(r.traction_energy_kWh - r.regenerated_energy_kWh)} kWh</td><td class="n">${r.interventions}</td><td class="n">${r.service_brakings}</td>` +
        `<td><a href="${name}/${base}.csv">CSV</a> · <a href="${name}/${base}_events.json">events</a></td></tr>`;
    }
  }
  sections.push(`<section><h2>${esc(info.title)}</h2>${info.description ? `<p>${esc(info.description)}</p>` : ''}` +
    (info.command ? `<pre>${esc(info.command)}</pre>` : '') +
    (rows ? `<div class="tw"><table><thead><tr><th>Run</th><th>Verdict</th><th>Arrival</th><th>Stop error</th><th>Net energy</th><th>Interventions</th><th>Service brakings</th><th>Data</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<pre class="console">${esc(consoleText.trim())}</pre>`) + `</section>`);
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>YuTreno demo</title><style>
:root{--bg:#0d1216;--panel:#141c22;--line:#2a3740;--fg:#e3e9ec;--muted:#8b9ca6;--accent:#7fd0e6;--ok:#38c96b;--ko:#ee4a45}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
h1{margin:0 0 4px;font-size:28px}h2{font-size:18px;margin:0 0 6px}p{color:#c9d3d8;margin:4px 0 10px}a{color:var(--accent)}
section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12px}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sub{color:var(--muted);font-size:12px}
.outcome{font-weight:600;font-size:12px;padding:2px 8px;border-radius:99px}.ok{background:color-mix(in srgb,var(--ok) 25%,transparent);color:var(--ok)}.ko{background:color-mix(in srgb,var(--ko) 25%,transparent);color:#ff9b97}.exp{background:color-mix(in srgb,var(--muted) 25%,transparent);color:var(--fg)}
pre{background:#0a0f12;border-radius:8px;padding:10px;overflow-x:auto;font-size:12.5px;color:#c9d3d8}.top{color:var(--muted)}
</style></head><body><main><h1>YuTreno demo</h1>
<p class="top">${tot} runs in ${seconds} s: ${ok} passed, ${exp} failed as expected, ${tot - ok - exp} failed unexpectedly. Some scenarios are designed to fail: the leaves and the degraded brake put the example controller in difficulty, and the odometry drift is beyond what the minimal Python onboard handles, because it ignores the confidence interval of its position.
The simulator is on <a href="../yutreno.html">this page</a>; to connect it to the external programs of the container choose «External via API» for onboard or dynamics.</p>
${sections.join('\n')}</main></body></html>`;
writeFileSync(join(dir, 'index.html'), html);
console.log(`Report: ${tot} runs, ${ok} passed, ${exp} failed as expected, ${tot - ok - exp} failed unexpectedly`);
// a failure that is not expected makes the demo end with an error
if (tot - ok - exp > 0) process.exitCode = 1;
