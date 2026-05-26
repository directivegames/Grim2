import * as THREE from 'three';

import type { InnocentSpawnPointActor } from '../actors/InnocentSpawnPointActor.js';

const _points = new Set<InnocentSpawnPointActor>();

export function registerInnocentSpawnPoint(point: InnocentSpawnPointActor): void {
  _points.add(point);
}

export function unregisterInnocentSpawnPoint(point: InnocentSpawnPointActor): void {
  _points.delete(point);
}

export function getInnocentSpawnPointCount(): number {
  return _points.size;
}

/**
 * Pick an enabled marker not in `used`; copies world position to `out`.
 * When all are used, picks a random enabled marker (allows reuse).
 */
export function pickInnocentSpawnPoint(
  used: ReadonlySet<InnocentSpawnPointActor>,
  out: THREE.Vector3,
): InnocentSpawnPointActor | null {
  if (_points.size === 0) {
    return null;
  }

  let unusedCount = 0;
  let onlyUnused: InnocentSpawnPointActor | null = null;

  for (const p of _points) {
    if (!p.enabled) {
      continue;
    }
    if (!used.has(p)) {
      unusedCount++;
      if (Math.random() * unusedCount < 1) {
        onlyUnused = p;
      }
    }
  }

  const chosen = onlyUnused ?? _pickRandomEnabled();
  if (!chosen) {
    return null;
  }

  chosen.getSpawnWorldPosition(out);
  return chosen;
}

function _pickRandomEnabled(): InnocentSpawnPointActor | null {
  let count = 0;
  let pick: InnocentSpawnPointActor | null = null;
  for (const p of _points) {
    if (!p.enabled) {
      continue;
    }
    count++;
    if (Math.random() * count < 1) {
      pick = p;
    }
  }
  return pick;
}
