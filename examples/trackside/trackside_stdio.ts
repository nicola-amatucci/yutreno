/**
 * The trackside of YuTreno (interlocking and RBC) as an external process: it reads the requests from stdin and
 * answers on stdout, one JSON line per message. It serves to test the trackside protocol (`docs/TRACKSIDE.md`) and as
 * a template for connecting an interlocking or an RBC written in another language, or a real interlocking simulator.
 *
 *   npm run headless -- --onboard reference --trackside "exec:npx tsx examples/trackside/trackside_stdio.ts"
 *
 * Service messages go to stderr: stdout is reserved for the protocol.
 */
import { createInterface } from 'node:readline';
import { Trackside } from '../../src/trackside';

const trackside = new Trackside();
let n = 0;
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  process.stdout.write(JSON.stringify(trackside.step(JSON.parse(line))) + '\n');
  n++;
}).on('close', () => process.stderr.write(`Reference trackside: run finished after ${n} cycles\n`));
