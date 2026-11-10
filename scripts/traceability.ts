/**
 * Requirement-to-test traceability.
 *
 * Every test block of the verify scripts that checks a requirement carries a tag line
 *   // @test <id>: <title> [<requirement id>, <requirement id>, ...]
 * This script collects the tags of scripts/verify-*.ts and
 *  - writes docs/traceability/tests.csv, one row per (requirement, test);
 *  - fills the `tests` column of docs/traceability/matrix.csv with the tests of each row;
 *  - checks that every tagged requirement exists in the matrix and that every implemented or simplified row is
 *    covered by at least one test, on the row itself or on one of its sub-clauses (a section is covered when a test
 *    checks one of its clauses).
 *
 *   npx tsx scripts/traceability.ts           # updates the two files and reports the coverage
 *   npx tsx scripts/traceability.ts --check   # fails if the files are not up to date or a row is not covered
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TestTag { test: string; script: string; line: number; title: string; reqs: string[] }
const MATRIX = 'docs/traceability/matrix.csv', TESTS = 'docs/traceability/tests.csv';

/** Minimal CSV reader with quoted fields (RFC 4180) */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const cell = (v: string) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
export const toCsv = (cols: string[], rows: Record<string, string>[]) => cols.join(',') + '\n' + rows.map(r => cols.map(c => cell(r[c] ?? '')).join(',')).join('\n') + '\n';

/** Tags of all verify scripts, in file order */
export function collectTags(dir = 'scripts'): TestTag[] {
  const out: TestTag[] = [];
  for (const f of readdirSync(dir).filter(n => /^verify-.*\.ts$/.test(n)).sort()) {
    readFileSync(join(dir, f), 'utf8').split('\n').forEach((l, i) => {
      const m = /\/\/ @test (\S+): (.*) \[([^\]]+)\]\s*$/.exec(l);
      if (m) out.push({ test: m[1], script: f, line: i + 1, title: m[2].trim(), reqs: m[3].split(',').map(s => s.trim()).filter(Boolean) });
    });
  }
  return out;
}

/** Builds the two files and the coverage report without writing anything */
export function build() {
  const matrixText = readFileSync(MATRIX, 'utf8');
  const cols = matrixText.slice(0, matrixText.indexOf('\n')).split(',');
  const rows = parseCsv(matrixText);
  const tags = collectTags();
  const ids = new Set(rows.map(r => r.id));
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (seen.has(t.script + '#' + t.test)) errors.push(`${t.script}:${t.line}: test id ${t.test} used twice`);
    seen.add(t.script + '#' + t.test);
    for (const r of t.reqs) if (!ids.has(r)) errors.push(`${t.script}:${t.line}: ${t.test} refers to ${r}, which is not in the matrix`);
  }
  const ref = (t: TestTag) => `${t.script.replace(/\.ts$/, '')}#${t.test}`;
  const testRows: Record<string, string>[] = [];
  for (const r of rows) for (const t of tags) if (t.reqs.includes(r.id)) testRows.push({ requirement: r.id, test: ref(t), script: 'scripts/' + t.script, title: t.title });
  const uncovered: string[] = [];
  for (const r of rows) {
    const direct = tags.filter(t => t.reqs.includes(r.id)).map(ref);
    r.tests = direct.join('; ');
    if (r.status !== 'implemented' && r.status !== 'simplified') continue;
    const sub = tags.some(t => t.reqs.some(q => q.startsWith(r.id + '.')));
    if (!direct.length && !sub) uncovered.push(`${r.id} (${r.status}): ${r.title}`);
    else if (!direct.length) r.tests = 'via sub-clauses';
  }
  return {
    matrix: toCsv(cols, rows), tests: toCsv(['requirement', 'test', 'script', 'title'], testRows), matrixText,
    testsText: (() => { try { return readFileSync(TESTS, 'utf8'); } catch { return ''; } })(),
    errors, uncovered, tags, rows,
  };
}

const isMain = process.argv[1] && /traceability\.ts$/.test(process.argv[1]);
if (isMain) {
  const b = build();
  const check = process.argv.includes('--check');
  const counted = b.rows.filter(r => r.status === 'implemented' || r.status === 'simplified');
  console.log(`${b.tags.length} tagged tests, ${b.rows.length} matrix rows, ${counted.length} implemented or simplified, ${counted.length - b.uncovered.length} covered`);
  for (const e of b.errors) console.log('  error: ' + e);
  for (const u of b.uncovered) console.log('  not covered: ' + u);
  if (check) {
    const stale = [b.matrix !== b.matrixText && MATRIX, b.tests !== b.testsText && TESTS].filter(Boolean);
    if (stale.length) console.log('  not up to date: ' + stale.join(', ') + ' (run npx tsx scripts/traceability.ts)');
    if (b.errors.length || b.uncovered.length || stale.length) process.exit(1);
  } else {
    writeFileSync(MATRIX, b.matrix); writeFileSync(TESTS, b.tests);
    console.log(`written ${MATRIX} and ${TESTS}`);
    if (b.errors.length || b.uncovered.length) process.exit(1);
  }
}
