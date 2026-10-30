/**
 * Every model the export writes: one assets/models/<file>.glb per entry (genesys-code-modeling →
 * scripts/export-glb.ts). List only models the game spawns or the scene places. Remove an entry to
 * stop overwriting a GLB someone edited by hand.
 */
import type * as THREE from 'three';

import { buildSprout } from './sprout.js';

export const MODELS: Array<{ file: string; build: () => THREE.Object3D }> = [
  { file: 'sprout', build: buildSprout },
];

/** Toon ramp values, dark → lit (red channel; 255 = full light). */
export const TOON_BANDS = [90, 170, 255];
