/**
 * Global uniform manager for grass materials.
 *
 * PERFORMANCE: Instead of each TallGrassActor updating its own material uniforms every frame,
 * this manager updates shared values once per frame and all grass instances read from them.
 * This eliminates O(n) uniform updates where n = number of grass instances.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';
import type { GrassSwayShaderMaterial } from './GrassSwayShaderMaterial.js';

class GrassUniformManagerClass {
  private _time = 0;
  private readonly _playerPos = new THREE.Vector3(0, -9999, 0);
  private _lastPlayerPos = new THREE.Vector3(0, -9999, 0);
  private _registeredMaterials = new Set<GrassSwayShaderMaterial>();
  private _isTickRegistered = false;

  /**
   * Register a grass material to receive global uniform updates.
   * Materials are weakly held and automatically cleaned up when no longer referenced.
   */
  public registerMaterial(material: GrassSwayShaderMaterial): void {
    this._registeredMaterials.add(material);
    this._ensureTickRegistered();
  }

  /**
   * Unregister a material (optional - materials are automatically cleaned up).
   */
  public unregisterMaterial(material: GrassSwayShaderMaterial): void {
    this._registeredMaterials.delete(material);
  }

  /**
   * Get current global time value.
   */
  public getTime(): number {
    return this._time;
  }

  /**
   * Get current global player position.
   */
  public getPlayerPosition(): THREE.Vector3 {
    return this._playerPos;
  }

  /**
   * Manual update - called automatically by tick, but can be called manually if needed.
   */
  public update(deltaTime: number, player: ENGINE.Pawn | null): void {
    this._time += deltaTime;

    if (player) {
      player.rootComponent.getWorldPosition(this._playerPos);
    }

    // PERFORMANCE: Only update materials if time changed or player moved significantly
    const playerMoved = this._playerPos.distanceToSquared(this._lastPlayerPos) > 0.0001;

    if (playerMoved) {
      this._lastPlayerPos.copy(this._playerPos);
    }

    // Update all registered materials
    // Using a counter to batch updates and avoid long stalls
    let updateCount = 0;
    const MAX_UPDATES_PER_FRAME = 50; // Prevent hitches with many materials

    for (const material of this._registeredMaterials) {
      if (updateCount >= MAX_UPDATES_PER_FRAME) break;

      // Check if material is still valid (not disposed)
      if (!material.uniforms) continue;

      material.uniforms.uTime.value = this._time;

      if (playerMoved) {
        material.uniforms.uInteractorPos.value.copy(this._playerPos);
      }

      updateCount++;
    }
  }

  private _ensureTickRegistered(): void {
    if (this._isTickRegistered) return;

    // Hook into the world's pre-physics tick
    const originalTick = ENGINE.World.prototype.tick;
    ENGINE.World.prototype.tick = function(deltaTime: number) {
      const world = this as ENGINE.World;
      const player = world.getFirstPlayerPawn();

      // Update grass uniforms once per frame before physics
      GrassUniformManager.update(deltaTime * 0.001, player); // Convert ms to seconds

      return originalTick.call(this, deltaTime);
    };

    this._isTickRegistered = true;
  }
}

// Global singleton instance
export const GrassUniformManager = new GrassUniformManagerClass();
