import * as ENGINE from '@gnsx/genesys.js';

import { GoreExplosionActor } from '../actors/GoreExplosionActor.js';
import { VomitballProjectileActor } from '../actors/VomitballProjectileActor.js';
import { ZombieRiseVFXActor } from '../actors/ZombieRiseVFXActor.js';
import { DemonboxMailExplosionVFXActor } from '../actors/DemonboxMailExplosionVFXActor.js';

const deathSmokeActors = new Set<ENGINE.SceneNode>();

export function trackDeathSmokeActor(actor: ENGINE.SceneNode): void {
  deathSmokeActors.add(actor);
}

export function destroyTransientMissionActors(world: ENGINE.World): void {
  GoreExplosionActor.destroyAllRuntime(world);
  ZombieRiseVFXActor.destroyAllRuntime(world);
  VomitballProjectileActor.destroyAllRuntime(world);
  DemonboxMailExplosionVFXActor.destroyAllRuntime(world);

  for (const actor of deathSmokeActors) {
    if (actor.getWorld()) {
      actor.destroy();
    }
  }
  deathSmokeActors.clear();
}
