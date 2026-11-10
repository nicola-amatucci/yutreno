/**
 * A description of the 3D scene in a fixed order, for the checks of the page (scripts/page-golden.mjs): every
 * object with its kind, name, visibility and transform, the size and a sum of the coordinates of its geometry, the
 * matrices of the instances, the colours of its materials and lights, and the fog and background of the scene. Two scenes with the same description look the same
 * apart from the content of the canvas textures. It only reads the scene; the page exposes it as YuTreno.scene3d().
 */
import type * as THREE from 'three';

const r = (x: number) => (Math.abs(x) < 5e-5 ? 0 : Math.round(x * 1e4) / 1e4);
const sum = (a: ArrayLike<number>) => {
  let s = 0,
    t = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    t += a[i] * ((i % 7) + 1);
  }
  return r(s) + '/' + r(t);
};

function material(m: THREE.Material | THREE.Material[] | undefined): string {
  if (!m) return '';
  if (Array.isArray(m)) return m.map(material).join(';');
  const x = m as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; map?: unknown; opacity: number };
  return [
    m.type,
    x.color?.getHexString() ?? '',
    x.emissive?.getHexString() ?? '',
    r(x.opacity),
    m.transparent ? 't' : '',
    m.visible ? '' : 'h',
    x.map ? 'map' : '',
  ].join(',');
}

function geometry(g: THREE.BufferGeometry | undefined): string {
  if (!g) return '';
  const p = g.getAttribute('position');
  return [p ? p.count : 0, p ? sum(p.array as ArrayLike<number>) : '', g.index ? g.index.count : ''].join(',');
}

export function describeScene(root: THREE.Object3D | null): string[] {
  const out: string[] = [];
  if (!root) return out;
  root.traverse(o => {
    const m = o as THREE.Mesh & { isInstancedMesh?: boolean; instanceMatrix?: THREE.BufferAttribute; count?: number };
    const t = [
      o.position.x,
      o.position.y,
      o.position.z,
      o.quaternion.x,
      o.quaternion.y,
      o.quaternion.z,
      o.quaternion.w,
      o.scale.x,
      o.scale.y,
      o.scale.z,
    ]
      .map(r)
      .join(',');
    const l = o as THREE.Object3D & {
      isLight?: boolean;
      color?: THREE.Color;
      groundColor?: THREE.Color;
      intensity?: number;
    };
    const sc = o as THREE.Object3D & {
      isScene?: boolean;
      background?: unknown;
      fog?: { color: THREE.Color; near?: number; far?: number; density?: number } | null;
    };
    out.push(
      [
        o.type,
        o.name,
        o.visible ? 'v' : 'h',
        t,
        geometry(m.geometry),
        material(m.material),
        m.isInstancedMesh && m.instanceMatrix ? m.count + ':' + sum(m.instanceMatrix.array as ArrayLike<number>) : '',
        l.isLight ? [l.color?.getHexString(), l.groundColor?.getHexString() ?? '', r(l.intensity ?? 0)].join(',') : '',
        sc.isScene
          ? [
              sc.fog
                ? [sc.fog.color.getHexString(), r(sc.fog.near ?? 0), r(sc.fog.far ?? 0), r(sc.fog.density ?? 0)].join(
                    ',',
                  )
                : '',
              (sc.background as { getHexString?: () => string } | null)?.getHexString?.() ?? '',
            ].join(',')
          : '',
      ].join('|'),
    );
  });
  return out;
}
