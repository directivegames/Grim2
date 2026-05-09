/**
 * BlobShadowComponent — soft semi-transparent circular shadow under characters.
 *
 * A simple flat disc that stays on the ground, much cheaper than real-time
 * shadow maps and gives a nice stylized look.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { SceneComponentOptions } from '@gnsx/genesys.js';

export type BlobShadowOptions = SceneComponentOptions & {
  /** Radius of the shadow disc (default 0.5). */
  radius?: number;
  /** Opacity 0-1 (default 0.35). */
  opacity?: number;
  /** Circle segments (default 32). */
  segments?: number;
  /** Y offset from parent (default 0.02 to avoid z-fighting). */
  yOffset?: number;
};

@ENGINE.GameClass()
export class BlobShadowComponent extends ENGINE.MeshComponent {
  public override initialize(options?: BlobShadowOptions): void {
    const radius   = options?.radius   ?? 0.5;
    const opacity  = options?.opacity  ?? 0.35;
    const segments = options?.segments ?? 32;
    const yOffset  = options?.yOffset  ?? 0.02;

    const geometry = new THREE.CircleGeometry(radius, segments);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
    });

    super.initialize({
      ...options,
      geometry,
      material,
      rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
      position: new THREE.Vector3(0, yOffset, 0),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });
  }
}
