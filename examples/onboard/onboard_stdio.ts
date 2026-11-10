/**
 * The reference ETCS onboard of YuTreno as an external process: it reads the requests from stdin and answers on
 * stdout, one JSON line per message. It serves to test the external onboard protocol and as a template for
 * connecting an EVC written in another language.
 *
 *   npm run headless -- --onboard "exec:npx tsx examples/onboard/onboard_stdio.ts"
 *
 * Service messages go to stderr: stdout is reserved for the protocol.
 */
import { createInterface } from 'node:readline';
import { ReferenceEvc } from '../../src/core/evc';

const evc = new ReferenceEvc();
let n = 0;
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  process.stdout.write(JSON.stringify(evc.step(JSON.parse(line))) + '\n');
  n++;
}).on('close', () => process.stderr.write(`Reference onboard: run finished after ${n} cycles\n`));
