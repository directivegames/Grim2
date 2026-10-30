/**
 * Worked example: a small sprout creature, 1.34 m tall, front toward −Z, feet at y = 0.
 * Exported to assets/models/sprout.glb. Pivots: rig → head, leg_l, leg_r.
 */
import * as THREE from 'three';

import { inkHull, INK, mesh, pivot } from './looks.js';
import { merge, part } from './parts.js';

const P = { leaf: 0x6fbf73, shade: 0x3f7f4f, cream: 0xe6efd2, ink: 0x272330, shine: 0xededed }; // GAME.md palette
const INK_W = 0.012; // ink ≈ 1 % of height; check it in pixels at gameplay distance

const BODY = merge([
  part(new THREE.CapsuleGeometry(0.24, 0.18, 6, 12), P.leaf, [0, 0.4, 0]),
  part(new THREE.SphereGeometry(0.17, 12, 8), P.cream, [0, 0.36, -0.1], [1, 1.1, 0.6]), // belly patch
]);
const HEAD = merge([
  part(new THREE.SphereGeometry(0.3, 16, 12), P.leaf, [0, 0.22, 0], [1.1, 0.95, 1]),
  part(new THREE.SphereGeometry(0.055, 10, 8), P.ink, [-0.11, 0.25, -0.27]), // eyes face −Z
  part(new THREE.SphereGeometry(0.055, 10, 8), P.ink, [0.11, 0.25, -0.27]),
  part(new THREE.SphereGeometry(0.018, 6, 4), P.shine, [-0.09, 0.28, -0.32]), // glints
  part(new THREE.SphereGeometry(0.018, 6, 4), P.shine, [0.13, 0.28, -0.32]),
  part(new THREE.ConeGeometry(0.06, 0.24, 8), P.shade, [0.04, 0.56, 0], [1, 1, 0.5], [0, 0, -0.35]),
]);
const LEG = part(new THREE.CapsuleGeometry(0.07, 0.12, 4, 8), P.shade, [0, -0.11, 0]); // hangs from the hip

/** Skin plus its ink hull, as two named meshes. */
const inked = (name: string, g: THREE.BufferGeometry): THREE.Mesh[] => [mesh(name, g), mesh(`${name}_ink`, inkHull(g, INK_W), INK)];

export function buildSprout(): THREE.Group {
  return pivot('rig', [
    ...inked('sprout_body', BODY),
    pivot('head', inked('sprout_head', HEAD), new THREE.Vector3(0, 0.66, 0)),
    pivot('leg_l', inked('sprout_leg_l', LEG), new THREE.Vector3(-0.12, 0.2, 0)),
    pivot('leg_r', inked('sprout_leg_r', LEG), new THREE.Vector3(0.12, 0.2, 0)),
  ]);
}
