/**
 * The shared state of the 3D view (phase 8, R3): the qualities, the objects of the scene and of the world that its
 * parts build and change (`v3`), the signals and the cab. view3d.ts, world3d.ts, trains3d.ts and cab3d.ts use it.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { CompiledLine } from '../core';

export type Quality = 'high' | 'medium' | 'low';
export const QUALITY = {
  high: { dpr: 2, shadows: true, shadowSize: 2048, trees: 1, far: 4200, sleepers: 2400 },
  medium: { dpr: 1.25, shadows: true, shadowSize: 1024, trees: 0.65, far: 3200, sleepers: 1800 },
  low: { dpr: 1, shadows: false, shadowSize: 512, trees: 0.35, far: 2200, sleepers: 1100 },
};

/** The state of the 3D view that its parts share and change (phase 8, R3) */
export const v3 = {
  renderer: null as THREE.WebGLRenderer | null,
  scene: undefined as unknown as THREE.Scene,
  camera: undefined as unknown as THREE.PerspectiveCamera,
  container: undefined as unknown as HTMLElement,
  world: null as THREE.Group | null,
  builtKey: '',
  sky: undefined as unknown as Sky,
  sun: undefined as unknown as THREE.DirectionalLight,
  hemi: undefined as unknown as THREE.HemisphereLight,
  head: undefined as unknown as THREE.SpotLight,
  cabLight: undefined as unknown as THREE.PointLight,
  stars: undefined as unknown as THREE.Points,
  rain: undefined as unknown as THREE.LineSegments,
  skirt: undefined as unknown as THREE.Mesh,
  horizon: undefined as unknown as THREE.Mesh,
  sleepers: undefined as unknown as THREE.InstancedMesh,
  lastSleeperS: -1e9,
  A0: 0,
  L: undefined as unknown as CompiledLine,
  /** Line of the network the world draws: the main line, or the line of the train the view rides in */
  lineIdx: 0,
  lightKey: '',
  leader: null as THREE.Group | null,
  leaderCars: [] as THREE.Object3D[],
  /** Service trains of the current run, built when the run changes */
  services: [] as { id: string; g: THREE.Group; cars: THREE.Object3D[]; cl: number }[],
  servicesFor: null as unknown,
  /** People on the platforms: two instanced meshes (bodies, heads), PEOPLE slots per platform, two platforms per station */
  people: null as {
    body: THREE.InstancedMesh;
    head: THREE.InstancedMesh;
    spots: THREE.Matrix4[][];
    shown: number[];
  } | null,
  quality: 'medium' as Quality,
  /** Translucent material of the footbridge sides */
  glassMat: null as THREE.Material | null,
  /** The world is rebuilt only if line, signalling, train ahead or quality change */
  keySim: null as unknown,
  keyDef: '',
};

export const signals: { s: number; lamp: THREE.Mesh; glow: THREE.Sprite; id: number }[] = [];
export const cab: Record<string, any> = {};
export const UP = new THREE.Vector3(0, 1, 0);
