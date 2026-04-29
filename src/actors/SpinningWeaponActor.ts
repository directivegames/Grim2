/**
 * SpinningWeaponActor - Vampire Survivors style spinning weapon that orbits the player.
 *
 * Instead of loading its own model, this actor finds the editor-placed scene actor
 * named "weapon" and drives its position/rotation each frame.
 *
 * The weapon:
 *  - Orbits the player at a fixed radius on the XZ plane
 *  - Deals damage to zombies on contact
 *  - Triggers visual feedback (zombie flashes yellow, screen shake)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { ZombieActor } from './ZombieActor.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Name of the editor-placed scene actor that acts as the weapon visual. */
const WEAPON_ACTOR_NAME = 'weapon';

/** Orbit radius around the player (world units). */
const ORBIT_RADIUS = 5.0;

/** Angular speed of the orbit (radians per second). */
const ORBIT_SPEED = 2.5;

/** Self-spin speed on the weapon's own Z axis (radians per second). */
const SELF_SPIN_SPEED = 12;

/** Height offset from player's Y position (world units). */
const WEAPON_HEIGHT = 0.6;

/** XZ-plane hit detection radius (world units). Y-axis is ignored so height differences don't cause misses. */
const HIT_RADIUS = 1.2;

/** Damage dealt per hit. */
const WEAPON_DAMAGE = 25;

/** Minimum time between hits on the same zombie (seconds). */
const HIT_COOLDOWN = 0.4;

// ─── SpinningWeaponActor ─────────────────────────────────────────────────────

@ENGINE.GameClass()
export class SpinningWeaponActor extends ENGINE.Actor {

  /** The editor-placed weapon scene actor that we drive each frame. */
  private _sceneWeaponActor: ENGINE.Actor | null = null;

  private _orbitAngle = 0;
  private _selfSpinAngle = 0;

  /** Map of zombie -> last hit timestamp to enforce cooldown. */
  private _hitCooldowns = new Map<ZombieActor, number>();

  /** Reusable vectors for position calculations. */
  private _scratchPos = new THREE.Vector3();
  private _scratchPlayerPos = new THREE.Vector3();
  private _scratchZombiePos = new THREE.Vector3();

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    // Randomize starting angle so if multiple weapons exist they don't overlap
    this._orbitAngle = Math.random() * Math.PI * 2;

    // Find the editor-placed weapon actor by name (case-insensitive)
    const world = this.getWorld();
    if (world) {
      for (const actor of world.getActors()) {
        if (actor.name.toLowerCase() === WEAPON_ACTOR_NAME.toLowerCase()) {
          this._sceneWeaponActor = actor;
          break;
        }
      }

      if (this._sceneWeaponActor) {
        // Disable physics so the weapon passes through enemies without blocking them
        const root = this._sceneWeaponActor.rootComponent;
        if (root instanceof ENGINE.MeshComponent) {
          root.overridePhysicsOptions({ enabled: false });
        }
      } else {
        console.warn(`[SpinningWeaponActor] No scene actor named "${WEAPON_ACTOR_NAME}" found.`);
      }
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player || !this._sceneWeaponActor) return;

    // Update angles
    this._orbitAngle += ORBIT_SPEED * deltaTime;
    this._selfSpinAngle += SELF_SPIN_SPEED * deltaTime;

    // Get player world position
    player.rootComponent.getWorldPosition(this._scratchPlayerPos);

    // Calculate orbit position on XZ plane
    const weaponX = this._scratchPlayerPos.x + Math.cos(this._orbitAngle) * ORBIT_RADIUS;
    const weaponZ = this._scratchPlayerPos.z + Math.sin(this._orbitAngle) * ORBIT_RADIUS;
    const weaponY = this._scratchPlayerPos.y + WEAPON_HEIGHT;

    // Drive the scene weapon actor's position
    this._sceneWeaponActor.rootComponent.position.set(weaponX, weaponY, weaponZ);

    // Y faces along the orbit tangent; Z spins the weapon on its own axis (fast blade spin)
    this._sceneWeaponActor.rootComponent.rotation.set(0, this._orbitAngle + Math.PI / 2, this._selfSpinAngle, 'YXZ');

    // Store current weapon world position for hit detection
    this._scratchPos.set(weaponX, weaponY, weaponZ);

    // Check for hits
    this._checkForHits(player);

    // Clean up expired cooldowns
    this._cleanupCooldowns();
  }

  private _checkForHits(player: ENGINE.Pawn): void {
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();

    // Query nearby zombies using spatial grid
    const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._scratchPos, HIT_RADIUS);

    for (const zombie of nearbyZombies) {
      // Skip zombies already in death sequence
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) {
        continue;
      }

      // Check cooldown
      const lastHit = this._hitCooldowns.get(zombie);
      if (lastHit !== undefined && currentTime - lastHit < HIT_COOLDOWN) {
        continue;
      }

      // Verify XZ distance only — Y differences (weapon height vs zombie center)
      // should not prevent a hit when they are visually overlapping.
      zombie.rootComponent.getWorldPosition(this._scratchZombiePos);
      const dx = this._scratchPos.x - this._scratchZombiePos.x;
      const dz = this._scratchPos.z - this._scratchZombiePos.z;
      const xzDistSq = dx * dx + dz * dz;
      if (xzDistSq > HIT_RADIUS * HIT_RADIUS) {
        continue;
      }

      // Hit confirmed
      this._hitZombie(zombie, currentTime, player);
    }
  }

  private _hitZombie(zombie: ZombieActor, currentTime: number, player: ENGINE.Pawn): void {
    this._hitCooldowns.set(zombie, currentTime);

    zombie.rootComponent.getWorldPosition(this._scratchZombiePos);

    const hitInfo: DamageHitInfo = {
      hitLocation: this._scratchZombiePos.clone(),
      hitNormal: new THREE.Vector3(0, 1, 0),
    };

    // Apply damage
    const stats = zombie.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.takeDamage(WEAPON_DAMAGE, hitInfo);
    }

    // Flash zombie yellow
    zombie.flashYellow();

    // Trigger screen shake on player
    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(0.15, 0.25);
    }
  }

  private _cleanupCooldowns(): void {
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();
    const expiry = currentTime - HIT_COOLDOWN * 2;

    for (const [zombie, timestamp] of this._hitCooldowns) {
      if (timestamp < expiry) {
        this._hitCooldowns.delete(zombie);
      }
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
