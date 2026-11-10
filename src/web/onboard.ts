// External ETCS onboard from the page: WebSocket connection to the EVC and lockstep exchanges, as for the external
// dynamics. For an EVC on TCP or as a process (Python, Octave, C++...) use the bridge: npm run bridge -- --port 8767 --exec "...".
import { app, ui } from './state';

export const OBX = {
  ws: null as WebSocket | null,
  url: '',
  ready: false,
  waiting: false,
  sentAt: 0,
  rtt: 0,
  exchanges: 0,
  err: '',
};

/** True if the current run asks an external EVC for the supervision */
export const obUsed = (): boolean => !!app.sim && !!app.sim.ob && app.sim.ob.kind === 'external';

/** Opens (or reopens) the connection to the external EVC */
export function obConnect(url: string): void {
  obClose();
  if (!obUsed()) return;
  OBX.url = url;
  OBX.err = 'Connecting to the ETCS onboard ' + url + '…';
  ui.dirty = true;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    OBX.err = 'Invalid address or network not allowed in this page: open the page locally (dist/yutreno.html).';
    return;
  }
  OBX.ws = ws;
  ws.onopen = () => {
    OBX.ready = true;
    OBX.err = '';
    app.sim.event('INFO', 'External ETCS onboard connected (' + url + ')');
    ui.dirty = true;
  };
  ws.onmessage = e => {
    if (!OBX.waiting) return;
    OBX.waiting = false;
    OBX.rtt = performance.now() - OBX.sentAt;
    OBX.exchanges++;
    try {
      app.sim.onboardResponse(JSON.parse(String(e.data)));
    } catch (err) {
      OBX.err = 'Invalid onboard response: ' + String((err as Error).message || err);
      ui.paused = true;
      ui.dirty = true;
    }
  };
  ws.onerror = () => {
    OBX.err =
      'ETCS onboard not reachable on ' +
      url +
      '. Start the bridge to your EVC and press Restart; inside the published page the network is blocked.';
    ui.dirty = true;
  };
  ws.onclose = () => {
    if (OBX.ws === ws) {
      OBX.ws = null;
      OBX.ready = false;
      OBX.waiting = false;
      if (!OBX.err) OBX.err = 'ETCS onboard disconnected.';
      ui.paused = true;
      ui.dirty = true;
    }
  };
}

export function obClose(): void {
  if (OBX.ws) {
    const w = OBX.ws;
    OBX.ws = null;
    w.onclose = null;
    try {
      w.close();
    } catch (e) {
      /* already closed */
    }
  }
  OBX.ready = false;
  OBX.waiting = false;
  OBX.exchanges = 0;
  OBX.err = '';
}

/** To be called before every step: true if the simulation can advance, otherwise it waits for the onboard */
export function obStep(now: number): boolean {
  const sim = app.sim;
  if (!sim.onboardDue()) return true;
  if (!OBX.ready) return false;
  if (OBX.waiting) {
    if (now - OBX.sentAt > 5000) {
      OBX.err = 'The ETCS onboard has not responded for 5 s: run paused.';
      ui.paused = true;
      ui.dirty = true;
    }
    return false;
  }
  try {
    OBX.ws!.send(JSON.stringify(sim.onboardRequest()));
    OBX.waiting = true;
    OBX.sentAt = now;
  } catch (e) {
    OBX.err = 'Error sending to the onboard: ' + String((e as Error).message || e);
    ui.paused = true;
  }
  return false;
}

/** Status line for the interface */
export function obStatus(): string {
  if (!obUsed()) return '';
  if (OBX.err) return OBX.err;
  const m = app.sim.ob?.resp?.dmi.mode;
  return (
    'ETCS onboard ' +
    OBX.url +
    (m ? ' · mode ' + m : '') +
    ' · cycles ' +
    OBX.exchanges +
    ' · response ' +
    OBX.rtt.toFixed(1) +
    ' ms'
  );
}
