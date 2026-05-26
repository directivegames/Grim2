import * as THREE from 'three';

import type { SpawnBlockerActor } from '../actors/SpawnBlockerActor.js';

const _activeBlockers = new Set<SpawnBlockerActor>();

export function registerSpawnBlocker(blocker: SpawnBlockerActor): void {
  _activeBlockers.add(blocker);
}

export function unregisterSpawnBlocker(blocker: SpawnBlockerActor): void {
  _activeBlockers.delete(blocker);
}

/** True if world position lies inside any scene SpawnBlocker volume. */
export function isInsideSpawnBlocker(worldPos: THREE.Vector3): boolean {
  for (const blocker of _activeBlockers) {
    if (blocker.containsWorldPoint(worldPos)) {
      return true;
    }
  }
  return false;
}

export function getSpawnBlockerCount(): number {
  return _activeBlockers.size;
}
