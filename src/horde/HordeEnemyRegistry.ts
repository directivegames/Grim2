/**
 * Horde enemy type registry — add new elite enemies here.
 *
 * Normal zombies use the pooled NewZombieActor path in ZombieHordeManager.
 * Registry entries spawn instead of a normal zombie slot (weighted roll).
 */
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { BigUndeadActor, BIG_UNDEAD_MODEL_URL } from '../actors/BigUndeadActor.js';
import { DemonboxActor, DEMONBOX_MODEL_URL } from '../actors/DemonboxActor.js';
import type { RiskLevel } from '../data/risk-levels.js';

/** Weight used for a normal zombie when rolling spawn type per slot. */
export const HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT = 10;

export interface HordeEnemyType {
  /** Unique id for tracking active counts. */
  readonly id: string;
  /** Total kills before this type can appear in the spawn pool. */
  readonly killsToUnlock: number;
  /** Relative weight vs HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT (lower = rarer). */
  readonly spawnWeight: number;
  /** Max alive at once for this type. */
  readonly maxActive: number;
  /** Minimum mission risk level before this type can spawn. */
  readonly minRiskLevel: RiskLevel;
  /** Optional GLB to preload when the horde manager starts. */
  readonly modelUrl?: ENGINE.ModelPath;
  create(world: ENGINE.World, position: THREE.Vector3): ENGINE.Actor;
  hookDeath(actor: ENGINE.Actor, onDied: () => void): void;
  clearDeathHook(actor: ENGINE.Actor): void;
}

export function createDefaultHordeEnemyTypes(): HordeEnemyType[] {
  return [
    {
      id: 'big_undead',
      killsToUnlock: 30,
      spawnWeight: 2,
      maxActive: 2,
      minRiskLevel: 2,
      modelUrl: BIG_UNDEAD_MODEL_URL,
      create(world: ENGINE.World, position: THREE.Vector3): ENGINE.Actor {
        const actor = BigUndeadActor.create({ position: position.clone() });
        world.addActor(actor);
        return actor;
      },
      hookDeath(actor: ENGINE.Actor, onDied: () => void): void {
        if (actor instanceof BigUndeadActor) {
          actor.onDied = onDied;
        }
      },
      clearDeathHook(actor: ENGINE.Actor): void {
        if (actor instanceof BigUndeadActor) {
          actor.onDied = null;
        }
      },
    },
    {
      id: 'demonbox',
      killsToUnlock: 0,
      spawnWeight: 3,
      maxActive: 4,
      minRiskLevel: 1,
      modelUrl: DEMONBOX_MODEL_URL,
      create(world: ENGINE.World, position: THREE.Vector3): ENGINE.Actor {
        const actor = DemonboxActor.create({ position: position.clone() });
        world.addActor(actor);
        return actor;
      },
      hookDeath(actor: ENGINE.Actor, onDied: () => void): void {
        if (actor instanceof DemonboxActor) {
          actor.onDied = onDied;
        }
      },
      clearDeathHook(actor: ENGINE.Actor): void {
        if (actor instanceof DemonboxActor) {
          actor.onDied = null;
        }
      },
    },
  ];
}
