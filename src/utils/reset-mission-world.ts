import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { DeadGraveActor } from '../actors/DeadGraveActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { NewZombieActor } from '../actors/NewZombieActor.js';
import { PostmanBossActor } from '../actors/PostmanBossActor.js';
import { PostmanBulletActor } from '../actors/PostmanBulletActor.js';
import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';
import { zombieSpatialManager } from '../actors/ZombieSpatialManager.js';
import {
  clearPlayerSpawnAnchor,
  setPlayerSpawnAnchor,
} from '../mission/spawn-exclusion.js';
import { destroyTransientMissionActors } from './runtime-vfx-cleanup.js';

export interface ResetMissionWorldOptions {
  /** Restore scene-placed zombies to their editor positions (mission start only). */
  restorePlacedEnemies?: boolean;
}

/**
 * Restore the play space toward a clean mission start.
 */
export function resetMissionWorld(
  world: ENGINE.World,
  options: ResetMissionWorldOptions = {},
): void {
  const { restorePlacedEnemies = true } = options;

  PostmanBulletActor.destroyAllRuntime(world);
  DeadGraveActor.clearForMissionReset();
  destroyTransientMissionActors(world);
  zombieSpatialManager.clear();

  for (const actor of world.getActors()) {
    if (actor instanceof ZombieHordeManager) {
      actor.resetForMissionStart();
      actor.absorbParkedPooledZombies();
      break;
    }
  }

  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.prepareForMissionStart();
    pawn.rootComponent.getWorldPosition(_scratch);
    setPlayerSpawnAnchor(_scratch);
  } else {
    clearPlayerSpawnAnchor();
  }

  for (const actor of world.getActors()) {
    if (actor instanceof PostmanBossActor) {
      actor.resetToScenePlacement();
    } else if (restorePlacedEnemies && actor instanceof NewZombieActor) {
      actor.restorePlacedForMissionReset();
    }
  }
}

const _scratch = new THREE.Vector3();
