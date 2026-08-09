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
import { logMissionReset } from './mission-reset-log.js';

export interface ResetMissionWorldOptions {
  /** Restore scene-placed zombies to their editor positions (mission start only). */
  restorePlacedEnemies?: boolean;
  /**
   * Teleport Grim, restore health, and sync physics. False after mission fail so Grim
   * stays visible at the death spot until the player picks the next run from the map.
   */
  resetPlayer?: boolean;
}

/**
 * Restore the play space toward a clean mission start.
 */
export function resetMissionWorld(
  world: ENGINE.World,
  options: ResetMissionWorldOptions = {},
  phase = 'reset',
): void {
  const { restorePlacedEnemies = true, resetPlayer = true } = options;

  logMissionReset(phase, { restorePlacedEnemies, resetPlayer });

  PostmanBulletActor.destroyAllRuntime(world);
  DeadGraveActor.clearForMissionReset();
  destroyTransientMissionActors(world);
  zombieSpatialManager.clear();

  for (const actor of world.getRootNodes()) {
    if (actor instanceof ZombieHordeManager) {
      actor.resetForMissionStart();
      actor.absorbParkedPooledZombies();
      break;
    }
  }

  const pawn = world.getFirstPlayerPawn();
  const playerStart = world.getNodes(ENGINE.PlayerStart)[0];
  if (playerStart) {
    playerStart.getWorldPosition(_scratch);
    setPlayerSpawnAnchor(_scratch);
  } else if (pawn) {
    pawn.getWorldPosition(_scratch);
    setPlayerSpawnAnchor(_scratch);
  } else {
    clearPlayerSpawnAnchor();
  }

  if (resetPlayer && pawn instanceof IsometricPlayerPawn) {
    pawn.prepareForMissionStart(phase);
  } else if (!pawn || !(pawn instanceof IsometricPlayerPawn)) {
    logMissionReset(`${phase}:no-isometric-pawn`, {});
  }

  let placedRestored = 0;
  let placedSkipped = 0;
  for (const actor of world.getRootNodes()) {
    if (actor instanceof PostmanBossActor) {
      actor.resetToScenePlacement();
    } else if (restorePlacedEnemies && actor instanceof NewZombieActor) {
      if (actor.isPooled) {
        placedSkipped += 1;
      } else {
        actor.restorePlacedForMissionReset();
        placedRestored += 1;
      }
    }
  }

  logMissionReset(`${phase}:done`, {
    restorePlacedEnemies,
    placedRestored,
    placedSkipped,
    grimPos: pawn instanceof IsometricPlayerPawn
      ? {
        x: pawn.position.x,
        y: pawn.position.y,
        z: pawn.position.z,
      }
      : null,
  });
}

const _scratch = new THREE.Vector3();
