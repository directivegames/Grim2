/**
 * SpatialHash.ts
 *
 * Flat-grid spatial hash for fast radius queries.
 * Replaces O(n) linear scans with O(cells_in_ring) lookups.
 *
 * - Integer cell keys: no string allocation per lookup.
 * - Scratch result array: no allocation per query call.
 * - Works on XZ plane (Y ignored) — suited for isometric / top-down games.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// ─── Cell key ─────────────────────────────────────────────────────────────────

/**
 * Pack two cell coordinates into a single 32-bit integer key.
 *
 * Safe for cell coordinates in the range [-32768, 32767], which covers
 * ±131 072 world units at a cell size of 4 — enough for any game world.
 */
function cellKey(cellX: number, cellZ: number): number {
  // Bias to positive range before packing so negative coords work correctly
  return ((cellX + 32768) & 0xffff) * 65536 + ((cellZ + 32768) & 0xffff);
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SpatialHashOptions {
  /**
   * Size of each grid cell in world units.
   *
   * Rule of thumb: set to ~4× the typical query radius.
   * Smaller → more cells checked per query.
   * Larger  → more actors per cell, degrading toward O(n) within the cell.
   *
   * Default: 4
   */
  cellSize?: number;
}

// ─── SpatialHash ──────────────────────────────────────────────────────────────

export class SpatialHash<T extends ENGINE.Actor = ENGINE.Actor> {
  private readonly _cellSize: number;
  private readonly _grid      = new Map<number, Set<T>>();
  private readonly _actorCell = new Map<T, number>();

  /** Scratch vector — avoids per-query Vector3 allocation. */
  private readonly _pos = new THREE.Vector3();

  /** Scratch results array — reused across all query() calls. */
  private readonly _results: T[] = [];
  private _resultsLen = 0;

  constructor(options: SpatialHashOptions = {}) {
    this._cellSize = options.cellSize ?? 4;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register an actor into the grid at its current world position.
   * Call from the actor's `doBeginPlay`.
   */
  register(actor: T): void {
    actor.rootComponent.getWorldPosition(this._pos);
    const key = this._posToKey(this._pos);

    const existing = this._actorCell.get(actor);
    if (existing !== undefined && existing !== key) {
      this._removeFromCell(actor, existing);
    }

    this._addToCell(actor, key);
  }

  /**
   * Update the actor's cell when it has moved.
   * Only does work when the actor has crossed a cell boundary.
   * Call from the actor's tick at whatever interval suits its speed.
   */
  update(actor: T): void {
    actor.rootComponent.getWorldPosition(this._pos);
    const newKey = this._posToKey(this._pos);
    const oldKey = this._actorCell.get(actor);

    if (oldKey !== newKey) {
      if (oldKey !== undefined) {
        this._removeFromCell(actor, oldKey);
      }
      this._addToCell(actor, newKey);
    }
  }

  /**
   * Remove an actor from the grid.
   * Call from the actor's `doEndPlay`.
   */
  unregister(actor: T): void {
    const key = this._actorCell.get(actor);
    if (key !== undefined) {
      this._removeFromCell(actor, key);
      this._actorCell.delete(actor);
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /**
   * Return all actors within `radius` units of `center` (XZ distance).
   *
   * IMPORTANT: the returned array is a reused scratch buffer.
   * Iterate it immediately. Do NOT store the reference across frames
   * or across multiple query() calls in the same frame.
   *
   * If you need to keep results, spread into a new array:
   *   const snapshot = [...hash.query(pos, r)];
   */
  query(center: THREE.Vector3, radius: number): readonly T[] {
    this._resultsLen = 0;
    const radiusSq = radius * radius;

    const cx = Math.floor(center.x / this._cellSize);
    const cz = Math.floor(center.z / this._cellSize);
    const range = Math.ceil(radius / this._cellSize);

    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const cell = this._grid.get(cellKey(cx + dx, cz + dz));
        if (!cell) continue;

        for (const actor of cell) {
          actor.rootComponent.getWorldPosition(this._pos);
          const ddx = this._pos.x - center.x;
          const ddz = this._pos.z - center.z;
          if (ddx * ddx + ddz * ddz <= radiusSq) {
            this._results[this._resultsLen++] = actor;
          }
        }
      }
    }

    this._results.length = this._resultsLen;
    return this._results;
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  /** Number of actors currently registered. */
  size(): number {
    return this._actorCell.size;
  }

  /** All registered actors as a new array (allocates — avoid in hot paths). */
  all(): T[] {
    return Array.from(this._actorCell.keys());
  }

  /** Remove all actors. Call before loading a new level or resetting the world. */
  clear(): void {
    this._grid.clear();
    this._actorCell.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _posToKey(pos: THREE.Vector3): number {
    return cellKey(
      Math.floor(pos.x / this._cellSize),
      Math.floor(pos.z / this._cellSize),
    );
  }

  private _addToCell(actor: T, key: number): void {
    let cell = this._grid.get(key);
    if (!cell) {
      cell = new Set<T>();
      this._grid.set(key, cell);
    }
    cell.add(actor);
    this._actorCell.set(actor, key);
  }

  private _removeFromCell(actor: T, key: number): void {
    const cell = this._grid.get(key);
    if (!cell) return;
    cell.delete(actor);
    if (cell.size === 0) {
      this._grid.delete(key); // keep the grid compact
    }
  }
}
