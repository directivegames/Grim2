/**
 * Spatial partitioning manager for zombies.
 *
 * PERFORMANCE: Replaces O(n) zombie scans with O(1) cell-based lookups.
 * Uses numeric cell keys and Sets to avoid string allocation and array scans.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const CELL_SIZE = 4; // Units - adjust based on separation radius (0.88) * ~4

/** Pack cell coordinates into a single integer key (no string allocation). */
function cellKey(cellX: number, cellZ: number): number {
  return cellX * 65536 + cellZ;
}

export class ZombieSpatialManager {
  private static instance: ZombieSpatialManager;
  private grid = new Map<number, Set<ENGINE.SceneNode>>();
  private zombieToCell = new Map<ENGINE.SceneNode, number>();

  /** Scratch vector reused for all position queries — avoids per-call GC. */
  private readonly _zPos = new THREE.Vector3();

  /** Scratch results array reused across getNearbyZombies calls — avoids per-call allocation. */
  private readonly _scratchResults: ENGINE.SceneNode[] = [];
  private _scratchResultsLength = 0;

  static getInstance(): ZombieSpatialManager {
    if (!ZombieSpatialManager.instance) {
      ZombieSpatialManager.instance = new ZombieSpatialManager();
    }
    return ZombieSpatialManager.instance;
  }

  /**
   * Register a zombie in the spatial grid.
   * Call this in ZombieActor.doBeginPlay().
   */
  registerZombie(zombie: ENGINE.SceneNode): void {
    zombie.getWorldPosition(this._zPos);
    const cell = this.getCellKey(this._zPos);

    const oldCell = this.zombieToCell.get(zombie);
    if (oldCell !== undefined && oldCell !== cell) {
      this.removeFromCell(zombie, oldCell);
    }

    let cellSet = this.grid.get(cell);
    if (!cellSet) {
      cellSet = new Set();
      this.grid.set(cell, cellSet);
    }
    cellSet.add(zombie);

    this.zombieToCell.set(zombie, cell);
  }

  /**
   * Update zombie position in the grid.
   * Call this periodically (e.g., every 0.5s) in tick.
   */
  updateZombiePosition(zombie: ENGINE.SceneNode): void {
    zombie.getWorldPosition(this._zPos);
    const newCell = this.getCellKey(this._zPos);
    const oldCell = this.zombieToCell.get(zombie);

    if (oldCell !== newCell) {
      if (oldCell !== undefined) {
        this.removeFromCell(zombie, oldCell);
      }
      let cellSet = this.grid.get(newCell);
      if (!cellSet) {
        cellSet = new Set();
        this.grid.set(newCell, cellSet);
      }
      cellSet.add(zombie);
      this.zombieToCell.set(zombie, newCell);
    }
  }

  /**
   * Unregister a zombie from the grid.
   * Call this in ZombieActor.doEndPlay().
   */
  unregisterZombie(zombie: ENGINE.SceneNode): void {
    const cell = this.zombieToCell.get(zombie);
    if (cell !== undefined) {
      this.removeFromCell(zombie, cell);
      this.zombieToCell.delete(zombie);
    }
  }

  /**
   * Get nearby zombies within separation radius.
   * PERFORMANCE: O(1) lookup - only checks 9 cells max.
   */
  getNearbyZombies(position: THREE.Vector3, radius: number): ENGINE.SceneNode[] {
    this._scratchResultsLength = 0;
    const radiusSq = radius * radius;

    const cellX = Math.floor(position.x / CELL_SIZE);
    const cellZ = Math.floor(position.z / CELL_SIZE);
    const cellRange = Math.ceil(radius / CELL_SIZE);

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dz = -cellRange; dz <= cellRange; dz++) {
        const zombies = this.grid.get(cellKey(cellX + dx, cellZ + dz));
        if (!zombies) continue;

        for (const zombie of zombies) {
          zombie.getWorldPosition(this._zPos);
          if (position.distanceToSquared(this._zPos) <= radiusSq) {
            this._scratchResults[this._scratchResultsLength++] = zombie;
          }
        }
      }
    }

    this._scratchResults.length = this._scratchResultsLength;
    return this._scratchResults;
  }

  /**
   * Count total zombies in the grid.
   */
  getTotalZombies(): number {
    return this.zombieToCell.size;
  }

  /** All zombies currently registered (for projectile ignore lists). Returns a new array. */
  getAllRegisteredZombies(): ENGINE.SceneNode[] {
    return Array.from(this.zombieToCell.keys());
  }

  /**
   * Clear all zombies (e.g., on level change).
   */
  clear(): void {
    this.grid.clear();
    this.zombieToCell.clear();
  }

  private getCellKey(pos: THREE.Vector3): number {
    const x = Math.floor(pos.x / CELL_SIZE);
    const z = Math.floor(pos.z / CELL_SIZE);
    return cellKey(x, z);
  }

  private removeFromCell(zombie: ENGINE.SceneNode, cell: number): void {
    const cellSet = this.grid.get(cell);
    if (!cellSet) {
      return;
    }

    cellSet.delete(zombie);
    if (cellSet.size === 0) {
      this.grid.delete(cell);
    }
  }
}

export const zombieSpatialManager = ZombieSpatialManager.getInstance();
