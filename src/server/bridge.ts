/**
 * Bridge between the YuTreno page and an external dynamics model.
 *
 * The browser speaks only WebSocket, MATLAB (tcpserver) speaks TCP with JSON lines: the bridge accepts the page on
 * ws://localhost:<port> and forwards every request to the model, line by line.
 *
 *   npm run bridge -- --tcp localhost:5555            # to MATLAB/Simulink or examples/python/yutreno_dynamics.py
 *   npm run bridge -- --model examples/dynamics_point.js   # JavaScript model run by the bridge itself
 *   npm run bridge -- --exec "octave-cli -q examples/octave/yutreno_dynamics.m"   # one process per run, on stdin/stdout
 *   options: --port 8766 (WebSocket port for the page), --host 127.0.0.1 (0.0.0.0 in a container),
 *            --protocol 1 (sends the Italian requests of YuTreno 0.x to a model written for that version)
 *
 * In the Train tab of the page: computation model «External via API», address ws://localhost:8766.
 * Minimal WebSocket server (RFC 6455, text messages only) so as not to add dependencies.
 * `npm run ponte` and the Italian options (--porta, --modello, --protocollo) are kept for version 0.x.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { connect as tcpConnect, type Socket } from 'node:net';
import { toLegacy, type DynamicsRequest } from '../core';
import { loadJsDynamics } from './headless';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** WebSocket text frame from the server (unmasked) */
function frame(text: string): Buffer {
  const data = Buffer.from(text, 'utf8'), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, data]);
}

/** Reads the frames coming from the browser; calls onText for every complete message */
function frameReader(sock: Socket, onText: (t: string) => void, onClose: () => void) {
  let buf = Buffer.alloc(0), parts: Buffer[] = [];
  sock.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[mOff + (i & 3)];
      buf = buf.subarray(off + len);
      if (op === 8) { try { sock.end(Buffer.from([0x88, 0])); } catch { /* already closed */ } onClose(); return; }
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 1 || op === 0) { parts.push(payload); if (fin) { const t = Buffer.concat(parts).toString('utf8'); parts = []; onText(t); } }
    }
  });
  sock.on('close', onClose);
  sock.on('error', onClose);
}

/** Italian option names of version 0.x, still accepted */
const ALIASES: Record<string, string> = { porta: 'port', modello: 'model', protocollo: 'protocol' };

function parseArgs(argv: string[]) {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2); a[ALIASES[k] ?? k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; }
  return a;
}

export function startBridge(opt: { port: number; host?: string; tcp?: string; model?: string; exec?: string; legacy?: boolean }) {
  /** Request from the page as sent to the model: unchanged, or in the Italian format of 0.x with --protocol 1 */
  const out = (t: string) => opt.legacy ? JSON.stringify(toLegacy({ ...JSON.parse(t), version: 1 }, 'dynamics')) : t.replace(/\n/g, ' ');
  const srv = createServer((_, res) => { res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' }); res.end('YuTreno bridge: connect via WebSocket.\n'); });
  srv.on('upgrade', (req, sock: Socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { sock.destroy(); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    sock.setNoDelay(true);
    let closed = false, n = 0;
    const done = () => { if (closed) return; closed = true; console.log(`Page disconnected after ${n} exchanges`); if (up) up.end(); };
    let up: Socket | null = null;
    if (opt.model) {
      const dyn = loadJsDynamics(opt.model);
      console.log('Page connected: model ' + opt.model + ' answers');
      frameReader(sock, t => { n++; Promise.resolve(dyn(JSON.parse(t) as DynamicsRequest)).then(r => sock.write(frame(JSON.stringify(r)))); }, done);
      return;
    }
    if (opt.exec) {
      // one process per run: requests on stdin, responses on stdout, one JSON line each
      const child = spawn(opt.exec, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
      console.log('Page connected: started «' + opt.exec + '»');
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) sock.write(frame(line)); }
      });
      child.on('error', e => { console.error('Cannot start «' + opt.exec + '»: ' + e.message); sock.end(Buffer.from([0x88, 0])); });
      child.on('exit', () => { if (!closed) sock.end(Buffer.from([0x88, 0])); });
      frameReader(sock, t => { n++; child.stdin.write(out(t) + '\n'); }, () => { done(); try { child.stdin.end(); } catch { /* already closed */ } });
      return;
    }
    const [host, port] = (opt.tcp || 'localhost:5555').split(':');
    const target: Socket = tcpConnect({ host, port: Number(port) || 5555 });
    up = target;
    target.setNoDelay(true);
    let lineBuf = '';
    target.on('connect', () => console.log(`Page connected, forwarding to tcp://${host}:${port}`));
    target.on('data', d => {
      lineBuf += d.toString('utf8');
      let i: number;
      while ((i = lineBuf.indexOf('\n')) >= 0) { const line = lineBuf.slice(0, i).trim(); lineBuf = lineBuf.slice(i + 1); if (line) sock.write(frame(line)); }
    });
    target.on('error', e => { console.error(`Model not reachable on tcp://${host}:${port}: ${e.message}`); sock.end(Buffer.from([0x88, 0])); });
    target.on('close', () => { if (!closed) sock.end(Buffer.from([0x88, 0])); });
    frameReader(sock, t => { n++; target.write(out(t) + '\n'); }, done);
  });
  const dest = opt.model ? 'model ' + opt.model : opt.exec ? 'process «' + opt.exec + '»' : 'tcp://' + (opt.tcp || 'localhost:5555');
  srv.listen(opt.port, opt.host || '127.0.0.1', () => console.log(`YuTreno bridge listening on ws://localhost:${opt.port} → ${dest}`));
  return srv;
}

const isMain = process.argv[1] && /bridge\.ts$/.test(process.argv[1]);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) console.log('Usage: npm run bridge -- [--port 8766] [--host 127.0.0.1] [--protocol 1] [--tcp host:port | --model file.js | --exec "command"]');
  else startBridge({ port: Number(a.port || 8766), host: a.host, tcp: a.tcp, model: a.model, exec: a.exec, legacy: a.protocol === '1' });
}
