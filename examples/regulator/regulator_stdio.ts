/**
 * The reference regulator of YuTreno as an external process: it reads the requests from stdin and answers on stdout,
 * one JSON line per message. It serves to test the regulator protocol (`docs/REGULATOR.md`) and as a template for
 * connecting a regulator written in another language, for example an optimisation model for rescheduling.
 *
 *   npm run headless -- --scenario scenarios/services/breakdown.json --regulator "exec:npx tsx examples/regulator/regulator_stdio.ts"
 *
 * Service messages go to stderr: stdout is reserved for the protocol.
 */
import { createInterface } from 'node:readline';
import { ReferenceRegulator } from '../../src/regulator';

const regulator = new ReferenceRegulator();
let n = 0, decisions = 0;
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  const res = regulator.step(JSON.parse(line));
  decisions += res.commands.length;
  process.stdout.write(JSON.stringify(res) + '\n');
  n++;
}).on('close', () => process.stderr.write(`Reference regulator: ${n} cycles, ${decisions} decisions\n`));
