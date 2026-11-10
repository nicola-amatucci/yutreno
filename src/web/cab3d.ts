/**
 * The cab of the 3D view (phase 8, R3): desk, windows, pillars, wiper, vigilance button and the gauges drawn on a
 * canvas.
 */
import * as THREE from 'three';
import { $, app } from './state';
import { cab, v3 } from './view3d-state';

// ---------- cab ----------
export function buildCab() {
  const g = new THREE.Group();
  const plastic = new THREE.MeshStandardMaterial({ color: '#2b3338', roughness: 0.75 });
  const panelMat = new THREE.MeshStandardMaterial({ color: '#384249', roughness: 0.65 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1b2024', roughness: 0.8 });
  // desk: side profile extruded along x
  const sh = new THREE.Shape();
  sh.moveTo(-1.45, -0.42);
  sh.lineTo(-1.1, -0.42);
  sh.lineTo(-0.66, -0.62);
  sh.lineTo(-0.66, -1.4);
  sh.lineTo(-1.45, -1.4);
  sh.lineTo(-1.45, -0.42);
  const desk = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 3.4, bevelEnabled: false }), plastic);
  desk.rotation.y = -Math.PI / 2;
  desk.position.x = 1.7;
  // ExtrudeGeometry extrudes along z: rotated by −90° the x of the shape becomes the depth (−z) and the extrusion goes along x
  g.add(desk);
  const slope = Math.atan2(0.44, 0.2);
  /** Places on the inclined panel: t = 0 far edge, 1 near edge; flat = object facing +z, otherwise +y */
  const onPanel = (o: THREE.Object3D, x: number, t: number, lift = 0.004, flatFace = true) => {
    const z = -1.1 + 0.44 * t,
      y = -0.42 - 0.2 * t;
    o.position.set(x, y + lift * Math.sin(slope), z + lift * Math.cos(slope));
    o.rotation.x = flatFace ? -slope : Math.PI / 2 - slope;
    return o;
  };
  // windscreen frame and roof
  const post = (x: number) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.4, 0.12), frameMat);
    p.position.set(x, 0.18, -1.4);
    p.rotation.z = x > 0 ? -0.1 : 0.1;
    g.add(p);
  };
  post(-1.45);
  post(1.45);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 1.4), frameMat);
  roof.position.set(0, 0.78, -0.75);
  g.add(roof);
  const header = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.12), frameMat);
  header.position.set(0, 0.69, -1.4);
  g.add(header);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.05, 0.08), frameMat);
  sill.position.set(0, -0.41, -1.42);
  g.add(sill);
  // DMI: texture from the DMI canvas of the page
  const dmiTex = new THREE.CanvasTexture($('cvDmi'));
  dmiTex.colorSpace = THREE.SRGBColorSpace;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.29, 0.03), frameMat);
  onPanel(bezel, -0.3, 0.3, 0.012);
  g.add(bezel);
  const dmi = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.25),
    new THREE.MeshBasicMaterial({ map: dmiTex, toneMapped: false }),
  );
  onPanel(dmi, -0.3, 0.3, 0.03);
  g.add(dmi);
  // gauges: brake pipe and brake cylinders
  const gcv = document.createElement('canvas');
  gcv.width = 512;
  gcv.height = 256;
  const gTex = new THREE.CanvasTexture(gcv);
  gTex.colorSpace = THREE.SRGBColorSpace;
  const gauges = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.15),
    new THREE.MeshBasicMaterial({ map: gTex, toneMapped: false }),
  );
  onPanel(gauges, 0.15, 0.25, 0.008);
  g.add(gauges);
  // lever
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.26), panelMat);
  onPanel(base, 0.5, 0.35, 0.02, false);
  g.add(base);
  const pivot = new THREE.Group();
  onPanel(pivot, 0.5, 0.35, 0.04, false);
  g.add(pivot);
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.17, 10),
    new THREE.MeshStandardMaterial({ color: '#9aa3a8', metalness: 0.8, roughness: 0.3 }),
  );
  arm.position.y = 0.085;
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.4 }),
  );
  knob.position.y = 0.17;
  const lev = new THREE.Group();
  lev.add(arm, knob);
  pivot.add(lev);
  // buttons
  const vig = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 0.02, 20),
    new THREE.MeshStandardMaterial({ color: '#2a6fb0', emissive: '#000000', roughness: 0.4 }),
  );
  const vigG = new THREE.Group();
  vig.position.y = 0.01;
  vigG.add(vig);
  onPanel(vigG, -0.72, 0.3, 0.01, false);
  g.add(vigG);
  const urg = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#c0261d', roughness: 0.45 }),
  );
  const urgG = new THREE.Group();
  urgG.add(urg);
  onPanel(urgG, 0.82, 0.3, 0.01, false);
  g.add(urgG);
  // indicator lamps
  const lampG = new THREE.Group();
  const lampDefs = ['VIG', 'PORTE', 'SLITT', 'EMG'];
  const lampMeshes = lampDefs.map((_, i) => {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 16),
      new THREE.MeshBasicMaterial({ color: '#333', toneMapped: false }),
    );
    m.position.set(-0.06 + i * 0.04, 0, 0);
    lampG.add(m);
    return m;
  });
  onPanel(lampG, 0.15, 0.08, 0.006);
  g.add(lampG);
  // wiper
  const wiper = new THREE.Group();
  wiper.position.set(-0.2, -0.42, -1.43);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.85, 0.01), frameMat);
  blade.position.y = 0.425;
  wiper.add(blade);
  g.add(wiper);
  // cab light
  v3.cabLight = new THREE.PointLight('#ffd9a8', 0, 3, 2);
  v3.cabLight.position.set(0, 0.6, -0.5);
  g.add(v3.cabLight);
  Object.assign(cab, { group: g, lev, vig, urg, dmiTex, gcv, gTex, wiper, lampMeshes });
  v3.camera.add(g);
}

export function drawGauges() {
  const c = cab.gcv.getContext('2d') as CanvasRenderingContext2D,
    S = app.sim.S,
    sim = app.sim;
  c.fillStyle = '#1d2327';
  c.fillRect(0, 0, 512, 256);
  const brakeMax = sim.ME * sim.TR.bEm;
  // brake pipe: 5 bar with brake released, discharged in service braking, at zero in emergency (indicative)
  const target = S.eb ? 0 : 5 - 1.5 * Math.min(1, S.uB);
  cab.cg = cab.cg == null ? target : cab.cg + (target - cab.cg) * 0.35;
  const cg = cab.cg;
  const cf = 3.8 * Math.min(1, S.Fb / Math.max(1, brakeMax));
  const gauge = (cx: number, val: number, max: number, label: string) => {
    c.fillStyle = '#f2f0ea';
    c.beginPath();
    c.arc(cx, 128, 104, 0, 7);
    c.fill();
    c.strokeStyle = '#222';
    c.lineWidth = 3;
    for (let v = 0; v <= max; v++) {
      const a = (0.75 + (v / max) * 1.5) * Math.PI;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * 84, 128 + Math.sin(a) * 84);
      c.lineTo(cx + Math.cos(a) * 98, 128 + Math.sin(a) * 98);
      c.stroke();
    }
    c.fillStyle = '#222';
    c.font = "600 22px 'IBM Plex Mono',monospace";
    c.textAlign = 'center';
    c.fillText(label, cx, 178);
    c.font = "16px 'IBM Plex Mono',monospace";
    c.fillText('bar', cx, 98);
    const a = (0.75 + (Math.min(max, Math.max(0, val)) / max) * 1.5) * Math.PI;
    c.strokeStyle = '#c0261d';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(cx, 128);
    c.lineTo(cx + Math.cos(a) * 88, 128 + Math.sin(a) * 88);
    c.stroke();
    c.fillStyle = '#222';
    c.beginPath();
    c.arc(cx, 128, 9, 0, 7);
    c.fill();
  };
  gauge(128, cg, 10, 'BP');
  gauge(384, cf, 6, 'BC');
  cab.gTex.needsUpdate = true;
}
