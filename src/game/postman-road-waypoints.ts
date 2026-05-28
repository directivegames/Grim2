/**
 * Random walk points on Road / Intersection scene tiles for Postman boss movement.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { isInsideSpawnBlocker } from '../mission/spawn-blockers.js';

const ROAD_MATERIAL = '@project/assets/textures/Road.material.json';
const INTERSECTION_MATERIAL = '@project/assets/textures/Intersection.material.json';

const WALKABLE_MATERIALS = new Set([ROAD_MATERIAL, INTERSECTION_MATERIAL]);

const TILE_MARGIN = 0.8;
const MAX_PICK_ATTEMPTS = 24;

export interface PostmanWalkTile {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
}

const _scratch = new THREE.Vector3();
const _scale = new THREE.Vector3();

function materialUrlFromActor(actor: ENGINE.Actor): string | null {
  const root = actor.rootComponent;
  if (!(root instanceof ENGINE.MeshComponent)) {
    return null;
  }
  const mat = root.material as unknown;
  return typeof mat === 'string' ? mat : null;
}

function tileFromMeshRoot(root: ENGINE.MeshComponent): PostmanWalkTile | null {
  root.getWorldPosition(_scratch);
  root.getWorldScale(_scale);

  const hx = Math.abs(_scale.x) * 0.5;
  const hz = Math.abs(_scale.z) * 0.5;
  if (hx < 0.5 || hz < 0.5) {
    return null;
  }

  return {
    minX: _scratch.x - hx,
    maxX: _scratch.x + hx,
    minZ: _scratch.z - hz,
    maxZ: _scratch.z + hz,
    floorY: _scratch.y,
  };
}

/** Collect all road / intersection mesh tiles in the loaded world. */
export function buildPostmanWalkTiles(world: ENGINE.World): PostmanWalkTile[] {
  const tiles: PostmanWalkTile[] = [];

  for (const actor of world.getActors()) {
    const url = materialUrlFromActor(actor);
    if (!url || !WALKABLE_MATERIALS.has(url)) {
      continue;
    }

    const root = actor.rootComponent;
    if (!(root instanceof ENGINE.MeshComponent)) {
      continue;
    }

    const tile = tileFromMeshRoot(root);
    if (tile) {
      tiles.push(tile);
    }
  }

  return tiles;
}

/**
 * Pick a random point on a road/intersection tile that is not inside a spawn blocker.
 */
export function pickPostmanWalkPoint(
  tiles: PostmanWalkTile[],
  out: THREE.Vector3,
  feetY: number,
): boolean {
  if (tiles.length === 0) {
    return false;
  }

  for (let attempt = 0; attempt < MAX_PICK_ATTEMPTS; attempt++) {
    const tile = tiles[Math.floor(Math.random() * tiles.length)]!;
    const spanX = tile.maxX - tile.minX - TILE_MARGIN * 2;
    const spanZ = tile.maxZ - tile.minZ - TILE_MARGIN * 2;
    if (spanX < 0.5 || spanZ < 0.5) {
      continue;
    }

    out.set(
      tile.minX + TILE_MARGIN + Math.random() * spanX,
      feetY,
      tile.minZ + TILE_MARGIN + Math.random() * spanZ,
    );

    if (!isInsideSpawnBlocker(out)) {
      return true;
    }
  }

  return false;
}
