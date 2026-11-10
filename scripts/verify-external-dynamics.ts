/**
 * Checks the co-simulation with an external dynamics model.
 *  1. The point mass rewritten outside the engine (examples/dynamics_point.js), coupled every 5 ms, reproduces the
 *     internal 'point' model on all lines and signalling systems.
 *  2. With the default 50 ms coupling the results stay close to the internal ones.
 *  3. The run stays deterministic and the engine refuses to advance without a response.
 *  4. The request contains what the model needs: line around the train, commands, faults, train on the first one.
 *  5. The JSON-lines transports, TCP (MATLAB) and child process on stdin/stdout (Octave, Python), give the same
 *     results as the direct call.
 *   npx tsx scripts/verify-external-dynamics.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  DEFAULT_SCENARIO, FIXED_DT, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, runLockstep,
  type DynamicsProvider, type DynamicsRequest, type Signalling, type TrainParams,
} from '../src/core';
import { resolve } from 'node:path';
import { connectDynamics, loadJsController, loadJsDynamics, spawnDynamics } from '../src/server/headless';

const train = (model: TrainParams['model'], period_s?: number): TrainParams =>
  ({ ...clone(TRAIN_PRESETS.regional), model: model, ...(period_s ? { external: { period_s: period_s } } : {}) });

async function run(line: string, sig: Signalling, tr: TrainParams, dyn?: DynamicsProvider) {
  const sim = new Simulation(clone(LINE_PRESETS[line]), tr, { ...DEFAULT_SCENARIO, sig });
  await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', dynamics: dyn });
  return sim;
}
const res = (sim: Simulation) => {
  const r = sim.result();
  return { t: r.t_s, e: r.net_energy_kWh, err: sim.S.stops.map(s => s.err ?? NaN), ok: sim.verdict().outcome };
};
const hash = (sim: Simulation) => createHash('sha256').update(sim.csv()).digest('hex');

// 1 and 2: equivalence with the internal point mass
for (const line of Object.keys(LINE_PRESETS)) for (const sig of ['ETCS', 'BACC'] as Signalling[]) {
  const ref = res(await run(line, sig, train('point')));
  const end = res(await run(line, sig, train('external', FIXED_DT), loadJsDynamics('examples/dynamics_point.js')));
  const coarse = res(await run(line, sig, train('external', 0.05), loadJsDynamics('examples/dynamics_point.js')));
  const tag = `${line}/${sig}`;
  assert.equal(end.ok, 'passed', tag + ': the run with external dynamics must pass the criteria');
  assert.ok(Math.abs(end.t - ref.t) < 0.05, `${tag}: arrival ${end.t} against ${ref.t} of the internal model`);
  assert.ok(Math.abs(end.e - ref.e) < 0.05, `${tag}: energy ${end.e.toFixed(3)} against ${ref.e.toFixed(3)}`);
  end.err.forEach((e, i) => assert.ok(Math.abs(e - ref.err[i]) < 0.05, `${tag}: error at stop ${i} ${e} against ${ref.err[i]}`));
  assert.equal(coarse.ok, 'passed', tag + ': with 50 ms coupling the run must pass the criteria');
  assert.ok(Math.abs(coarse.t - ref.t) < 2, `${tag}: with 50 ms the arrival ${coarse.t} deviates too much from ${ref.t}`);
  assert.ok(Math.abs(coarse.e - ref.e) / ref.e < 0.02, `${tag}: with 50 ms the energy deviates by more than 2%`);
  console.log(`${tag.padEnd(22)} internal ${ref.t.toFixed(2)} s ${ref.e.toFixed(2)} kWh · external 5 ms ${end.t.toFixed(2)} s ${end.e.toFixed(2)} kWh · 50 ms ${coarse.t.toFixed(2)} s ${coarse.e.toFixed(2)} kWh`);
}

// 3: determinism and missing response
{
  const a = await run('valle-lauro', 'ETCS', train('external'), loadJsDynamics('examples/dynamics_point.js'));
  const b = await run('valle-lauro', 'ETCS', train('external'), loadJsDynamics('examples/dynamics_point.js'));
  assert.equal(hash(a), hash(b), 'two runs with the same external model must give identical data');
  const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), train('external'), DEFAULT_SCENARIO);
  assert.ok(sim.dynamicsDue(), 'at the start a model response is needed immediately');
  assert.throws(() => sim.step(FIXED_DT), /response missing/, 'without a response the engine must not advance');
  assert.throws(() => sim.dynamicsResponse({ pos_m: NaN, vel_ms: 0 }), /invalid/);
  const internal = new Simulation(clone(LINE_PRESETS['valle-lauro']), train('point'), DEFAULT_SCENARIO);
  assert.equal(internal.dynamicsDue(), false, 'with internal models nobody is queried');
  console.log('determinism and response checks: ok');
}

// 4: request content
{
  const sim = new Simulation(clone(LINE_PRESETS.appennino), train('external', 0.1), DEFAULT_SCENARIO);
  const reqs: DynamicsRequest[] = [];
  const js = loadJsDynamics('examples/dynamics_point.js');
  const spy: DynamicsProvider = r => { reqs.push(r); return js(r); };
  sim.place(3200, 20);
  for (let k = 0; k < 100; k++) { if (sim.dynamicsDue()) sim.dynamicsResponse(await spy(sim.dynamicsRequest())); sim.step(FIXED_DT); }
  assert.equal(reqs.length, 5, '0.5 s with 0.1 s coupling are 5 exchanges');
  assert.ok(reqs[0].start && reqs[0].train && !reqs[1].start && !reqs[1].train, 'only the first request carries the train parameters');
  assert.ok(Math.abs(reqs[1].t - 0.1) < 1e-9 && reqs[1].dt === 0.1, 'the intervals follow each other without gaps');
  const b0 = reqs[0].track;
  assert.ok(b0.from_m <= 3200 - sim.TR.L && b0.to_m >= 3650, 'the line sent covers the train and the horizon ahead');
  assert.ok(b0.tunnels.some(g => g[0] === 3300), 'the tunnel ahead of the train appears in the request');
  assert.ok(b0.gradients.length > 0 && b0.gradients[0][0] === b0.from_m, 'the gradients start at the beginning of the window');
  sim.emergency('test');
  const r = sim.dynamicsRequest();
  assert.ok(r.commands.emergency && r.commands.brake === 1 && r.commands.traction === 0, 'in emergency the model receives full brake and no traction');
  console.log('request content: ok');
}

// 5: TCP transport with a JSON-lines server, like the MATLAB one
{
  const js = loadJsDynamics('examples/dynamics_point.js');
  const srv = createServer(sock => {
    let buf = '';
    sock.on('data', d => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) sock.write(JSON.stringify(js(JSON.parse(line))) + '\n'); }
    });
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const { dynamics, close } = await connectDynamics(`tcp://127.0.0.1:${port}`);
  const viaTcp = await run('valle-lauro', 'BACC', train('external'), dynamics);
  close(); srv.close();
  const direct = await run('valle-lauro', 'BACC', train('external'), loadJsDynamics('examples/dynamics_point.js'));
  assert.equal(hash(viaTcp), hash(direct), 'via TCP the results must match the direct call');
  console.log('TCP transport: ok');
  // child process: Node itself acts as external model, so the check needs neither Octave nor Python
  const code = "const d=new Function(require('fs').readFileSync(process.argv[1],'utf8')+';return dynamics')(),m={};require('readline').createInterface({input:process.stdin}).on('line',l=>{if(l.trim())process.stdout.write(JSON.stringify(d(JSON.parse(l),m))+'\\n')})";
  const child = spawnDynamics(`"${process.execPath}" -e "${code}" "${resolve('examples/dynamics_point.js')}"`);
  const viaExec = await run('valle-lauro', 'BACC', train('external'), child.dynamics);
  child.close();
  assert.equal(hash(viaExec), hash(direct), 'with a process on stdin/stdout the results must match the direct call');
  console.log('process on stdin/stdout: ok');
}
console.log('external dynamics: ok');
