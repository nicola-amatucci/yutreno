/**
 * The 3D world of a line (phase 8, R3): the path of the line in space, the terrain with its noise, cuttings and
 * tunnels, the textures, and `buildWorld`, which builds track, sleepers, catenary, stations, signals, tunnels,
 * vegetation and landmarks. It is a deterministic function of the compiled line.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { altOf, tunnelOf } from '../core';
import { app, hash } from './state';
import { P, ST_HALF, TRACK2, frame, lineOf, placeAt, sstep, track2At } from './path3d';
import { buildLeader, buildPeople } from './trains3d';
import { QUALITY, UP, signals, v3 } from './view3d-state';

// ---------- noise for the terrain ----------
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi;
  const h = (i: number, j: number) => hash(i * 157.31 + j * 311.7);
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
export const fbm = (x: number, y: number) =>
  vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;

export function tunnelHump(s: number) {
  let h = 0;
  for (const [a, b] of v3.L.tun) h = Math.max(h, sstep(a - 90, a, s) * (1 - sstep(b, b + 90, s)));
  return h;
}
export function inCutting(s: number) {
  for (const [a, b] of v3.L.tun) if (s >= a - 90 && s <= b + 90 && (s < a || s > b)) return true;
  return false;
}
export function terrainH(s: number, d: number, wx: number, wz: number) {
  const ad = Math.abs(d),
    amp = v3.L.iup > 15 ? 48 : 20;
  const w = sstep(7, 150, ad);
  const hills = (fbm(wx * 0.0035, wz * 0.0035) - 0.42) * amp * 2 + (fbm(wx * 0.03, wz * 0.03) - 0.5) * 3;
  let h = -0.95 + w * Math.max(hills, -6 - ad * 0.01);
  const th = tunnelHump(s);
  if (th > 0) {
    const open = s < tunAt(s, 'a') + 12 || s > tunAt(s, 'b') - 12 ? sstep(4.5, 16, ad) : 1;
    const mount = th * open * (16 + 0.25 * Math.min(ad, 60)) * (1 - sstep(140, 380, ad));
    h = Math.max(h, -0.95 + mount);
  }
  // far from the track the terrain rises into wider hills, which close the horizon
  const e = sstep(260, 900, ad);
  const far = 6 + fbm(wx * 0.0011 + 3, wz * 0.0011 - 7) * (v3.L.iup > 15 ? 230 : 95);
  return h * (1 - e) + far * e;
}
export function tunAt(s: number, k: 'a' | 'b') {
  let best: [number, number] | null = null,
    bd = Infinity;
  for (const t of v3.L.tun) {
    const d = Math.min(Math.abs(s - t[0]), Math.abs(s - t[1]), s >= t[0] && s <= t[1] ? 0 : Infinity);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best ? (k === 'a' ? best[0] : best[1]) : k === 'a' ? Infinity : -Infinity;
}

// ---------- procedural textures ----------
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = false) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}
export const speckle = (base: string, dots: string[], n: number) => (c: CanvasRenderingContext2D) => {
  const w = c.canvas.width,
    h = c.canvas.height;
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    c.fillStyle = dots[i % dots.length];
    const r = 0.6 + hash(i * 3.3) * 2.2;
    c.beginPath();
    c.arc(hash(i * 1.7) * w, hash(i * 2.9) * h, r, 0, 7);
    c.fill();
  }
};

// ---------- geometries swept along the track ----------
/** Sweeps a section [d, h] along the track from s0 to s1 */
export function sweep(s0: number, s1: number, ds: number, sec: [number, number][], uvScale = 4, closed = false) {
  const pos: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const m = sec.length,
    perim = [0];
  for (let j = 1; j < m; j++)
    perim.push(perim[j - 1] + Math.hypot(sec[j][0] - sec[j - 1][0], sec[j][1] - sec[j - 1][1]));
  let rows = 0;
  for (let s = s0; s <= s1 + 1e-6; s += ds) {
    const { p, r } = frame(Math.min(s, s1));
    for (let j = 0; j < m; j++) {
      const [d, h] = sec[j];
      pos.push(p.x + r.x * d, p.y + h, p.z + r.z * d);
      uv.push(perim[j] / uvScale, s / uvScale);
    }
    rows++;
  }
  const segs = closed ? m : m - 1;
  for (let k = 0; k < rows - 1; k++)
    for (let j = 0; j < segs; j++) {
      const a = k * m + j,
        b = k * m + ((j + 1) % m),
        c = (k + 1) * m + j,
        d = (k + 1) * m + ((j + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildTerrain(mat: THREE.Material) {
  const D = [
    -1500, -1000, -650, -420, -260, -160, -100, -60, -36, -22, -13, -8, -5.2, -3.4, 3.4, 5.2, 8, 13, 22, 36, 60, 100,
    160, 260, 420, 650, 1000, 1500,
  ];
  const pos: number[] = [],
    col: number[] = [],
    uv: number[] = [],
    idx: number[] = [];
  const grass = new THREE.Color('#6f8a4a'),
    grass2 = new THREE.Color('#8c9a58'),
    dark = new THREE.Color('#4d6a3c'),
    rock = new THREE.Color('#8a8576'),
    gravel = new THREE.Color('#77706a');
  const c = new THREE.Color();
  let rows = 0;
  for (let s = -300; s <= v3.L.len + 300; s += 10) {
    const sc = Math.max(0, Math.min(v3.L.len, s)),
      { p, r, f } = frame(sc);
    const ext = s - sc;
    for (const d of D) {
      const wx = p.x + r.x * d + f.x * ext,
        wz = p.z + r.z * d + f.z * ext;
      const h = p.y + terrainH(sc, d, wx, wz);
      pos.push(wx, h, wz);
      uv.push(wx / 7, wz / 7);
      const n = fbm(wx * 0.02, wz * 0.02),
        ad = Math.abs(d);
      c.copy(grass)
        .lerp(grass2, n)
        .lerp(dark, sstep(0.55, 0.85, fbm(wx * 0.006 + 5, wz * 0.006)) * 0.7);
      if (ad < 5.3) c.copy(gravel);
      const steep = h - p.y > 6 && ad < 30 ? 0.6 : 0;
      if (steep) c.lerp(rock, steep);
      col.push(c.r, c.g, c.b);
    }
    rows++;
  }
  const m = D.length;
  for (let k = 0; k < rows - 1; k++)
    for (let j = 0; j < m - 1; j++) {
      const a = k * m + j,
        b = a + 1,
        cc = a + m,
        d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function textPlane(text: string, w: number, h: number, bg: string, fg: string) {
  const t = canvasTex(512, Math.round((512 * h) / w), c => {
    const W = c.canvas.width,
      H = c.canvas.height;
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = fg;
    c.lineWidth = H * 0.05;
    c.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12);
    c.fillStyle = fg;
    c.font = `600 ${Math.round(H * 0.46)}px 'IBM Plex Sans',Arial,sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, W / 2, H / 2, W * 0.9);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
}

// ---------- building the world ----------
export function buildWorld() {
  if (v3.world) {
    v3.scene.remove(v3.world);
    v3.world.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  v3.L = lineOf(v3.lineIdx);
  v3.A0 = altOf(v3.L, 0);
  v3.world = new THREE.Group();
  signals.length = 0;
  const q = QUALITY[v3.quality];

  const gravelTex = canvasTex(256, 256, speckle('#8a847b', ['#6c665e', '#a39d93', '#5c5751', '#b3ada3'], 2600), true);
  const grassTex = canvasTex(
    256,
    256,
    c => {
      // tufts of grass: light and dark dashes on a neutral ground, multiplied by the vertex colour
      c.fillStyle = '#e6e6e6';
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5200; i++) {
        const x = hash(i * 1.31) * 256,
          y = hash(i * 2.77) * 256,
          l = 2 + hash(i * 3.9) * 5,
          a = (hash(i * 5.3) - 0.5) * 0.9;
        const v = Math.round(150 + hash(i * 7.1) * 105);
        c.strokeStyle = `rgb(${v},${v},${v})`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l);
        c.stroke();
      }
    },
    true,
  );
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grassTex, roughness: 1 });
  v3.world.add(buildTerrain(terrainMat));

  // ballast
  const ballast = new THREE.Mesh(
    sweep(
      0,
      v3.L.len,
      5,
      [
        [3.0, -0.95],
        [1.75, -0.24],
        [-1.75, -0.24],
        [-3.0, -0.95],
      ],
      1.5,
    ),
    new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1, color: '#bdb6aa' }),
  );
  ballast.receiveShadow = true;
  v3.world.add(ballast);

  // rails: simplified I-beam profile
  const rail = (o: number): [number, number][] => [
    [o - 0.075, -0.172],
    [o + 0.075, -0.172],
    [o + 0.075, -0.16],
    [o + 0.009, -0.15],
    [o + 0.009, -0.05],
    [o + 0.036, -0.045],
    [o + 0.036, 0],
    [o - 0.036, 0],
    [o - 0.036, -0.045],
    [o - 0.009, -0.05],
    [o - 0.009, -0.15],
    [o - 0.075, -0.16],
  ];
  const railMat = new THREE.MeshStandardMaterial({ color: '#8d8f93', metalness: 0.85, roughness: 0.35 });
  const rg = mergeGeometries([
    sweep(0, v3.L.len, 3, rail(-0.7535), 1, true),
    sweep(0, v3.L.len, 3, rail(0.7535), 1, true),
  ]);
  const rails = new THREE.Mesh(rg, railMat);
  rails.castShadow = true;
  v3.world.add(rails);

  // sleepers: instances in a window ahead of the camera, updated while running
  v3.sleepers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.6, 0.17, 0.26),
    new THREE.MeshStandardMaterial({ color: '#9b958c', roughness: 0.9 }),
    q.sleepers,
  );
  v3.sleepers.castShadow = true;
  v3.sleepers.receiveShadow = true;
  v3.sleepers.frustumCulled = false;
  v3.lastSleeperS = -1e9;
  v3.world.add(v3.sleepers);
  // sleepers of the second track of the stations, fixed, every 0.6 m; in the turnouts, where the two tracks are still
  // closer than a sleeper length, the rails of the second track rest on the sleepers of the main one
  const sl2: { s: number; d: number; w: number; h: number }[] = [];
  for (const st of v3.L.st)
    for (let x = Math.ceil(Math.max(0, st.s - ST_HALF) / 0.6) * 0.6; x < Math.min(v3.L.len, st.s + ST_HALF); x += 0.6) {
      const d = track2At(x);
      if (d >= 2.7) sl2.push({ s: x, d, w: 2.6, h: -0.255 });
    }
  if (sl2.length) {
    const sleepers2 = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.17, 0.26),
      v3.sleepers.material as THREE.Material,
      sl2.length,
    );
    const t2 = new THREE.Object3D();
    sl2.forEach((x, i) => {
      placeAt(t2, x.s, x.d, x.h);
      t2.scale.set(x.w, 1, 1);
      t2.updateMatrix();
      sleepers2.setMatrixAt(i, t2.matrix);
    });
    sleepers2.castShadow = true;
    sleepers2.receiveShadow = true;
    v3.world.add(sleepers2);
  }

  // catenary: masts, cantilevers and wires
  const poleS: number[] = [];
  for (let s = 30; s < v3.L.len; s += 60) if (!tunnelOf(v3.L, s)) poleS.push(s);
  const steel = new THREE.MeshStandardMaterial({ color: '#6e7478', metalness: 0.6, roughness: 0.5 });
  const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 7.2, 0.26), steel, poleS.length);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.12, 0.12), steel, poleS.length);
  const tmp = new THREE.Object3D();
  poleS.forEach((s, i) => {
    // in stations and turnouts the masts stand beyond the second track and the cantilevers span both tracks
    const d2 = track2At(s),
      dm = d2 > 0.05 ? d2 + 3.4 : 3.4;
    placeAt(tmp, s, dm, 2.65);
    tmp.updateMatrix();
    poles.setMatrixAt(i, tmp.matrix);
    placeAt(tmp, s, dm / 2 + 0.05, 6.15);
    tmp.scale.set(dm / 3.4, 1, 1);
    tmp.updateMatrix();
    arms.setMatrixAt(i, tmp.matrix);
    tmp.scale.set(1, 1, 1);
  });
  poles.castShadow = arms.castShadow = true;
  v3.world.add(poles, arms);
  const wirePts: number[] = [],
    msgPts: number[] = [];
  for (let s = 0; s < v3.L.len; s += 10) {
    const a = P(s),
      b = P(Math.min(v3.L.len, s + 10)),
      inT = !!tunnelOf(v3.L, s);
    const hc = inT ? 5.2 : 5.6,
      hm = inT ? 5.7 : 6.7;
    wirePts.push(a.x, a.y + hc, a.z, b.x, b.y + hc, b.z);
    msgPts.push(a.x, a.y + hm, a.z, b.x, b.y + hm, b.z);
  }
  // contact wire of the second track in stations
  for (const st of v3.L.st)
    for (let x = Math.max(0, st.s - ST_HALF); x < Math.min(v3.L.len, st.s + ST_HALF) - 10; x += 10) {
      const fa = frame(x),
        fb2 = frame(x + 10),
        da = track2At(x),
        db = track2At(x + 10);
      if (da < 0.05 && db < 0.05) continue;
      wirePts.push(
        fa.p.x + fa.r.x * da,
        fa.p.y + 5.6,
        fa.p.z + fa.r.z * da,
        fb2.p.x + fb2.r.x * db,
        fb2.p.y + 5.6,
        fb2.p.z + fb2.r.z * db,
      );
    }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts.concat(msgPts), 3));
  v3.world.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#2a2e31' })));

  // kilometre posts
  const kms: number[] = [];
  for (let s = 100; s < v3.L.len; s += 100) if (!tunnelOf(v3.L, s)) kms.push(s);
  const km = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 0.9, 0.16),
    new THREE.MeshStandardMaterial({ color: '#f1f0ea' }),
    kms.length,
  );
  kms.forEach((s, i) => {
    placeAt(tmp, s, 2.6, -0.5);
    tmp.updateMatrix();
    km.setMatrixAt(i, tmp.matrix);
  });
  v3.world.add(km);

  // tunnels: inner vault, lights and portals
  const concrete = new THREE.MeshStandardMaterial({ color: '#5e5e5a', roughness: 0.95, side: THREE.DoubleSide });
  const arch: [number, number][] = [
    [4.3, -0.95],
    [4.3, 2.2],
  ];
  for (let k = 0; k <= 14; k++) {
    const a = (Math.PI * k) / 14;
    arch.push([4.3 * Math.cos(a), 2.2 + 4.3 * Math.sin(a)]);
  }
  arch.push([-4.3, 2.2], [-4.3, -0.95]);
  const stone = new THREE.MeshStandardMaterial({ color: '#8f887b', roughness: 0.95 });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#ffd38a' });
  for (const [a, b] of v3.L.tun) {
    v3.world.add(new THREE.Mesh(sweep(a, b, 6, arch, 3, true), concrete));
    const n = Math.floor((b - a) / 25);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), lampMat, n);
    for (let i = 0; i < n; i++) {
      placeAt(tmp, a + 12 + i * 25, -4.15, 3.4);
      tmp.updateMatrix();
      lamps.setMatrixAt(i, tmp.matrix);
    }
    v3.world.add(lamps);
    for (const [s, dir] of [
      [a, 1],
      [b, -1],
    ] as [number, number][]) {
      const shape = new THREE.Shape();
      shape.moveTo(-14, -1.2);
      shape.lineTo(14, -1.2);
      shape.lineTo(14, 12);
      shape.lineTo(-14, 12);
      shape.lineTo(-14, -1.2);
      const hole = new THREE.Path();
      hole.moveTo(4.3, -1.2);
      hole.lineTo(4.3, 2.2);
      hole.absarc(0, 2.2, 4.3, 0, Math.PI, false);
      hole.lineTo(-4.3, -1.2);
      hole.lineTo(4.3, -1.2);
      shape.holes.push(hole);
      const face = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 1.6, bevelEnabled: false }), stone);
      placeAt(face, s, 0, 0);
      if (dir < 0) face.rotateY(Math.PI);
      face.translateZ(-0.2);
      face.castShadow = face.receiveShadow = true;
      v3.world.add(face);
    }
  }

  // stations
  const platMat = new THREE.MeshStandardMaterial({ color: '#b9b2a6', roughness: 0.9 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: '#e1bd2b', roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({
    color: '#7a848a',
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const wallMats = ['#d9c4a0', '#e2d3b6', '#cfb38f'].map(
    c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }),
  );
  const tileMat = new THREE.MeshStandardMaterial({ color: '#9b4a35', roughness: 0.8 });
  const winTex = canvasTex(
    128,
    128,
    c => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, 128, 128);
      c.fillStyle = '#3c4a55';
      for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) c.fillRect(18 + k * 56, 16 + r * 60, 36, 40);
    },
    true,
  );
  // second track of the stations, on the right, joined to the line by the turnouts at both ends: every
  // cross-section of rails and ballast is shifted sideways by the offset of the second track at its chainage
  const bent = (a: number, b: number, ds: number, sec: [number, number][], uv: number, closed: boolean) => {
    const g = sweep(a, b, ds, sec, uv, closed),
      pp = g.attributes.position,
      m = sec.length,
      rows = pp.count / m;
    for (let k = 0; k < rows; k++) {
      const sk = Math.min(b, a + k * ds),
        d = track2At(sk),
        { r } = frame(sk);
      for (let j = 0; j < m; j++) {
        const i = k * m + j;
        pp.setXYZ(i, pp.getX(i) + r.x * d, pp.getY(i), pp.getZ(i) + r.z * d);
      }
    }
    g.computeVertexNormals();
    return g;
  };
  for (const st of v3.L.st) {
    const a = Math.max(0, st.s - ST_HALF),
      b = Math.min(v3.L.len, st.s + ST_HALF);
    v3.world.add(
      new THREE.Mesh(
        mergeGeometries([bent(a, b, 3, rail(-0.7535), 1, true), bent(a, b, 3, rail(0.7535), 1, true)]),
        railMat,
      ),
    );
    // from the very start of the turnouts, 2 cm below the main ballast so that where they overlap the main one covers it
    const bal = new THREE.Mesh(
      bent(
        a,
        b,
        5,
        [
          [3.0, -0.97],
          [1.75, -0.28],
          [-1.75, -0.28],
          [-3.0, -0.97],
        ],
        1.5,
        false,
      ),
      ballast.material,
    );
    bal.receiveShadow = true;
    v3.world.add(bal);
  }
  for (const st of v3.L.st) {
    const a = Math.max(0, st.s - 180),
      b = Math.min(v3.L.len, st.s + 60);
    const plat = new THREE.Mesh(
      sweep(
        a,
        b,
        5,
        [
          [-1.72, -0.95],
          [-1.72, 0.55],
          [-7.5, 0.55],
          [-7.5, -0.95],
        ],
        2,
      ),
      platMat,
    );
    plat.receiveShadow = true;
    v3.world.add(plat);
    v3.world.add(
      new THREE.Mesh(
        sweep(
          a,
          b,
          5,
          [
            [-2.0, 0.556],
            [-2.3, 0.556],
          ],
          1,
        ),
        edgeMat,
      ),
    );
    const ca = Math.max(a, st.s - 150),
      cb = Math.min(b, st.s - 30);
    const canopy = new THREE.Mesh(
      sweep(
        ca,
        cb,
        5,
        [
          [-2.2, 4.2],
          [-7.2, 4.6],
          [-7.2, 4.4],
          [-2.2, 4.0],
        ],
        2,
        true,
      ),
      roofMat,
    );
    canopy.castShadow = true;
    v3.world.add(canopy);
    for (let s = ca + 6; s < cb; s += 12) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8), steel);
      placeAt(post, s, -5.6, 2.35);
      post.castShadow = true;
      v3.world.add(post);
    }
    const bld = new THREE.Group();
    const wm = wallMats[Math.floor(hash(st.s) * 3)].clone();
    wm.map = winTex.clone();
    wm.map.repeat.set(5, 2);
    wm.map.needsUpdate = true;
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 7.5, 22), wm);
    body.position.y = 3.75;
    body.castShadow = body.receiveShadow = true;
    bld.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 6.2, 2.6, 4, 1), tileMat);
    roof.scale.set(1, 1, 2.6);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 8.8;
    roof.castShadow = true;
    const roof2 = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.4, 23), tileMat);
    roof2.position.y = 7.7;
    bld.add(roof2);
    placeAt(bld, st.s - 95, -13.5, 0.55);
    v3.world.add(bld);
    for (const off of [-70, -155]) {
      if (st.s + off < 0) continue;
      const board = textPlane(st.name, 2.8, 0.62, '#1f4f9d', '#ffffff');
      const g = new THREE.Group();
      board.position.y = 2.75;
      g.add(board);
      const back = board.clone();
      back.rotation.y = Math.PI;
      back.position.z = -0.02;
      g.add(back);
      for (const x of [-1.2, 1.2]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), steel);
        p.position.set(x, 1.25, 0);
        g.add(p);
      }
      placeAt(g, st.s + off, -4.4, 0.55);
      g.rotateY(Math.PI / 2 - 0.25);
      v3.world.add(g);
    }
    const pal = textPlane('', 0.5, 0.5, '#fafafa', '#111111');
    const pg = new THREE.Group();
    pal.position.y = 1.9;
    pg.add(pal);
    const pp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), steel);
    pp.position.y = 0.85;
    pg.add(pp);
    placeAt(pg, st.s, -2.05, 0.55);
    v3.world.add(pg);

    // platform of the second track, on the right, for the trains running back: it extends beyond the stop marker
    const a2 = Math.max(0, st.s - 60),
      b2 = Math.min(v3.L.len, st.s + 180),
      T = TRACK2;
    const plat2 = new THREE.Mesh(
      sweep(
        a2,
        b2,
        5,
        [
          [T + 7.5, -0.95],
          [T + 7.5, 0.55],
          [T + 1.72, 0.55],
          [T + 1.72, -0.95],
        ],
        2,
      ),
      platMat,
    );
    plat2.receiveShadow = true;
    v3.world.add(plat2);
    v3.world.add(
      new THREE.Mesh(
        sweep(
          a2,
          b2,
          5,
          [
            [T + 2.3, 0.556],
            [T + 2.0, 0.556],
          ],
          1,
        ),
        edgeMat,
      ),
    );
    const ca2 = Math.max(a2, st.s + 30),
      cb2 = Math.min(b2, st.s + 150);
    const canopy2 = new THREE.Mesh(
      sweep(
        ca2,
        cb2,
        5,
        [
          [T + 2.2, 4.0],
          [T + 7.2, 4.4],
          [T + 7.2, 4.6],
          [T + 2.2, 4.2],
        ],
        2,
        true,
      ),
      roofMat,
    );
    canopy2.castShadow = true;
    v3.world.add(canopy2);
    for (let x = ca2 + 6; x < cb2; x += 12) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 8), steel);
      placeAt(post, x, T + 5.6, 2.35);
      post.castShadow = true;
      v3.world.add(post);
    }
    for (const off of [70, 155]) {
      if (st.s + off > v3.L.len) continue;
      const board = textPlane(st.name, 2.8, 0.62, '#1f4f9d', '#ffffff');
      const g = new THREE.Group();
      board.position.y = 2.75;
      g.add(board);
      const back = board.clone();
      back.rotation.y = Math.PI;
      back.position.z = -0.02;
      g.add(back);
      for (const x of [-1.2, 1.2]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6), steel);
        p.position.set(x, 1.25, 0);
        g.add(p);
      }
      placeAt(g, st.s + off, T + 4.4, 0.55);
      g.rotateY(-Math.PI / 2 + 0.25);
      v3.world.add(g);
    }
    const pg2 = pg.clone();
    placeAt(pg2, st.s, T + 2.05, 0.55);
    pg2.rotateY(Math.PI);
    v3.world.add(pg2);

    // footbridge over the two tracks, between the platforms, with a stair tower on each platform
    const fb = new THREE.Group(),
      fbMat = new THREE.MeshStandardMaterial({ color: '#7d8a91', roughness: 0.6, metalness: 0.3 });
    const left = -5.4,
      right = T + 5.4,
      width = right - left,
      mid = (left + right) / 2,
      deckY = 7.6;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width + 3, 0.45, 3.0), fbMat);
    deck.position.set(mid, deckY, 0);
    deck.castShadow = true;
    fb.add(deck);
    for (const z of [-1.45, 1.45]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(width + 3, 1.3, 0.12), glassLike());
      side.position.set(mid, deckY + 0.85, z);
      fb.add(side);
    }
    const roofFb = new THREE.Mesh(new THREE.BoxGeometry(width + 3.4, 0.18, 3.4), roofMat);
    roofFb.position.set(mid, deckY + 2.6, 0);
    fb.add(roofFb);
    for (const x of [left, right]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(3.0, deckY + 2.6, 3.4), fbMat);
      tower.position.set(x, (deckY + 2.6) / 2 + 0.55, 0);
      tower.castShadow = true;
      fb.add(tower);
      const door = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 2.3, 3.46),
        new THREE.MeshStandardMaterial({ color: '#2b3338' }),
      );
      door.position.set(x, 1.7, 0);
      fb.add(door);
    }
    // the group is placed with its x across the track and z along it
    const fbS = Math.min(v3.L.len, st.s + 40),
      { p: fp, f: ff, r: fr } = frame(fbS);
    fb.position.set(fp.x, fp.y, fp.z);
    fb.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr, UP, ff.clone().negate()));
    v3.world.add(fb);
  }

  // signals or ETCS marker boards
  const etcs = app.sim.scen.sig === 'ETCS';
  const boardTex = canvasTex(128, 128, c => {
    c.fillStyle = '#1c4fa3';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#fff';
    c.lineWidth = 6;
    c.strokeRect(4, 4, 120, 120);
    c.fillStyle = '#f6d21f';
    c.beginPath();
    c.moveTo(30, 64);
    c.lineTo(98, 26);
    c.lineTo(98, 102);
    c.closePath();
    c.fill();
  });
  const glowTex = canvasTex(64, 64, c => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
  v3.L.sig.forEach((sg, id) => {
    const g = new THREE.Group();
    if (etcs) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), steel);
      pole.position.y = 1.3;
      g.add(pole);
      const b = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 0.62),
        new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.5 }),
      );
      b.position.y = 2.55;
      g.add(b);
      placeAt(g, sg.s, -2.4, -0.3);
      v3.world.add(g);
    } else {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.8, 10), steel);
      mast.position.y = 2.4;
      g.add(mast);
      const headM = new THREE.Mesh(
        new THREE.CylinderGeometry(0.56, 0.56, 0.12, 24),
        new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.6 }),
      );
      headM.rotation.x = Math.PI / 2;
      headM.position.set(0, 4.6, 0.08);
      g.add(headM);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.56, 0.035, 8, 32),
        new THREE.MeshStandardMaterial({ color: '#eee' }),
      );
      rim.position.set(0, 4.6, 0.15);
      g.add(rim);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 16, 12),
        new THREE.MeshBasicMaterial({ color: '#5dff95' }),
      );
      lamp.position.set(0, 4.6, 0.2);
      g.add(lamp);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: '#5dff95',
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      glow.scale.set(1.6, 1.6, 1);
      glow.position.set(0, 4.6, 0.25);
      g.add(glow);
      const plate = textPlane(sg.id, 0.42, 0.3, '#f4f4f0', '#111111');
      plate.position.set(0, 3.5, 0.11);
      g.add(plate);
      placeAt(g, sg.s, -2.9, -0.3);
      v3.world.add(g);
      signals.push({ s: sg.s, lamp, glow, id });
    }
  });

  // trees and houses
  const treeG = {
    con: mergeGeometries([
      colored(new THREE.CylinderGeometry(0.16, 0.26, 3, 6).translate(0, 1.5, 0), '#5b4330'),
      colored(new THREE.ConeGeometry(2.3, 4.2, 9).translate(0, 3.9, 0), '#d6d6d6'),
      colored(new THREE.ConeGeometry(1.8, 3.6, 9).translate(0, 5.9, 0), '#ececec'),
      colored(new THREE.ConeGeometry(1.2, 3.0, 9).translate(0, 7.8, 0), '#ffffff'),
    ]),
    dec: mergeGeometries([
      colored(new THREE.CylinderGeometry(0.18, 0.3, 3.4, 6).translate(0, 1.7, 0), '#5b4330'),
      colored(blob(2.3).translate(0, 5.2, 0), '#e2e2e2'),
      colored(blob(1.7).translate(1.3, 4.4, 0.6), '#d0d0d0'),
      colored(blob(1.6).translate(-1.2, 4.6, -0.5), '#f2f2f2'),
      colored(blob(1.4).translate(0.2, 6.6, 0.3), '#ffffff'),
    ]),
  };
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const place: Record<string, THREE.Matrix4[]> = { con: [], dec: [] },
    tint: Record<string, THREE.Color[]> = { con: [], dec: [] };
  const nearSt = (s: number) => v3.L.st.some(st => Math.abs(s - st.s + 80) < 260);
  for (let s = 0, k = 0; s < v3.L.len; s += 7, k++)
    for (const side of [-1, 1]) {
      const r = hash(k * 2.17 + side * 91.3);
      if (r > 0.62 * q.trees) continue;
      if (inCutting(s)) continue;
      const d = side * (7.5 + Math.pow(hash(k * 5.1 + side), 1.6) * 170);
      if (nearSt(s) && d < 0 && d > -30) continue;
      const { p, r: rr, f } = frame(s);
      const wx = p.x + rr.x * d,
        wz = p.z + rr.z * d,
        h = terrainH(s, d, wx, wz);
      if (tunnelOf(v3.L, s) && Math.abs(d) < 12) continue;
      const type = hash(k * 9.9 + side) < (v3.L.iup > 15 ? 0.55 : 0.3) ? 'con' : 'dec';
      const sc = 0.7 + hash(k * 3.3 + side) * 0.8;
      const mtx = new THREE.Matrix4().compose(
        new THREE.Vector3(wx, p.y + h - 0.1, wz),
        new THREE.Quaternion().setFromAxisAngle(UP, hash(k) * 6.28),
        new THREE.Vector3(sc, sc * (0.85 + hash(k * 7.7) * 0.4), sc),
      );
      place[type].push(mtx);
      const t = hash(k * 2.9 + side);
      tint[type].push(
        type === 'con'
          ? new THREE.Color().setHSL(0.36, 0.42, 0.18 + t * 0.06)
          : new THREE.Color().setHSL(0.22 + t * 0.06, 0.45, 0.28 + t * 0.08),
      );
      void f;
    }
  for (const type of ['con', 'dec']) {
    const im = new THREE.InstancedMesh(treeG[type], treeMat, place[type].length);
    place[type].forEach((m, i) => {
      im.setMatrixAt(i, m);
      im.setColorAt(i, tint[type][i]);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    v3.world.add(im);
  }
  const houses: THREE.Matrix4[] = [],
    roofs: THREE.Matrix4[] = [];
  v3.L.st.forEach((st, si) => {
    for (let k = 0; k < 14; k++) {
      const s = st.s - 380 + hash(si * 31 + k) * 700,
        side = hash(si * 17 + k * 3) < 0.6 ? -1 : 1;
      if (s < 0 || s > v3.L.len || tunnelOf(v3.L, s)) continue;
      const d = side * (24 + hash(si * 7 + k * 5) * 60);
      const { p, r } = frame(s),
        wx = p.x + r.x * d,
        wz = p.z + r.z * d,
        h = terrainH(s, d, wx, wz);
      const w = 7 + hash(k * 4.4 + si) * 6,
        dd = 8 + hash(k * 6.1 + si) * 5,
        hh = 6 + hash(k * 8.8 + si) * 4;
      const q4 = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, UP, frame(s).f.negate()),
      );
      houses.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(wx, p.y + h + hh / 2 - 0.3, wz),
          q4,
          new THREE.Vector3(w, hh, dd),
        ),
      );
      roofs.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(wx, p.y + h + hh - 0.3, wz),
          q4,
          new THREE.Vector3(w * 1.08, 2.4, dd * 1.08),
        ),
      );
    }
  });
  const houseMat = new THREE.MeshStandardMaterial({ color: '#d8c6a6', roughness: 0.9, map: winTex });
  const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), houseMat, houses.length);
  houses.forEach((m, i) => {
    hm.setMatrixAt(i, m);
    hm.setColorAt(i, new THREE.Color().setHSL(0.09, 0.35, 0.7 + hash(i) * 0.12));
  });
  const roofGeo = new THREE.CylinderGeometry(0.0, 0.72, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const rm = new THREE.InstancedMesh(roofGeo, tileMat, roofs.length);
  roofs.forEach((m, i) => rm.setMatrixAt(i, m));
  hm.castShadow = rm.castShadow = true;
  hm.receiveShadow = true;
  v3.world.add(hm, rm);

  // train ahead
  buildLeader(steel);
  // people waiting on the platforms
  buildPeople();

  v3.scene.add(v3.world);
  v3.builtKey = worldKey();
}

/** Irregular crown: icosahedron with vertices displaced by noise */
export function blob(r: number) {
  const g = new THREE.IcosahedronGeometry(r, 1),
    p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      k = 0.82 + 0.36 * vnoise(x * 1.7 + 11, z * 1.7 + y);
    p.setXYZ(i, x * k, y * k * 0.9, z * k);
  }
  g.computeVertexNormals();
  return g;
}
export function colored(g: THREE.BufferGeometry, hex: string) {
  const c = new THREE.Color(hex),
    n = g.attributes.position.count,
    a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.index ? g.toNonIndexed() : g;
}
export function glassLike(): THREE.Material {
  return (v3.glassMat ??= new THREE.MeshStandardMaterial({
    color: '#a9c4cf',
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.45,
  }));
}
export function worldKey() {
  const sim = app.sim;
  if (sim !== v3.keySim) {
    v3.keySim = sim;
    v3.keyDef = JSON.stringify(sim.L.def) + '|' + (sim.leader ? sim.leader.TR.L : 0);
    v3.lineIdx = 0;
  }
  return v3.keyDef + '|' + sim.scen.sig + '|' + v3.quality + '|' + v3.lineIdx;
}
