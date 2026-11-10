/**
 * The trains and the people of the 3D view (phase 8, R3): the train ahead, the service trains placed on the line the
 * world draws, the people waiting on the platforms, and the train the camera rides in (`viewTrain`), on any line of a
 * network.
 */
import * as THREE from 'three';
import { onLine } from '../core';
import type { TrainRun } from '../core';
import { F, app, hash, ui } from './state';
import { TRACK2, lineOf, placeAt, track2At } from './path3d';
import { v3 } from './view3d-state';

export const PEOPLE = 60;

export function buildLeader(steel: THREE.Material) {
  v3.leader = new THREE.Group();
  v3.leaderCars = [];
  const n = Math.max(1, Math.round(F.len / 15));
  const wagonMat = new THREE.MeshStandardMaterial({ color: '#6a4632', roughness: 0.8 });
  const locoMat = new THREE.MeshStandardMaterial({ color: '#2f5f8f', roughness: 0.6 });
  const bogieMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 });
  for (let i = 0; i < n; i++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, i === 0 ? 3.9 : 3.3, 14), i === 0 ? locoMat : wagonMat);
    body.position.y = i === 0 ? 2.75 : 2.45;
    body.castShadow = true;
    car.add(body);
    for (const z of [-4.8, 4.8]) {
      const bg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 2.8), bogieMat);
      bg.position.set(0, 0.55, z);
      car.add(bg);
    }
    if (i === n - 1)
      for (const x of [-1.0, 1.0]) {
        const l = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 10, 8),
          new THREE.MeshBasicMaterial({ color: '#ff3b30' }),
        );
        l.position.set(x, 1.3, 7.02);
        car.add(l);
        const gl = new THREE.Sprite(
          new THREE.SpriteMaterial({
            color: '#ff3b30',
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        gl.scale.set(0.9, 0.9, 1);
        gl.position.set(x, 1.3, 7.15);
        car.add(gl);
      }
    v3.leader.add(car);
    v3.leaderCars.push(car);
  }
  void steel;
  v3.world!.add(v3.leader);
}

/**
 * Figures of the people waiting, one per person up to PEOPLE per platform: their places are fixed when the world is
 * built (a deterministic function of the line, like the rest of the world); how many are shown follows the passengers
 * of the run. Those going towards the end of the line wait on the platform of track I, the others on that of track II
 */
export function buildPeople() {
  const n = v3.L.st.length * 2 * PEOPLE;
  const body = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.2, 0.24, 1.45, 7),
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    n,
  );
  const head = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#d9b08c', roughness: 0.7 }),
    n,
  );
  const coats = ['#3b4a6b', '#7a2e2e', '#2f5d50', '#5a5a5a', '#c58b2b', '#1f1f24', '#6b4f7a', '#2b6fa3'].map(
    c => new THREE.Color(c),
  );
  const spots: THREE.Matrix4[][] = [],
    tmp = new THREE.Object3D();
  v3.L.st.forEach((st, k) => {
    for (const side of [0, 1]) {
      const list: THREE.Matrix4[] = [];
      for (let i = 0; i < PEOPLE; i++) {
        const u = hash(st.s * 0.37 + i * 7.13 + side * 3.1),
          v = hash(st.s * 1.91 + i * 3.77 + side * 5.3);
        // track I: from 140 m before the marker to 25 m before it; track II: the mirror beyond the marker
        const s = side === 0 ? st.s - 25 - u * 115 : st.s + 25 + u * 115,
          d = side === 0 ? -(3.0 + v * 3.6) : TRACK2 + 3.0 + v * 3.6;
        placeAt(tmp, Math.min(v3.L.len, Math.max(0, s)), d, 0.55 + 0.72);
        tmp.rotateY(hash(i * 9.1 + k) * 6.28);
        tmp.updateMatrix();
        list.push(tmp.matrix.clone());
        const idx = (k * 2 + side) * PEOPLE + i;
        body.setColorAt(idx, coats[Math.floor(hash(idx * 1.7) * coats.length)]);
      }
      spots.push(list);
    }
  });
  const hidden = new THREE.Matrix4().makeTranslation(0, -1e4, 0);
  for (let i = 0; i < n; i++) {
    body.setMatrixAt(i, hidden);
    head.setMatrixAt(i, hidden);
  }
  body.castShadow = true;
  v3.world!.add(body, head);
  v3.people = { body, head, spots, shown: new Array(spots.length).fill(0) };
}

/** Shows as many figures as people waiting on each platform; nothing without passengers */
export function placePeople() {
  if (!v3.people) return;
  const sim = app.sim,
    px = sim.pax,
    idxOf = new Map(v3.L.st.map((st, k) => [st.name, k]));
  const hidden = new THREE.Matrix4().makeTranslation(0, -1e4, 0),
    up = new THREE.Matrix4().makeTranslation(0, 0.84, 0);
  let changed = false;
  v3.L.st.forEach((st, k) => {
    const by = px ? px.waitingTo(st.name, sim.time) : [];
    const fwd = by.filter(w => (idxOf.get(w.to) ?? -1) > k).reduce((a, w) => a + w.n, 0),
      back = by.filter(w => (idxOf.get(w.to) ?? k + 1) < k).reduce((a, w) => a + w.n, 0);
    [fwd, back].forEach((w, side) => {
      const p = k * 2 + side,
        want = Math.min(PEOPLE, Math.round(w));
      if (want === v3.people!.shown[p]) return;
      for (let i = 0; i < PEOPLE; i++) {
        const idx = p * PEOPLE + i,
          m = i < want ? v3.people!.spots[p][i] : hidden;
        v3.people!.body.setMatrixAt(idx, m);
        v3.people!.head.setMatrixAt(idx, i < want ? m.clone().multiply(up) : hidden);
      }
      v3.people!.shown[p] = want;
      changed = true;
    });
  });
  if (changed) {
    v3.people.body.instanceMatrix.needsUpdate = true;
    v3.people.head.instanceMatrix.needsUpdate = true;
    if (v3.people.body.instanceColor) v3.people.body.instanceColor.needsUpdate = true;
  }
}

/** Electric multiple units of the service trains: white body with a blue band, headlights at the front, red lamps at the back */
export function buildServices() {
  const sim = app.sim;
  for (const sv of v3.services) v3.world?.remove(sv.g);
  v3.services = [];
  v3.servicesFor = sim;
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#e9e8e2', roughness: 0.55 });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#1f5fae', roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1b2328', roughness: 0.2, metalness: 0.3 });
  const bogieMat = new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 });
  for (const r of sim.trains) {
    // the train ahead has its freight wagons (buildLeader)
    if (r === sim.leader) continue;
    // the driven train too, seen from outside when the view rides in another cab
    const n = Math.max(1, Math.round(r.TR.L / 26)),
      cl = r.TR.L / n;
    const g = new THREE.Group(),
      cars: THREE.Object3D[] = [];
    for (let i = 0; i < n; i++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.4, cl - 0.8), bodyMat);
      body.position.y = 2.35;
      body.castShadow = true;
      car.add(body);
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.92, 0.5, cl - 0.8), bandMat);
      band.position.y = 1.35;
      car.add(band);
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.94, 0.8, cl - 3), glassMat);
      win.position.y = 2.7;
      car.add(win);
      for (const z of [-(cl / 2 - 3.2), cl / 2 - 3.2]) {
        const bg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 2.8), bogieMat);
        bg.position.set(0, 0.55, z);
        car.add(bg);
      }
      const lamp = (z: number, col: string) => {
        for (const x of [-0.95, 0.95]) {
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
              color: col,
              transparent: true,
              opacity: 0.9,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          sp.scale.set(0.8, 0.8, 1);
          sp.position.set(x, 1.15, z);
          car.add(sp);
        }
      };
      if (i === 0) lamp(-(cl - 0.8) / 2 - 0.05, '#fff4d8');
      if (i === n - 1) lamp((cl - 0.8) / 2 + 0.05, '#ff3b30');
      g.add(car);
      cars.push(car);
    }
    v3.world?.add(g);
    v3.services.push({ id: r.id, g, cars, cl });
  }
}

/** Places the service trains: on the main track, the trains running back on the second track in stations */
export function placeServices() {
  const sim = app.sim;
  if (v3.servicesFor !== sim || (v3.services[0] && !v3.world?.children.includes(v3.services[0].g))) buildServices();
  const seat = viewTrain();
  for (const sv of v3.services) {
    const r = sim.trains.find(x => x.id === sv.id);
    sv.g.visible = !!r && r.active && !r.S.finished && r !== seat;
    if (!r || !sv.g.visible) continue;
    // the world draws one line of the network: the cars on the other lines are hidden
    sv.cars.forEach((car, i) => {
      const m = chainageOn(r, v3.lineIdx, r.S.s - (sv.cl / 2 + i * sv.cl));
      if (m == null || m.s < 0 || m.s > v3.L.len) {
        car.visible = false;
        return;
      }
      car.visible = true;
      placeAt(car, m.s, m.dir > 0 ? 0 : track2At(m.s), 0);
      if (m.dir < 0) car.rotateY(Math.PI);
    });
  }
}

/** Where the point at corridor chainage s of a train is on line j: chainage of the line and direction; null if not on it */
export function chainageOn(r: TrainRun, j: number, s: number): { s: number; dir: 1 | -1 } | null {
  const sim = app.sim;
  if (j === 0) {
    const m = sim.mainChainage(r, s);
    return m == null ? null : { s: m, dir: r.cor.sigRef ? (onLine(r.legs, 0, s, 0)?.dir ?? r.dir) : r.dir };
  }
  const p = onLine(r.legs, j, s, 0);
  return p ? { s: p.dir > 0 ? p.head : lineOf(j).len - p.head, dir: p.dir } : null;
}

/** Line of the network a train's head is on: the one the world draws if it is still there, else the main line, else the first */
export function lineOfTrain(r: TrainRun): number | null {
  const n = app.sim.net.lines.length;
  if (chainageOn(r, v3.lineIdx, r.S.s)) return v3.lineIdx;
  for (let j = 0; j < n; j++) if (chainageOn(r, j, r.S.s)) return j;
  return null;
}

/**
 * The train the camera rides in: the one chosen in the page while it runs, on any line of the network (the world is
 * rebuilt from the line it is on), otherwise the driven train
 */
export function viewTrain(): TrainRun {
  const sim = app.sim,
    r = ui.ride ? sim.trains.find(x => x.id === ui.ride) : null;
  if (r && r !== sim.train && r.active && !r.S.finished && lineOfTrain(r) != null) return r;
  return sim.train;
}

/** Name of the line the view draws, for the page: null on the main line */
export function viewLine(): string | null {
  return v3.lineIdx === 0 ? null : lineOf(v3.lineIdx).def.name;
}
