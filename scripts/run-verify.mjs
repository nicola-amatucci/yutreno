// Runs the scripts scripts/verify-*.ts, several at a time, and fails if any of them fails.
// Usage: node scripts/run-verify.mjs                  (all, as many at a time as there are processors)
//        node scripts/run-verify.mjs ato network      (only verify-ato.ts and verify-network.ts)
//        node scripts/run-verify.mjs --jobs 1         (one after the other, the output as it comes)
//        node scripts/run-verify.mjs --quick          (only the short checks, under a minute: for everyday work;
//                                                      the whole set stays required before a commit)
// With more than one job the output of each check is printed whole when it ends, so the logs do not mix; the
// longest checks start first. Every check is a separate process: running them together does not change their data.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const ji = argv.indexOf('--jobs');
const jobs = ji >= 0 ? Math.max(1, Number(argv[ji + 1]) || 1) : availableParallelism();
const names = argv.filter((a, i) => !a.startsWith('--') && !(ji >= 0 && i === ji + 1));
// the longest first, measured on 7 November 2026, so that the others fill the time they take
const LONG = ['network', 'capacity', 'trackside', 'regulator', 'passengers', 'control-room', 'services', 'onboard', 'scenarios'];
const all = readdirSync(dir).filter(f => /^verify-.*\.ts$/.test(f)).sort();
const quick = argv.includes('--quick');
const suites = (names.length ? names.map(n => `verify-${n}.ts`) : quick ? all.filter(f => !LONG.includes(f.slice(7, -3))) : all)
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
function rank(f) { const i = LONG.indexOf(f.slice(7, -3)); return i < 0 ? LONG.length : i; }

const t0 = Date.now();
const failed = [];
let next = 0;
function runOne(suite) {
  return new Promise(resolve => {
    const t = Date.now();
    const live = jobs === 1;
    if (live) console.log(`\n=== ${suite} ===`);
    const p = spawn(process.execPath, ['--import', 'tsx', join(dir, suite)], { stdio: live ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let out = '';
    if (!live) { p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; }); }
    p.on('close', (code, signal) => {
      const s = ((Date.now() - t) / 1000).toFixed(1);
      if (!live) process.stdout.write(`\n=== ${suite} ===\n${out}`);
      if (code !== 0) { failed.push(suite); console.error(`\n${suite} failed (exit ${code ?? signal}) after ${s} s`); }
      else console.log(`--- ${suite} passed in ${s} s`);
      resolve();
    });
  });
}
await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, async () => {
  while (next < suites.length) await runOne(suites[next++]);
}));
const total = ((Date.now() - t0) / 1000).toFixed(0);
if (failed.length) { console.error(`\n${failed.length} of ${suites.length} checks failed: ${failed.join(', ')} (${total} s, ${jobs} at a time)`); process.exit(1); }
console.log(`\nAll ${suites.length} checks passed (${total} s, ${jobs} at a time).`);
