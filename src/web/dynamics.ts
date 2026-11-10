// External dynamics from the page: WebSocket connection to the model and lockstep exchanges.
// The main loop calls `dynStep()` before every step; until the response arrives the simulation waits.
import { $, app, ui } from './state';

export const DYN = {
  ws: null as WebSocket | null,
  url: '',
  ready: false,
  waiting: false,
  sentAt: 0,
  rtt: 0,
  exchanges: 0,
  err: '',
};

/** True if the current run asks an external model for the dynamics */
export const dynUsed = (): boolean => !!app.sim && !!app.sim.ext;

/** Opens (or reopens) the connection to the model given in the train parameters */
export function dynConnect(): void {
  dynClose();
  if (!dynUsed()) return;
  const url = app.sim.TR.external?.address || 'ws://localhost:8766';
  DYN.url = url;
  DYN.err = 'Connecting to the dynamics model ' + url + '…';
  ui.dirty = true;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    DYN.err = 'Invalid address or network not allowed in this page: open the page locally (dist/yutreno.html).';
    return;
  }
  DYN.ws = ws;
  ws.onopen = () => {
    DYN.ready = true;
    DYN.err = '';
    app.sim.event('INFO', 'External dynamics model connected (' + url + ')');
    ui.dirty = true;
  };
  ws.onmessage = e => {
    if (!DYN.waiting) return;
    DYN.waiting = false;
    DYN.rtt = performance.now() - DYN.sentAt;
    DYN.exchanges++;
    try {
      app.sim.dynamicsResponse(JSON.parse(String(e.data)));
    } catch (err) {
      DYN.err = 'Invalid model response: ' + String((err as Error).message || err);
      ui.paused = true;
      ui.dirty = true;
    }
  };
  ws.onerror = () => {
    DYN.err =
      'Dynamics model not reachable on ' +
      url +
      '. Start the model (or the bridge to MATLAB) and press Restart; inside the published page the network is blocked.';
    ui.dirty = true;
  };
  ws.onclose = () => {
    if (DYN.ws === ws) {
      DYN.ws = null;
      DYN.ready = false;
      DYN.waiting = false;
      if (!DYN.err) DYN.err = 'Dynamics model disconnected.';
      ui.paused = true;
      ui.dirty = true;
    }
  };
}

export function dynClose(): void {
  if (DYN.ws) {
    const w = DYN.ws;
    DYN.ws = null;
    w.onclose = null;
    try {
      w.close();
    } catch (e) {
      /* already closed */
    }
  }
  DYN.ready = false;
  DYN.waiting = false;
  DYN.exchanges = 0;
  DYN.err = '';
}

/**
 * To be called before every step. Returns true if the simulation can advance; otherwise it has sent a request (or
 * is waiting for one) and the loop must stop until the next frame.
 */
export function dynStep(now: number): boolean {
  const sim = app.sim;
  if (!sim.dynamicsDue()) return true;
  if (!DYN.ready) return false;
  if (DYN.waiting) {
    if (now - DYN.sentAt > 5000) {
      DYN.err = 'The dynamics model has not responded for 5 s: run paused.';
      ui.paused = true;
      ui.dirty = true;
    }
    return false;
  }
  try {
    DYN.ws!.send(JSON.stringify(sim.dynamicsRequest()));
    DYN.waiting = true;
    DYN.sentAt = now;
  } catch (e) {
    DYN.err = 'Error sending to the model: ' + String((e as Error).message || e);
    ui.paused = true;
  }
  return false;
}

/** Status line for the interface */
export function dynStatus(): string {
  if (!dynUsed()) return '';
  if (DYN.err) return DYN.err;
  return 'External dynamics ' + DYN.url + ' · exchanges ' + DYN.exchanges + ' · response ' + DYN.rtt.toFixed(1) + ' ms';
}
void $;
