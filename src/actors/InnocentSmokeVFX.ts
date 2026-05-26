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
  actor.rootComponent.position.copy(position);
  actor.rootComponent.position.y += 0.1;
  actor.rootComponent.scale.setScalar(scale);

  const smoke = ENGINE.VFXComponent.create({
    vfxPath: SMOKE_VFX,
    autoStart: true,
  });
  actor.rootComponent.add(smoke);
  world.addActor(actor);

  window.setTimeout(() => {
    if (actor.getWorld()) {
      actor.destroy();
    }
  }, LIFETIME_MS);
}
