import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
type V3 = [number, number, number];

/** One shaped part: a copy of a template geometry, placed, and painted with a palette colour. */
export function part(geo: THREE.BufferGeometry, hex: number, at: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(); // one layout for every part, so they merge
  g.deleteAttribute('uv');
  _c.setHex(hex); // sRGB hex in, linear vertex colour out
  const n = g.getAttribute('position').count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) { rgb[i] = _c.r; rgb[i + 1] = _c.g; rgb[i + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  g.applyMatrix4(_m.compose(new THREE.Vector3(...at), _q, new THREE.Vector3(...scale)));
  return g;
}

/** Many parts → one geometry → one draw call per material. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('merge: parts have different attributes');
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Triangle count, for the role budget. */
export function tris(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
