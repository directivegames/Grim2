/**
 * Spatial partitioning manager for zombies.
 *
 * PERFORMANCE: Replaces O(n) zombie scans with O(1) cell-based lookups.
 * This dramatically improves performance with large hordes (50-100+ zombies).
 */
import * as THREE from 'three';
import type { ZombieActor } from './ZombieActor.js';

const CELL_SIZE = 4; // Units - adjust based on separation radius (0.88) * ~4

export class ZombieSpatialManager {
  private static instance: ZombieSpatialManager;
  private grid = new Map<string, ZombieActor[]>();
  private zombieToCell = new Map<ZombieActor, string>();

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
  registerZombie(zombie: ZombieActor): void {
    const pos = new THREE.Vector3();
    zombie.rootComponent.getWorldPosition(pos);
    const cell = this.getCell(pos);

    // Remove from old cell if present
    const oldCell = this.zombieToCell.get(zombie);
    if (oldCell && oldCell !== cell) {
      this.removeFromCell(zombie, oldCell);
    }

    // Add to new cell
    if (!this.grid.has(cell)) {
      this.grid.set(cell, []);
    }
    const cellArray = this.grid.get(cell)!;
    if (!cellArray.includes(zombie)) {
      cellArray.push(zombie);
    }

    this.zombieToCell.set(zombie, cell);
  }

  /**
   * Update zombie position in the grid.
   * Call this periodically (e.g., every 0.5s) in tick.
   */
  updateZombiePosition(zombie: ZombieActor): void {
    const pos = new THREE.Vector3();
    zombie.rootComponent.getWorldPosition(pos);
    const newCell = this.getCell(pos);
    const oldCell = this.zombieToCell.get(zombie);

    if (oldCell !== newCell) {
      // Move to new cell
      if (oldCell) {
        this.removeFromCell(zombie, oldCell);
      }
      if (!this.grid.has(newCell)) {
        this.grid.set(newCell, []);
      }
      this.grid.get(newCell)!.push(zombie);
      this.zombieToCell.set(zombie, newCell);
    }
  }

  /**
   * Unregister a zombie from the grid.
   * Call this in ZombieActor.doEndPlay().
   */
  unregisterZombie(zombie: ZombieActor): void {
    const cell = this.zombieToCell.get(zombie);
    if (cell) {
      this.removeFromCell(zombie, cell);
      this.zombieToCell.delete(zombie);
    }
  }

  /**
   * Get nearby zombies within separation radius.
   * PERFORMANCE: O(1) lookup - only checks 9 cells max.
   */
  getNearbyZombies(position: THREE.Vector3, radius: number): ZombieActor[] {
    const results: ZombieActor[] = [];
    const radiusSq = radius * radius;

    // Calculate cell range to check
    const cellX = Math.floor(position.x / CELL_SIZE);
    const cellZ = Math.floor(position.z / CELL_SIZE);
    const cellRange = Math.ceil(radius / CELL_SIZE);

    // Check neighboring cells (3x3 grid typically, or larger if needed)
    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dz = -cellRange; dz <= cellRange; dz++) {
        const cell = `${cellX + dx},${cellZ + dz}`;
        const zombies = this.grid.get(cell);
        if (!zombies) continue;

        for (const zombie of zombies) {
          // Verify actual distance
          const zPos = new THREE.Vector3();
          zombie.rootComponent.getWorldPosition(zPos);
          const distSq = position.distanceToSquared(zPos);
          if (distSq <= radiusSq) {
            results.push(zombie);
          }
        }
      }
    }

    return results;
  }

  /**
   * Count total zombies in the grid.
   */
  getTotalZombies(): number {
    return this.zombieToCell.size;
  }

  /**
   * Clear all zombies (e.g., on level change).
   */
  clear(): void {
    this.grid.clear();
    this.zombieToCell.clear();
  }

  private getCell(pos: THREE.Vector3): string {
    const x = Math.floor(pos.x / CELL_SIZE);
    const z = Math.floor(pos.z / CELL_SIZE);
    return `${x},${z}`;
  }

  private removeFromCell(zombie: ZombieActor, cell: string): void {
    const cellArray = this.grid.get(cell);
    if (cellArray) {
      const index = cellArray.indexOf(zombie);
      if (index >= 0) {
        cellArray.splice(index, 1);
      }
      // Clean up empty cells
      if (cellArray.length === 0) {
        this.grid.delete(cell);
      }
    }
  }
}

// Export singleton instance
export const zombieSpatialManager = ZombieSpatialManager.getInstance();
