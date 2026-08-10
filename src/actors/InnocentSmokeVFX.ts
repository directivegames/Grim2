/**
 * Scaled smoke burst for innocent appear / vanish (reuses undead smoke.vfx.json).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const SMOKE_VFX = '@project/assets/VFX/smoke.vfx.json';
const LIFETIME_MS = 2800;

/** Scale on root — larger than zombie spawn to cover civilian mesh. */
const DEFAULT_SCALE = 2.75;

export function spawnInnocentSmokeAt(
  world: ENGINE.World,
  position: THREE.Vector3,
  scale = DEFAULT_SCALE,
): void {
  const actor = ENGINE.Actor.create();
  actor.position.copy(position);
  actor.position.y += 0.1;
  actor.scale.setScalar(scale);

  const smoke = ENGINE.VFXNode.create({
    vfxPath: SMOKE_VFX,
    autoStart: true,
  });
  actor.add(smoke);
  world.add(actor);

  window.setTimeout(() => {
    if (actor.getWorld()) {
      actor.destroy();
    }
  }, LIFETIME_MS);
}
