import * as THREE from 'three';

import type { EnemySpawnPointActor } from '../actors/EnemySpawnPointActor.js';

/** Horde spawns at markers at least this far from Grim (XZ). */
const MIN_DISTANCE_FROM_PLAYER = 4;

/** Random choice among the N closest valid markers (spreads horde spawns). */
const CLOSEST_POOL_SIZE = 8;

const _points = new Set<EnemySpawnPointActor>();
const _scratch = new THREE.Vector3();
const _minDistSq = MIN_DISTANCE_FROM_PLAYER * MIN_DISTANCE_FROM_PLAYER;

const _preferredDistSq = Array.from({ length: CLOSEST_POOL_SIZE }, () => Infinity);
const _preferred: (EnemySpawnPointActor | null)[] = Array.from(
  { length: CLOSEST_POOL_SIZE },
  () => null,
);

const _fallbackDistSq = Array.from({ length: CLOSEST_POOL_SIZE }, () => Infinity);
const _fallback: (EnemySpawnPointActor | null)[] = Array.from(
  { length: CLOSEST_POOL_SIZE },
  () => null,
);

export function registerEnemySpawnPoint(point: EnemySpawnPointActor): void {
  _points.add(point);
}

export function unregisterEnemySpawnPoint(point: EnemySpawnPointActor): void {
  _points.delete(point);
}

export function getEnemySpawnPointCount(): number {
  return _points.size;
}

function _insertIntoTopN(
  distSq: number,
  point: EnemySpawnPointActor,
  distSlots: number[],
  pointSlots: (EnemySpawnPointActor | null)[],
  countRef: { count: number },
): void {
  const maxSlots = distSlots.length;
  for (let slot = 0; slot < maxSlots; slot++) {
    if (distSq >= distSlots[slot]!) {
      continue;
    }

    const prevCount = countRef.count;
    const shiftEnd = Math.min(prevCount, maxSlots - 1);
    for (let shift = shiftEnd; shift > slot; shift--) {
      distSlots[shift] = distSlots[shift - 1]!;
      pointSlots[shift] = pointSlots[shift - 1]!;
    }

    distSlots[slot] = distSq;
    pointSlots[slot] = point;
    countRef.count = Math.min(prevCount + 1, maxSlots);
    return;
  }
}

function _resetPools(): void {
  for (let i = 0; i < CLOSEST_POOL_SIZE; i++) {
    _preferredDistSq[i] = Infinity;
    _preferred[i] = null;
    _fallbackDistSq[i] = Infinity;
    _fallback[i] = null;
  }
}

/**
 * Picks a random marker among the 8 closest enabled points (XZ) to the player.
 * Skips actors in `exclude`. Designer-placed markers are trusted (no spawn-blocker filter).
 */
export function pickClosestEnemySpawnPoint(
  playerPos: THREE.Vector3,
  out: THREE.Vector3,
  exclude?: ReadonlySet<EnemySpawnPointActor>,
): EnemySpawnPointActor | null {
  if (_points.size === 0) {
    return null;
  }

  _resetPools();

  const preferredCounter = { count: 0 };
  const fallbackCounter = { count: 0 };

  for (const p of _points) {
    if (!p.enabled || exclude?.has(p)) {
      continue;
    }

    p.getSpawnWorldPosition(_scratch);

    const dx = _scratch.x - playerPos.x;
    const dz = _scratch.z - playerPos.z;
    const distSq = dx * dx + dz * dz;

    _insertIntoTopN(distSq, p, _fallbackDistSq, _fallback, fallbackCounter);

    if (distSq >= _minDistSq) {
      _insertIntoTopN(distSq, p, _preferredDistSq, _preferred, preferredCounter);
    }
  }

  const usePreferred = preferredCounter.count > 0;
  const pool = usePreferred ? _preferred : _fallback;
  const count = usePreferred ? preferredCounter.count : fallbackCounter.count;

  if (count === 0) {
    return null;
  }

  const chosen = pool[Math.floor(Math.random() * count)]!;
  chosen.getSpawnWorldPosition(out);
  return chosen;
}

let _spreadPickIndex = 0;

/**
 * Round-robin pick among the closest markers — spreads consecutive spawns/relocates
 * around the player instead of reusing the same nearest pad.
 */
export function pickSpreadEnemySpawnPoint(
  playerPos: THREE.Vector3,
  out: THREE.Vector3,
  exclude?: ReadonlySet<EnemySpawnPointActor>,
): EnemySpawnPointActor | null {
  if (_points.size === 0) {
    return null;
  }

  _resetPools();

  const preferredCounter = { count: 0 };
  const fallbackCounter = { count: 0 };

  for (const p of _points) {
    if (!p.enabled || exclude?.has(p)) {
      continue;
    }

    p.getSpawnWorldPosition(_scratch);

    const dx = _scratch.x - playerPos.x;
    const dz = _scratch.z - playerPos.z;
    const distSq = dx * dx + dz * dz;

    _insertIntoTopN(distSq, p, _fallbackDistSq, _fallback, fallbackCounter);

    if (distSq >= _minDistSq) {
      _insertIntoTopN(distSq, p, _preferredDistSq, _preferred, preferredCounter);
    }
  }

  const usePreferred = preferredCounter.count > 0;
  const pool = usePreferred ? _preferred : _fallback;
  const count = usePreferred ? preferredCounter.count : fallbackCounter.count;

  if (count === 0) {
    return null;
  }

  const available: EnemySpawnPointActor[] = [];
  for (let i = 0; i < count; i++) {
    const point = pool[i]!;
    if (!exclude?.has(point)) {
      available.push(point);
    }
  }

  const pickPool = available.length > 0 ? available : pool.slice(0, count) as EnemySpawnPointActor[];
  const chosen = pickPool[_spreadPickIndex % pickPool.length]!;
  _spreadPickIndex++;

  chosen.getSpawnWorldPosition(out);
  return chosen;
}
