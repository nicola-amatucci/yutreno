// Lockstep controllers: Web Worker in the browser or external controller via WebSocket.
import { $, CTL, S, app, num, store, ui } from './state';

/** Sends the current observation to the active controller and suspends the simulation until the response */
export function ctlSend() {
  CTL.waiting = true;
  CTL.sentAt = performance.now();
  const o = app.sim.observe(CTL.period, CTL.kind === 'worker' ? CTL.api : 3);
  try {
    if (CTL.kind === 'worker') CTL.worker.postMessage({ type: 'obs', obs: o });
    else if (CTL.kind === 'ws') CTL.ws.send(JSON.stringify(o));
  } catch (e) {
    CTL.lastErr = String(e.message || e);
    ctlStop('Error sending to the controller');
  }
}
/** Applies the received command and sets the time of the next send */
export function ctlReceive(cmd) {
  if (!CTL.waiting) return;
  CTL.rtt = performance.now() - CTL.sentAt;
  CTL.waiting = false;
  CTL.timeouts = 0;
  S.ctlTicks++;
  CTL.lastCmd = cmd;
  app.sim.applyCommand(cmd);
  CTL.nextT = S.t + CTL.period - 1e-9;
  ui.dirty = true;
}
/** Stops the controller and gives the controls back to the driver, with an optional message */
export function ctlStop(why) {
  if (CTL.worker) {
    try {
      CTL.worker.terminate();
    } catch (e) {}
    CTL.worker = null;
  }
  if (CTL.ws) {
    try {
      CTL.ws.onclose = null;
      CTL.ws.close();
    } catch (e) {}
    CTL.ws = null;
  }
  const had = CTL.kind;
  CTL.kind = null;
  if (S) S.commandSource = 'manual';
  CTL.waiting = false;
  CTL.ready = false;
  if (had && why && S) app.sim.event('CTL', why);
  ui.dirty = true;
}
/** Realigns the controller to a new run */
export function ctlOnReset() {
  if (CTL.kind) {
    CTL.waiting = false;
    CTL.nextT = 0;
    if (CTL.worker) CTL.worker.postMessage({ type: 'reset' });
  }
}
/** Starts the JavaScript controller of the editor in an isolated Web Worker */
export function ctlStartWorker() {
  ctlStop('');
  CTL.period = +$('ctlPeriod').value || 0.2;
  CTL.lastErr = '';
  const code = $('ctlCode').value;
  store.set('yutreno-ctl-code', code);
  // a controller written for version 0.x defines controllo(oss, mem): it receives the Italian observation (version 2)
  const src =
    code +
    `
;(function(){let mem={};
const isNew=typeof control==='function',fn=isNew?control:typeof controllo==='function'?controllo:null;
if(!fn){self.postMessage({type:'error',msg:'The code must define function control(obs, mem)'});return;}
self.onmessage=function(e){const m=e.data;if(m.type==='reset'){mem={};return;}
try{const c=fn(m.obs,mem)||{};self.postMessage({type:'cmd',cmd:c});}
catch(err){self.postMessage({type:'error',msg:String(err&&err.message||err)});self.postMessage({type:'cmd',cmd:{}});}};
self.postMessage({type:'ready',api:isNew?3:2});})();`;
  let w;
  try {
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  } catch (e) {
    CTL.lastErr = 'Cannot start the Web Worker: ' + (e.message || e);
    ui.dirty = true;
    return;
  }
  CTL.worker = w;
  CTL.kind = 'worker';
  CTL.api = 3;
  S.commandSource = 'worker';
  CTL.nextT = S.t;
  CTL.waiting = false;
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'cmd') ctlReceive(m.cmd);
    else if (m.type === 'error') {
      CTL.lastErr = m.msg;
      ui.dirty = true;
    } else if (m.type === 'ready') {
      CTL.api = m.api;
      CTL.ready = true;
      ui.dirty = true;
    }
  };
  w.onerror = e => {
    CTL.lastErr =
      'Error in the code: ' + (e.message || 'invalid syntax') + (e.lineno ? ' (line ' + e.lineno + ')' : '');
    if (e.preventDefault) e.preventDefault();
    ctlStop('Controller stopped by an error in the code');
  };
  app.sim.event('CTL', 'In-browser controller in command, period ' + num(CTL.period, 1) + ' s');
}
/** Connects to an external controller via WebSocket at the address given in the tab */
export function ctlStartWs() {
  ctlStop('');
  CTL.period = +$('ctlPeriod').value || 0.2;
  CTL.lastErr = 'Connecting to ' + $('wsUrl').value + '…';
  ui.dirty = true;
  let ws;
  try {
    ws = new WebSocket($('wsUrl').value.trim());
  } catch (e) {
    CTL.lastErr = 'Invalid address or connection not allowed in this page: open the page locally (dist/yutreno.html).';
    ui.dirty = true;
    return;
  }
  CTL.ws = ws;
  ws.onopen = () => {
    CTL.kind = 'ws';
    S.commandSource = 'ws';
    CTL.lastErr = '';
    CTL.nextT = S.t;
    CTL.waiting = false;
    CTL.ready = true;
    app.sim.event('CTL', 'External controller connected (' + ws.url + ')');
  };
  ws.onmessage = e => {
    let c;
    try {
      c = JSON.parse(e.data);
    } catch (err) {
      CTL.lastErr = 'Response not in JSON: ' + String(e.data).slice(0, 80);
      c = {};
    }
    ctlReceive(c);
  };
  ws.onerror = () => {
    CTL.lastErr =
      'Connection failed. Inside the published page the network is blocked: open the page locally (dist/yutreno.html) with the Python script listening.';
    ui.dirty = true;
  };
  ws.onclose = () => {
    if (CTL.kind === 'ws') ctlStop('External controller disconnected');
    CTL.ws = null;
    ui.dirty = true;
  };
}
$('mdMan').onclick = () => ctlStop('Control to the driver');
$('mdWorker').onclick = () => ctlStartWorker();
$('mdWs').onclick = () => ctlStartWs();
$('ctlRun').onclick = () => {
  ctlStartWorker();
};
$('ctlReset').onclick = () => {
  $('ctlCode').value = __ATO_EXAMPLE__.trim() + '\n';
  store.del('yutreno-ctl-code');
};
$('ctlS130').onclick = () => {
  $('ctlCode').value = __ATO_S130_EXAMPLE__.trim() + '\n';
  store.del('yutreno-ctl-code');
};
$('ctlPeriod').onchange = () => {
  CTL.period = +$('ctlPeriod').value;
};
$('ctlCode').value = store.get('yutreno-ctl-code') || __ATO_EXAMPLE__.trim() + '\n';
$('ctlCode').addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target,
      a = t.selectionStart;
    t.value = t.value.slice(0, a) + '  ' + t.value.slice(t.selectionEnd);
    t.selectionStart = t.selectionEnd = a + 2;
  }
});
