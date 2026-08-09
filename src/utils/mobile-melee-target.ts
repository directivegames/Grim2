/**
 * Mobile auto-melee: enemy within blade reach and inside the 180° arc in front
 * of the right-stick aim direction (matches floor arc + swing aim).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { zombieSpatialManager } from '../actors/ZombieSpatialManager.js';
import { getMobileAimWorldDirection, isMobileAimActive } from './mobile-aim.js';

/** Slightly beyond blade reach so auto-melee does not drop off at the edge of a hit. */
export const MOBILE_MELEE_RANGE = 5.75;

const MOBILE_MELEE_RANGE_SQ = MOBILE_MELEE_RANGE * MOBILE_MELEE_RANGE;

const _playerPos = new THREE.Vector3();
const _zombiePos = new THREE.Vector3();
const _aimDir = new THREE.Vector3();

/** Wider than the 180° swing — forgiving when tracking a single nearby zombie. */
const AIM_CONE_MIN_DOT = -0.4;

function isLivingZombie(zombie: ENGINE.Actor): boolean {
  return !(zombie as unknown as { _deathSequenceStarted?: boolean })._deathSequenceStarted;
}

/**
 * True when aim is active, a living enemy is in melee range, and lies in the
 * 180° arc in front of the right-stick aim direction.
 */
export function hasMobileMeleeTargetInAim(world: ENGINE.World): boolean {
  if (!isMobileAimActive() || !getMobileAimWorldDirection(_aimDir)) {
    return false;
  }

  const pawn = world.getFirstPlayerPawn();
  if (!pawn) {
    return false;
  }

  pawn.getWorldPosition(_playerPos);

  const nearby = zombieSpatialManager.getNearbyZombies(_playerPos, MOBILE_MELEE_RANGE);
  for (const zombie of nearby) {
    if (!isLivingZombie(zombie)) {
      continue;
    }

    zombie.rootComponent.getWorldPosition(_zombiePos);
    const dx = _zombiePos.x - _playerPos.x;
    const dz = _zombiePos.z - _playerPos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq > MOBILE_MELEE_RANGE_SQ) {
      continue;
    }

    const dist = Math.sqrt(distSq);
    if (dist < 0.05) {
      return true;
    }

    const dot = (_aimDir.x * dx + _aimDir.z * dz) / dist;
    if (dot >= AIM_CONE_MIN_DOT) {
      return true;
    }
  }

  return false;
}

/**
 * Nearest living enemy within melee range, ignoring aim direction. Used as a
 * proximity fallback so mobile attacks always land when an enemy is in reach,
 * even if the right-stick aim never registers as "active".
 */
export function getNearestMobileMeleeTarget(world: ENGINE.World): ENGINE.Actor | null {
  const pawn = world.getFirstPlayerPawn();
  if (!pawn) {
    return null;
  }

  pawn.getWorldPosition(_playerPos);

  const nearby = zombieSpatialManager.getNearbyZombies(_playerPos, MOBILE_MELEE_RANGE);
  let best: ENGINE.Actor | null = null;
  let bestDistSq = MOBILE_MELEE_RANGE_SQ;

  for (const zombie of nearby) {
    if (!isLivingZombie(zombie)) {
      continue;
    }
    zombie.rootComponent.getWorldPosition(_zombiePos);
    const dx = _zombiePos.x - _playerPos.x;
    const dz = _zombiePos.z - _playerPos.z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      best = zombie;
    }
  }

  return best;
}
