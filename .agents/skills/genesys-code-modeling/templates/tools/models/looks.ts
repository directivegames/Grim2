import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Look roles for the GLB export (genesys-code-modeling → scripts/export-glb.ts). The material name
 * picks the engine material the GLB links to: 'toon' → M_Toon, 'flat' → M_Flat, 'soft' → M_Soft,
 * 'glow' → M_Glow. Colours come from the parts' vertex colours (part()), or from `color` when a
 * material has no vertex colours. INK (BackSide) marks an ink hull: the exporter gives it the model's
 * main look and flips its winding, so that material draws it as the outline in the hull's colour.
 * These materials never render: the game shows the exported GLBs.
 */
export const TOON = new THREE.MeshBasicMaterial({ name: 'toon', vertexColors: true });
export const FLAT = new THREE.MeshBasicMaterial({ name: 'flat', vertexColors: true });
export const SOFT = new THREE.MeshBasicMaterial({ name: 'soft', vertexColors: true });
export const GLOW = new THREE.MeshBasicMaterial({ name: 'glow', vertexColors: true });
export const INK = new THREE.MeshBasicMaterial({ name: 'ink', color: 0x1b1622, side: THREE.BackSide });

/** Inverted hull: the shape pushed out along welded (smoothed) normals. */
export function inkHull(src: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  const hull = mergeVertices(g, 1e-4); // shared corners get one normal, so the hull has no cracks
  hull.computeVertexNormals();
  const p = hull.getAttribute('position');
  const n = hull.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width);
  }
  return hull;
}

/** A named empty at a joint: the runtime finds pivots by these names, so keep them unique per model. */
export function pivot(name: string, children: THREE.Object3D[] = [], at?: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (at) g.position.copy(at);
  if (children.length) g.add(...children);
  return g;
}

/** A named mesh with its look. */
export function mesh(name: string, geo: THREE.BufferGeometry, look: THREE.Material = TOON): THREE.Mesh {
  const m = new THREE.Mesh(geo, look);
  m.name = name;
  return m;
}
