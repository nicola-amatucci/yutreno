/**
 * Trackside component: interlocking and RBC behind a single request/response protocol.
 *
 * At every trackside cycle the engine sends the telegrams of the field (SCI-P, SCI-TDS), the radio messages of the
 * onboard and the control centre commands; the trackside answers with the commands to the field elements, the radio
 * messages for the onboard and the state of the panel. The component does not know the engine: the same class runs in
 * process or, through `examples/trackside/trackside_stdio.ts`, as an external program connected via exec:, TCP or
 * WebSocket. Requests in the Italian format of YuTreno 0.x are accepted (see `legacy.ts`).
 */
import { toEnglish } from '../core/legacy';
import { Interlocking, type BoundaryMessage, type RbcInfo, type TrainPos } from './interlocking';
import { TracksideRbc } from './rbc';
import type { CorridorConfig, InterlockingConfig, NrbcMessage, OperatorCommand, TracksideConfig, PanelState, TracksideRequest, TracksideResponse } from './types';
import type { RadioMessage } from '../core/types';

export * from './types';
export * from './control-table';
export { Interlocking, APPROACH_M, DECISION_M, type BoundaryMessage, type RbcInfo, type TrainPos } from './interlocking';
export { TracksideRbc, RbcSession, mergeLim } from './rbc';

export class Trackside {
  private ixl!: Interlocking;
  /** On a network: one interlocking per line, the main one first */
  private ixls: Interlocking[] = [];
  private rbc!: TracksideRbc;
  /** Several RBCs (`cfg.rbcs`): one per area, in the order of the line; otherwise just `rbc` */
  private rbcs: TracksideRbc[] = [];
  /** Messages between the RBCs sent in the last cycle, delivered in the next one; the RBC–RBC link */
  private nNext: NrbcMessage[] = [];
  private linkUp = true;
  private cfg!: TracksideConfig;
  /** Boundary messages sent in the last cycle, delivered in the next one */
  private bNext: BoundaryMessage[] = [];

  step(req: TracksideRequest): TracksideResponse {
    req = toEnglish<TracksideRequest>(req);
    if (req.start) {
      if (!req.configuration) throw new Error('the first request to the trackside must contain the configuration');
      this.cfg = req.configuration;
      const net = this.cfg.network;
      this.ixl = new Interlocking(this.cfg, net ? { id: net.main, boundaries: net.boundaries } : {});
      this.ixls = [this.ixl, ...(net?.interlockings ?? []).map(ic => new Interlocking(lineConfig(this.cfg, ic), { id: ic.id, boundaries: net?.boundaries, controlled: false }))];
      const ar = this.cfg.rbcs;
      this.rbcs = ar ? ar.areas.map(a => new TracksideRbc(this.cfg, { nid: a.NID_RBC, from: a.from_m, to: a.to_m, cfg: ar })) : [];
      this.rbc = this.rbcs[0] ?? new TracksideRbc(this.cfg);
      this.bNext = []; this.nNext = []; this.linkUp = true;
    }
    const ixl = this.ixl, ixls = this.ixls, multi = this.rbcs.length > 0;
    for (const x of ixls) x.receive(req.field);
    const warn: { type: 'WARN'; text: string }[] = [];
    for (const m of req.radio) {
      const to = this.route(m);
      if (to) to.receive(m, req.t);
      else warn.push({ type: 'WARN', text: `radio message ${m.NID_MESSAGE} of engine ${m.NID_ENGINE ?? 1} for RBC ${m.NID_RBC}, which does not exist: discarded` });
    }
    // the supervising session of every train: with several RBCs the one of the RBC that has taken it over
    const rbc = multi ? this.supervising() : this.rbc;
    const covered = () => new Set((multi ? this.rbcs : [rbc]).flatMap(r => [...r.sessions.values()].flatMap(s => s.ma?.routes ?? [])));
    const info = (x: Interlocking): RbcInfo => {
      const trains = [...rbc.sessions.values()].flatMap((s): TrainPos[] => {
        const p = rbc.position(s.engine);
        if (p == null) return [];
        const cor = rbc.corridors.get(s.engine);
        if (!cor) return x === ixl ? [{ engine: s.engine, x: p, ...(s.dir < 0 ? { dir: -1 as const } : {}) }] : [];
        const at = onCorridorLine(cor, x.id, x.cfg.line.length_m, p);
        return at ? [{ engine: s.engine, ...at }] : [];
      });
      return { train: x === ixl && !rbc.corridors.has(1) ? rbc.position() : null, covered: covered(), trains };
    };
    for (const c of req.commands) this.command(c, req.t, info);
    for (const x of ixls) x.deliver(this.bNext.filter(m => m.to === x.id));
    const field = ixls.flatMap(x => x.cycle(req.t, info(x)));
    this.bNext = ixls.flatMap(x => x.bOut.splice(0));
    let radio: RadioMessage[];
    if (multi) {
      // messages between RBCs take one cycle, and are lost while the RBC–RBC link is down
      for (const m of this.linkUp ? this.nNext : []) this.rbcs.find(r => r.area?.nid === m.to)?.receiveNrbc(m, req.t);
      radio = this.rbcs.flatMap(r => r.cycle(req.t, ixl, ixls));
      this.nNext = this.rbcs.flatMap(r => r.nrbcOut.splice(0));
    } else radio = rbc.cycle(req.t, ixl, ixls);
    // the panel shows the authorities after this cycle: with several RBCs, of the RBC that supervises each train now
    const pv = multi ? this.supervising() : rbc;
    const panels = ixls.map(x => x.panel());
    const consents = panels.flatMap(p => p.consents ?? []);
    const bounds = (this.cfg.network?.boundaries ?? []).map(b => {
      const h = ixls.find(x => x.holdsBoundary(b.id));
      return { segment: `node ${b.node} (${b.a}–${b.b})`, holder: h ? h.id : null };
    });
    const panel: PanelState = {
      ars: ixl.ars,
      routes: panels.flatMap(p => p.routes), points: panels.flatMap(p => p.points), tvps: panels.flatMap(p => p.tvps),
      ...(panels.some(p => p.consents) || bounds.length ? { consents: [...consents, ...bounds] } : {}),
      ma: pv.ma ? { eoa_m: pv.ma.eoa, svl_m: pv.ma.svl, reason: pv.ma.reason, ...(multi ? { NID_RBC: this.owner(1) } : {}) } : null,
      // authorities in line chainages, also for the trains running towards the origin; along a corridor in its chainages
      ...(pv.sessions.size > 1 ? { sessions: [...pv.sessions.values()].filter(s => s.ma).map(s => pv.corridors.has(s.engine)
        ? { engine: s.engine, eoa_m: s.ma!.eoa, svl_m: s.ma!.svl, reason: s.ma!.reason, head_m: pv.position(s.engine), frame: 'corridor' as const, routes: s.ma!.routes, ...(multi ? { NID_RBC: this.owner(s.engine) } : {}) }
        : { engine: s.engine, eoa_m: pv.line(s.ma!.eoa, s.dir), svl_m: pv.line(s.ma!.svl, s.dir), reason: s.ma!.reason, head_m: pv.position(s.engine), ...(s.dir < 0 ? { dir: -1 as const } : {}), routes: s.ma!.routes, ...(multi ? { NID_RBC: this.owner(s.engine) } : {}) }) } : {}),
      speed_restrictions: [...pv.tsr.entries()].map(([id, z]) => ({ id, ...z })),
      ...(multi ? {
        rbcs: this.rbcs.map(r => ({ NID_RBC: r.area!.nid, sessions: [...r.sessions.keys()], handovers: [
          ...[...r.sessions.values()].filter(z => z.hov).map(z => ({ engine: z.engine, role: 'HOV' as const, border_m: z.hov!.border.s_m, step: z.hov!.tor ? 'taken over' : z.hov!.rri ? 'route information' : z.hov!.acked ? 'requested' : 'pre-announced' })),
          ...[...r.accT.entries()].map(([engine, a]) => ({ engine, role: 'ACC' as const, border_m: a.border.s_m, step: a.requested ? 'route information' : 'pre-announced' })),
        ] })),
        rbc_link: this.linkUp ? 'up' as const : 'lost' as const,
      } : {}),
    };
    const events = [...warn, ...ixls.flatMap(x => x.events.splice(0))];
    return { field, radio, panel, ...(events.length ? { events } : {}) };
  }

  /**
   * The RBC a radio message is for: its NID_RBC, else the RBC in session with the train, else the one of the area of its
   * LRBG; none if it names an RBC that does not exist (the message is discarded with a warning)
   */
  private route(m: RadioMessage): TracksideRbc | null {
    if (!this.rbcs.length) return this.rbc;
    if (typeof m.NID_RBC === 'number') return this.rbcs.find(r => r.area?.nid === m.NID_RBC) ?? null;
    const engine = typeof m.NID_ENGINE === 'number' ? m.NID_ENGINE : 1;
    const own = this.rbcs.find(r => r.sessions.has(engine));
    if (own) return own;
    const p0 = (m.packets || []).find(p => p.NID_PACKET === 0 || p.NID_PACKET === 1);
    const bg = this.cfg.balises.find(b => b.NID_BG === Number(p0?.NID_LRBG) % 16384);
    return (bg && this.rbcs.find(r => bg.s_m >= r.area!.from && bg.s_m < r.area!.to)) || this.rbc;
  }

  /**
   * A view of the sessions of all the RBCs with, for every train, the session of the RBC that supervises it: the
   * Handing Over one until the Accepting one has taken it over
   */
  /** Several RBCs: the RBC that supervises a train now */
  private owner(engine: number): number | undefined {
    const s = this.supervising().sessions.get(engine);
    return this.rbcs.find(r => r.sessions.get(engine) === s)?.area?.nid;
  }

  private supervising(): TracksideRbc {
    const view = new TracksideRbc(this.cfg);
    for (const r of this.rbcs) for (const s of r.sessions.values()) {
      const old = view.sessions.get(s.engine);
      if (!old || (old.hov?.tor && s.report) || (s.hov && !s.hov.tor)) view.sessions.set(s.engine, s);
    }
    for (const [k, v] of this.rbc.tsr) view.tsr.set(k, v);
    for (const [k, v] of this.rbc.corridors) view.corridors.set(k, v);
    return view;
  }

  private command(c: OperatorCommand, t: number, info: (x: Interlocking) => RbcInfo): void {
    if (c.type === 'rbc_link') { this.linkUp = c.up; return; }
    if (c.type === 'speed_restriction' || c.type === 'revoke_speed_restriction' || c.type === 'emergency_stop' || c.type === 'revoke_emergency_stop') {
      for (const r of this.rbcs.length ? this.rbcs : [this.rbc]) r.command(c);
      return;
    }
    if (c.type === 'set_route' || c.type === 'cancel_route') {
      // the interlocking that has the route
      const x = this.ixls.find(z => z.routes.has(c.id)) ?? this.ixl;
      x.command(c, t, info(x));
      return;
    }
    if (c.type === 'ars') { for (const x of this.ixls) x.command(c, t, info(x)); return; }
    if (c.type === 'corridor') { for (const r of this.rbcs.length ? this.rbcs : [this.rbc]) r.corridors.set(c.engine, c.corridor); return; }
    if (c.type === 'timetable') {
      const x = c.line ? this.ixls.find(z => z.id === c.line) : this.ixl;
      if (x) x.command(c, t, info(x));
      return;
    }
    // timetables and priorities: every interlocking that routes the train
    for (const x of this.ixls) if (x === this.ixl || x.knows(c.engine)) x.command(c, t, info(x));
  }
}

/** Configuration of the interlocking of a line of a network: its engineering data with the parameters of the trackside */
function lineConfig(cfg: TracksideConfig, ic: InterlockingConfig): TracksideConfig {
  return {
    line: { name: ic.line.name, length_m: ic.line.length_m, limits: [], gradients: [] }, balises: [],
    tvps: ic.tvps, points: ic.points, markers: ic.markers, routes: ic.routes, timetable: ic.timetable, trains: ic.trains, parameters: cfg.parameters,
  };
}

/**
 * Where a train at corridor chainage c is on line `line` of the network, in its chainages: on the leg along that line,
 * or, before the train gets there or after it has left, where it would be if the line went on beyond the node
 */
export function onCorridorLine(cor: CorridorConfig, line: string, len: number, c: number): Omit<TrainPos, 'engine'> | null {
  const g = cor.legs.find(l => l.line === line);
  if (!g) return null;
  const d = g.d0_m + (c - g.c0_m), x = g.dir > 0 ? d : len - d;
  const ahead = g.from_m != null && c < g.from_m - 1e-6, behind = g.to_m != null && c > g.to_m + 1e-6;
  return { x, ...(g.dir < 0 ? { dir: -1 as const } : {}), ...(ahead ? { ahead: true } : {}), ...(behind ? { behind: true } : {}) };
}
