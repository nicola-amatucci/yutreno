// 3D view with Three.js: the world is built from the compiled line (terrain, ballast,
// sleepers, rails, catenary, tunnels, stations, signals, trees, houses) and the camera is
// in the cab of the train, with driver's desk, real DMI as a texture, lever and buttons.
// Graphics only: the simulation stays in the core and does not depend on this module.
// This file holds the renderer, the lights and atmosphere and the frame (render3d); since phase 8 the parts are in
// view3d-state.ts (shared state), path3d.ts (the line in space), world3d.ts (the world), trains3d.ts (trains,
// people, the train the camera rides in) and cab3d.ts (the cab).
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { tunnelOf } from '../core';
import { CTL, F, REDUCED, app, cfg, hash, ui } from './state';
import { buildCab, drawGauges } from './cab3d';
import { P, frame, placeAt, track2At } from './path3d';
import { chainageOn, lineOfTrain, placePeople, placeServices, viewTrain } from './trains3d';
import { QUALITY, Quality, cab, signals, v3 } from './view3d-state';
import { buildWorld, fbm, worldKey } from './world3d';

export { viewLine, viewTrain } from './trains3d';
export type { Quality } from './view3d-state';

// ---------- light and atmosphere ----------
function applyLighting() {
  const key = cfg.scen.tod + '|' + cfg.scen.met + '|' + v3.quality;
  if (key === v3.lightKey) return;
  v3.lightKey = key;
  const tod = cfg.scen.tod,
    met = cfg.scen.met;
  const elev = tod === 'day' ? 42 : tod === 'dusk' ? 3 : -12;
  const phi = THREE.MathUtils.degToRad(90 - elev),
    theta = THREE.MathUtils.degToRad(tod === 'dusk' ? 250 : 200);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  const u = (v3.sky.material as THREE.ShaderMaterial).uniforms;
  u.sunPosition.value.copy(sunDir);
  u.turbidity.value = met === 'clear' ? 3 : 12;
  u.rayleigh.value = tod === 'dusk' ? 2.6 : met === 'clear' ? 1.2 : 0.6;
  u.mieCoefficient.value = met === 'clear' ? 0.004 : 0.02;
  u.mieDirectionalG.value = 0.85;
  v3.sun.userData.dir = sunDir.clone();
  const fogCol =
    met === 'fog'
      ? tod === 'night'
        ? '#1a2128'
        : '#c3c9cc'
      : tod === 'night'
        ? '#0b1119'
        : tod === 'dusk'
          ? '#d99a74'
          : met === 'rain'
            ? '#9aa6ad'
            : '#c8d6de';
  const dens = met === 'fog' ? 0.0075 : met === 'rain' ? 0.0016 : tod === 'night' ? 0.0006 : 0.00042;
  v3.scene.fog = new THREE.FogExp2(fogCol, dens);
  (v3.skirt.material as THREE.MeshStandardMaterial).color.set(tod === 'night' ? '#1b2418' : '#6f8a4a');
  // distant hills: green veiled by haze, towards the fog colour
  (v3.horizon.material as THREE.MeshBasicMaterial).color.set(
    new THREE.Color(tod === 'night' ? '#0f151a' : tod === 'dusk' ? '#6d5a58' : '#6f8a86').lerp(
      new THREE.Color(fogCol),
      met === 'clear' ? 0.35 : 0.7,
    ),
  );
  v3.horizon.visible = met !== 'fog';
  v3.sun.intensity = tod === 'day' ? (met === 'clear' ? 3.0 : 1.2) : tod === 'dusk' ? 1.6 : 0.12;
  v3.sun.color.set(tod === 'dusk' ? '#ffb27a' : tod === 'night' ? '#9fb4ff' : '#fff6e8');
  v3.hemi.intensity = tod === 'day' ? (met === 'clear' ? 1.1 : 1.4) : tod === 'dusk' ? 0.7 : 0.08;
  v3.hemi.color.set(tod === 'dusk' ? '#f0b48c' : tod === 'night' ? '#34436a' : '#cfe3f2');
  v3.hemi.groundColor.set(tod === 'night' ? '#0c0f0a' : '#55603d');
  v3.stars.visible = tod === 'night' && met !== 'fog';
  v3.sky.visible = met !== 'fog';
  v3.scene.background = met === 'fog' ? new THREE.Color(fogCol) : null;
  v3.rain.visible = met === 'rain';
  v3.renderer!.toneMappingExposure = tod === 'night' ? 1.35 : tod === 'dusk' ? 1.05 : met === 'clear' ? 0.9 : 1.05;
  const q = QUALITY[v3.quality];
  v3.renderer!.shadowMap.enabled = q.shadows;
  v3.sun.castShadow = q.shadows;
  v3.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  if (v3.sun.shadow.map) {
    v3.sun.shadow.map.dispose();
    (v3.sun.shadow as any).map = null;
  }
  v3.camera.far = q.far;
  v3.camera.updateProjectionMatrix();
}

// ---------- module API ----------
/** Changes the quality: pixel density immediately, shadows and view distance at the next frame, world rebuilt */
/** The scene, for the checks of the page (scene-fingerprint.ts) */
export function scene3d(): THREE.Scene | null {
  return v3.scene ?? null;
}

export function setQuality(qq: Quality) {
  v3.quality = qq;
  v3.lightKey = '';
  if (v3.renderer) v3.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[qq].dpr));
}

/** Creates renderer, scene, sky, lights and cab inside the given element. Returns false if WebGL is not available */
export function init3d(el: HTMLElement, qq: Quality): boolean {
  if (v3.renderer) return true;
  v3.quality = qq;
  v3.container = el;
  try {
    v3.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    v3.renderer = null;
    return false;
  }
  v3.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[qq].dpr));
  v3.renderer.outputColorSpace = THREE.SRGBColorSpace;
  v3.renderer.toneMapping = THREE.AgXToneMapping;
  v3.renderer.shadowMap.type = THREE.PCFShadowMap;
  el.appendChild(v3.renderer.domElement);
  v3.scene = new THREE.Scene();
  v3.camera = new THREE.PerspectiveCamera(56, 2, 0.04, QUALITY[qq].far);
  v3.scene.add(v3.camera);
  v3.sky = new Sky();
  v3.sky.scale.setScalar(20000);
  v3.scene.add(v3.sky);
  v3.hemi = new THREE.HemisphereLight('#cfe3f2', '#55603d', 1);
  v3.scene.add(v3.hemi);
  v3.sun = new THREE.DirectionalLight('#fff6e8', 3);
  v3.sun.shadow.camera.left = -70;
  v3.sun.shadow.camera.right = 70;
  v3.sun.shadow.camera.top = 70;
  v3.sun.shadow.camera.bottom = -70;
  v3.sun.shadow.camera.near = 1;
  v3.sun.shadow.camera.far = 400;
  v3.sun.shadow.bias = -0.0004;
  v3.sun.shadow.normalBias = 0.03;
  v3.scene.add(v3.sun, v3.sun.target);
  v3.head = new THREE.SpotLight('#fff1d6', 0, 260, 0.42, 0.55, 1.2);
  v3.camera.add(v3.head);
  v3.head.position.set(0, -1.2, -1.5);
  v3.head.target.position.set(0, -2.6, -60);
  v3.camera.add(v3.head.target);
  // stars, rain, distant terrain
  const sp: number[] = [];
  for (let i = 0; i < 1400; i++) {
    const th = hash(i * 1.3) * Math.PI * 2,
      ph = Math.acos(hash(i * 2.7) * 0.95);
    sp.push(Math.sin(ph) * Math.cos(th) * 9000, Math.cos(ph) * 9000, Math.sin(ph) * Math.sin(th) * 9000);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  v3.stars = new THREE.Points(
    sg,
    new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false }),
  );
  v3.scene.add(v3.stars);
  const rp: number[] = [];
  for (let i = 0; i < 1600; i++) {
    const x = (hash(i * 1.1) - 0.5) * 60,
      y = hash(i * 2.3) * 22,
      z = -4 - hash(i * 3.7) * 56;
    rp.push(x, y, z, x - 0.05, y - 0.9, z);
  }
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  v3.rain = new THREE.LineSegments(
    rgeo,
    new THREE.LineBasicMaterial({ color: '#c9d4dc', transparent: true, opacity: 0.35 }),
  );
  v3.rain.frustumCulled = false;
  v3.scene.add(v3.rain);
  v3.skirt = new THREE.Mesh(
    new THREE.CircleGeometry(12000, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#5f7a44', roughness: 1 }),
  );
  v3.scene.add(v3.skirt);
  const hz: number[] = [],
    hidx: number[] = [];
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2,
      h = 60 + fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + 10) * 420;
    hz.push(Math.cos(a) * 5200, -20, Math.sin(a) * 5200, Math.cos(a) * 5200, h, Math.sin(a) * 5200);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    hidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hz, 3));
  hg.setIndex(hidx);
  hg.computeVertexNormals();
  v3.horizon = new THREE.Mesh(
    hg,
    new THREE.MeshBasicMaterial({ color: '#7d9384', side: THREE.DoubleSide, fog: false }),
  );
  v3.scene.add(v3.horizon);
  buildCab();
  return true;
}

/** Draws a frame: rebuilds the world if the line changed, follows the head of the train,
 * updates signals, train ahead, lights and cab instruments
 */
export function render3d(now: number) {
  if (!v3.renderer) return;
  const sim = app.sim,
    S = sim.S;
  // the world of the line the view is on: the main line, or the line of the train it rides in
  worldKey(); // a new run goes back to the main line
  {
    const seat0 = viewTrain();
    v3.lineIdx = seat0 === sim.train ? 0 : (lineOfTrain(seat0) ?? 0);
  }
  if (v3.builtKey !== worldKey()) {
    buildWorld();
    v3.lightKey = '';
  }
  applyLighting();
  // dimensions
  const w = v3.container.clientWidth,
    h = v3.container.clientHeight;
  const cv = v3.renderer.domElement;
  if (
    cv.width !== Math.round(w * v3.renderer.getPixelRatio()) ||
    cv.height !== Math.round(h * v3.renderer.getPixelRatio())
  ) {
    v3.renderer.setSize(w, h, false);
    v3.camera.aspect = w / Math.max(1, h);
    v3.camera.updateProjectionMatrix();
  }
  // camera in the cab, on the head of the train: the driven one, or another train the page rides in, on its line
  const seat = viewTrain(),
    V = seat.S,
    on = seat === sim.train ? null : chainageOn(seat, v3.lineIdx, V.s);
  const back = on ? on.dir < 0 : seat.dir < 0;
  const s = on ? on.s : S.s;
  const sg = back ? -1 : 1,
    lat = back ? track2At(s) : 0;
  const eye = P(s - 1.6 * sg);
  const ahead = P(Math.min(v3.L.len, Math.max(0, s + 40 * sg))),
    look = new THREE.Vector3();
  const f0 = frame(s),
    f1 = frame(Math.min(v3.L.len, Math.max(0, s + 25 * sg)));
  const dir = f0.f.clone().multiplyScalar(0.55).add(f1.f.clone().multiplyScalar(0.45)).normalize().multiplyScalar(sg);
  eye.addScaledVector(f0.r, lat);
  const sway = REDUCED
    ? 0
    : Math.sin(V.t * 1.7) * 0.025 * Math.min(1, V.v / 20) + Math.sin(V.t * 5.3) * 0.008 * Math.min(1, V.v / 30);
  const bob = REDUCED ? 0 : Math.sin((s / 36) * Math.PI * 2) * 0.012 * Math.min(1, V.v / 15);
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  cab.group.visible = seat === sim.train;
  v3.camera.position.set(eye.x + right.x * sway, eye.y + 3.15 + bob, eye.z + right.z * sway);
  const pitch = (ahead.y - eye.y) / 40;
  look.set(
    v3.camera.position.x + dir.x * 50,
    v3.camera.position.y + pitch * 50 - 2.2,
    v3.camera.position.z + dir.z * 50,
  );
  v3.camera.lookAt(look);
  // shadows and sky follow the camera
  const sd = (v3.sun.userData.dir as THREE.Vector3) || new THREE.Vector3(0, 1, 0);
  const center = v3.camera.position.clone().add(dir.clone().multiplyScalar(40));
  v3.sun.target.position.copy(center);
  v3.sun.position.copy(center).add(sd.clone().multiplyScalar(200));
  v3.sky.position.copy(v3.camera.position);
  v3.stars.position.copy(v3.camera.position);
  v3.skirt.position.set(v3.camera.position.x, eye.y - 40, v3.camera.position.z);
  v3.horizon.position.set(v3.camera.position.x, eye.y - 45, v3.camera.position.z);
  v3.rain.position.copy(v3.camera.position);
  v3.rain.quaternion.copy(v3.camera.quaternion);
  if (v3.rain.visible) {
    const off = (now * 0.03 + S.v * 0.0) % 22;
    v3.rain.position.y -= off;
    v3.rain.position.addScaledVector(dir, -(now * 0.004 * S.v) % 8);
  }
  // nearby sleepers
  if (Math.abs(s - v3.lastSleeperS) > 0.3) {
    v3.lastSleeperS = s;
    const tmp = new THREE.Object3D(),
      n = v3.sleepers.count,
      s0 = Math.floor((s - 40) / 0.6) * 0.6;
    for (let i = 0; i < n; i++) {
      const ss = s0 + i * 0.6;
      if (ss < 0 || ss > v3.L.len) {
        tmp.position.set(0, -1e4, 0);
        tmp.updateMatrix();
        v3.sleepers.setMatrixAt(i, tmp.matrix);
        continue;
      }
      placeAt(tmp, ss, 0, -0.255);
      tmp.updateMatrix();
      v3.sleepers.setMatrixAt(i, tmp.matrix);
    }
    v3.sleepers.instanceMatrix.needsUpdate = true;
  }
  // signals
  const LAMP: Record<string, string> = { G: '#5dff95', Y: '#ffd34d', R: '#ff4b3e' };
  for (const sg of signals) {
    const asp = v3.L.sig[sg.id].asp,
      col = LAMP[asp] ?? '#3a3a3a';
    (sg.lamp.material as THREE.MeshBasicMaterial).color.set(col);
    (sg.glow.material as THREE.SpriteMaterial).color.set(col);
    const dd = sg.s - s;
    sg.glow.scale.setScalar(Math.max(1.6, Math.min(7, dd / 45)));
    sg.glow.visible = dd > -5;
  }
  // train ahead
  if (v3.leader) {
    v3.leader.visible = !F.gone && v3.lineIdx === 0;
    if (!F.gone)
      v3.leaderCars.forEach((car, i) => {
        const sc = F.s - 7.5 - i * 15;
        if (sc < 0 || sc > v3.L.len) {
          car.visible = false;
          return;
        }
        car.visible = true;
        placeAt(car, sc, 0, 0);
      });
  }
  placeServices();
  placePeople();
  // lights: headlights at night, in tunnels and at dusk
  const inTun = !!tunnelOf(v3.L, s);
  v3.rain.visible = cfg.scen.met === 'rain' && !inTun;
  v3.head.intensity =
    cfg.scen.tod === 'night' || inTun ? 260 : cfg.scen.tod === 'dusk' || cfg.scen.met !== 'clear' ? 90 : 0;
  v3.hemi.visible = true;
  v3.cabLight.intensity = cfg.scen.tod === 'night' || inTun ? 1.6 : 0;
  // cab
  const lv = S.lever;
  cab.lev.rotation.x = THREE.MathUtils.degToRad(lv >= 0 ? (-lv / 10) * 38 : (-lv / 8) * 38);
  (cab.vig.material as THREE.MeshStandardMaterial).emissive.set(
    S.vigAlarm ? (Math.floor(now / 250) % 2 ? '#3d9bff' : '#0b3d6e') : '#000000',
  );
  cab.vig.position.y = 0.01 - (S.vigAlarm ? 0 : 0);
  cab.dmiTex.needsUpdate = true;
  if (!cab.lastGauge || now - cab.lastGauge > 90) {
    cab.lastGauge = now;
    drawGauges();
  }
  const lampOn = [S.vigAlarm, S.doors, S.slip || S.wsp, S.eb];
  const lampCol = ['#ff9a2e', '#7fd0e6', '#ff9a2e', '#ff4b3e'];
  cab.lampMeshes.forEach((m: THREE.Mesh, i: number) =>
    (m.material as THREE.MeshBasicMaterial).color.set(lampOn[i] ? lampCol[i] : '#2a2f33'),
  );
  cab.wiper.rotation.z = cfg.scen.met === 'rain' && !REDUCED ? Math.sin(now / 700) * 0.95 - 0.1 : -1.53;
  void CTL;
  void ui;
  v3.renderer.render(v3.scene, v3.camera);
}
