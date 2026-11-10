/**
 * Checks the requirement traceability: every test tag refers to a row of docs/traceability/matrix.csv, every
 * implemented or simplified row has at least one test, and the generated files are up to date
 * (regenerate them with npx tsx scripts/traceability.ts).
 *   npx tsx scripts/verify-traceability.ts
 */
import assert from 'node:assert/strict';
import { build } from './traceability';

const b = build();
assert.deepEqual(b.errors, [], 'test tags referring to unknown requirements');
assert.deepEqual(b.uncovered, [], 'implemented or simplified requirements without a test');
assert.equal(b.matrix, b.matrixText, 'docs/traceability/matrix.csv is not up to date: run npx tsx scripts/traceability.ts');
assert.equal(b.tests, b.testsText, 'docs/traceability/tests.csv is not up to date: run npx tsx scripts/traceability.ts');
const n = b.rows.filter(r => r.status === 'implemented' || r.status === 'simplified').length;
console.log(`traceability: ${b.tags.length} tagged tests cover all ${n} implemented or simplified requirements: ok`);
