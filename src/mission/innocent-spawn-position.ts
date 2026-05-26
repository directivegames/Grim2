import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { NEW_ZOMBIE_CAPSULE_HALF_HEIGHT } from '../actors/NewZombieActor.js';
import {
  isValidGameplaySpawnPosition,
  MIN_DISTANCE_FROM_PLAYER,
} from './spawn-exclusion.js';
import { isInsideSpawnBlocker } from './spawn-blockers.js';

/** Ring distance from Grim (world units). */
const SPAWN_MIN = MIN_DISTANCE_FROM_PLAYER;
const SPAWN_MAX = 22;

/** Reject nav snaps that drift too far horizontally (inside geo / off mesh). */
const MAX_SNAP_DISTANCE_XZ = 2.5;

/** Max vertical gap between player and innocent nav points (avoid rooftops / drops). */
const MAX_VERTICAL_DELTA = 1.25;

/** Horde spawns allow slightly more vertical spread than innocents. */
const HORDE_MAX_VERTICAL_DELTA = 2.75;

/** Path samples between player and candidate — all must stay on walkable mesh. */
const PATH_SAMPLES = 7;
const MAX_PATH_SAMPLE_SNAP_XZ = 2.0;

export interface NavMeshQuery {
  isReady?: () => boolean;
  isPointOnNavigationMesh?: (p: THREE.Vector3) => boolean;
  getClosestPointOnNavigationMesh?: (p: THREE.Vector3) => THREE.Vector3;
}

const _candidate = new THREE.Vector3();
const _snapped = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _playerNav = new THREE.Vector3();

function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Snap a world XZ position to the navmesh floor (uses mesh Y — no hover offset).
 */
export function snapPositionToNavFloor(
  nav: NavMeshQuery,
  worldPos: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  if (!nav.isReady?.() || !nav.getClosestPointOnNavigationMesh) {
    return false;
  }

  _candidate.copy(worldPos);
  try {
    _snapped.copy(nav.getClosestPointOnNavigationMesh(_candidate));
  } catch {
    return false;
  }

  if (nav.isPointOnNavigationMesh && !nav.isPointOnNavigationMesh(_snapped)) {
    return false;
  }

  if (horizontalDistance(_candidate, _snapped) > MAX_SNAP_DISTANCE_XZ) {
    return false;
  }

  out.copy(_snapped);
  return true;
}

/** Marker world position with optional nav floor snap (keeps marker Y if snap fails). */
export function applySpawnPointWorldPosition(
  nav: NavMeshQuery | null | undefined,
  markerWorldPos: THREE.Vector3,
  out: THREE.Vector3,
): void {
  out.copy(markerWorldPos);
  if (nav) {
    snapPositionToNavFloor(nav, out, out);
  }
}

/**
 * Horde zombie spawn — floor snap then raise root so capsule feet match nav Y
 * (NewZombieActor root is the capsule center, not the feet).
 */
export function applyHordeZombieSpawnPointWorldPosition(
  nav: NavMeshQuery | null | undefined,
  markerWorldPos: THREE.Vector3,
  out: THREE.Vector3,
): void {
  applySpawnPointWorldPosition(nav, markerWorldPos, out);
  out.y += NEW_ZOMBIE_CAPSULE_HALF_HEIGHT;
}

/**
 * Horde spawn with nav floor snap + capsule offset. Returns false when the marker
 * cannot be placed on walkable nav near the player's height (prevents underground pops).
 */
export function tryApplyHordeZombieSpawnPointWorldPosition(
  nav: NavMeshQuery | null | undefined,
  markerWorldPos: THREE.Vector3,
  playerWorldPos: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  if (!nav?.isReady?.()) {
    return false;
  }

  if (!snapPositionToNavFloor(nav, markerWorldPos, out)) {
    return false;
  }

  if (!snapPositionToNavFloor(nav, playerWorldPos, _playerNav)) {
    _playerNav.copy(playerWorldPos);
  }

  if (Math.abs(out.y - _playerNav.y) > HORDE_MAX_VERTICAL_DELTA) {
    return false;
  }

  out.y += NEW_ZOMBIE_CAPSULE_HALF_HEIGHT;
  return true;
}

function isReachableOnNavMesh(
  nav: NavMeshQuery,
  playerNavPos: THREE.Vector3,
  targetNavPos: THREE.Vector3,
): boolean {
  if (Math.abs(targetNavPos.y - playerNavPos.y) > MAX_VERTICAL_DELTA) {
    return false;
  }

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    _sample.lerpVectors(playerNavPos, targetNavPos, t);
    _sample.y = playerNavPos.y;

    if (!snapPositionToNavFloor(nav, _sample, _snapped)) {
      return false;
    }

    if (horizontalDistance(_sample, _snapped) > MAX_PATH_SAMPLE_SNAP_XZ) {
      return false;
    }

    if (Math.abs(_snapped.y - playerNavPos.y) > MAX_VERTICAL_DELTA) {
      return false;
    }

    if (isInsideSpawnBlocker(_snapped)) {
      return false;
    }
  }

  return true;
}

/**
 * Pick a random spawn point on the navmesh that Grim can walk to.
 * Returns null if nav is unavailable or no valid point found after attempts.
 */
export function pickInnocentSpawnPosition(
  world: ENGINE.World,
  playerWorldPos: THREE.Vector3,
  out: THREE.Vector3,
): boolean {
  const nav = world.getNavigationServer() as NavMeshQuery | null;
  if (!nav?.isReady?.() || !nav.getClosestPointOnNavigationMesh) {
    return false;
  }

  _candidate.copy(playerWorldPos);
  if (!snapPositionToNavFloor(nav, _candidate, _playerNav)) {
    return false;
  }

  const maxAttempts = 32;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);

    _candidate.set(
      _playerNav.x + Math.cos(angle) * distance,
      _playerNav.y,
      _playerNav.z + Math.sin(angle) * distance,
    );

    if (!snapPositionToNavFloor(nav, _candidate, _snapped)) {
      continue;
    }

    if (!isReachableOnNavMesh(nav, _playerNav, _snapped)) {
      continue;
    }

    if (!isValidGameplaySpawnPosition(_snapped, _playerNav)) {
      continue;
    }

    if (horizontalDistance(_playerNav, _snapped) < SPAWN_MIN) {
      continue;
    }

    if (isInsideSpawnBlocker(_snapped)) {
      continue;
    }

    out.copy(_snapped);
    return true;
  }

  return false;
}
