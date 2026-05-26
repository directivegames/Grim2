import * as THREE from 'three';

/** Keep innocents / enemies / pickups away from Grim's start position. */
export const PLAYER_SPAWN_EXCLUSION_RADIUS = 14;

/** Minimum horizontal distance from Grim's current position when spawning. */
export const MIN_DISTANCE_FROM_PLAYER = 12;

let _spawnAnchor: THREE.Vector3 | null = null;

export function setPlayerSpawnAnchor(position: THREE.Vector3): void {
  _spawnAnchor = position.clone();
}

export function clearPlayerSpawnAnchor(): void {
  _spawnAnchor = null;
}

export function horizontalDistanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function isNearPlayerSpawn(
  position: THREE.Vector3,
  radius = PLAYER_SPAWN_EXCLUSION_RADIUS,
): boolean {
  if (!_spawnAnchor) {
    return false;
  }
  return horizontalDistanceXZ(position, _spawnAnchor) < radius;
}

export function isTooCloseToPlayer(
  position: THREE.Vector3,
  playerPosition: THREE.Vector3,
  minDistance = MIN_DISTANCE_FROM_PLAYER,
): boolean {
  return horizontalDistanceXZ(position, playerPosition) < minDistance;
}

/** Reject spawn points on top of Grim or in the mission start area. */
export function isValidGameplaySpawnPosition(
  position: THREE.Vector3,
  playerPosition: THREE.Vector3,
): boolean {
  if (isTooCloseToPlayer(position, playerPosition)) {
    return false;
  }
  if (isNearPlayerSpawn(position)) {
    return false;
  }
  return true;
}
