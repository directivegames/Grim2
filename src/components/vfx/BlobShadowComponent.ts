/**
 * BlobShadowComponent — soft semi-transparent circular shadow under characters.
 *
 * A simple flat disc that stays on the ground, much cheaper than real-time
 * shadow maps and gives a nice stylized look.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { SceneNodeOptions } from '@gnsx/genesys.js';

export type BlobShadowOptions = SceneNodeOptions & {
  /** Radius of the shadow disc (default 0.5). */
  radius?: number;
  /** Opacity 0-1 (default 0.35). */
  opacity?: number;
  /** Circle segments (default 32). */
  segments?: number;
  /** Y offset from parent (default 0.02 to avoid z-fighting). */
  yOffset?: number;
};

let _sharedSoftShadowMap: THREE.CanvasTexture | null = null;

function getSoftShadowMap(): THREE.CanvasTexture {
  if (_sharedSoftShadowMap) {
    return _sharedSoftShadowMap;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  _sharedSoftShadowMap = tex;
  return tex;
}

@ENGINE.GameClass()
export class BlobShadowComponent extends ENGINE.MeshNode {
  public override initialize(options?: BlobShadowOptions): void {
    const radius   = options?.radius   ?? 0.5;
    const opacity  = options?.opacity  ?? 0.35;
    const segments = options?.segments ?? 16;
    const yOffset  = options?.yOffset  ?? 0.02;

    const geometry = new THREE.CircleGeometry(radius, segments);
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: getSoftShadowMap(),
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
