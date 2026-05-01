/**
 * SpinningWeaponActor - Vampire Survivors style spinning weapon that orbits the player.
 *
 * Instead of loading its own model, this actor finds the editor-placed scene actor
 * named "weapon" and drives its position/rotation each frame.
 *
 * The weapon:
 *  - Handle base sits at Grim's position; blade points radially outward
 *  - The whole weapon orbits Grim (no self-spin — the blade does not tumble)
 *  - Deals damage to zombies on contact with the blade
 *  - Triggers visual feedback (zombie flashes yellow, screen shake)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';

// ─── Collision Profile ──────────────────────────────────────────────────────

const WEAPON_COLLISION_PROFILE = 'WeaponNoBlock';

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;

function ensureWeaponCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile(WEAPON_COLLISION_PROFILE);
  if (existing) return;

  const profile = new ENGINE.CollisionProfile(
    WEAPON_COLLISION_PROFILE,
    ENGINE.CollisionMode.QueryOnly,
    ENGINE.CollisionChannel.WorldDynamic,
    []
  );

  const responses = (profile as unknown as { responses: MutableProfileResponses }).responses;
  const set = (channel: ENGINE.CollisionChannel, response: ENGINE.CollisionResponse): void => {
    const ch = channel as unknown as string;
    const i = responses.findIndex(r => r.channel === ch);
    if (i >= 0) responses[i].response = response;
    else responses.push({ channel: ch, response });
  };

  // Ignore Pawns (player) so weapon doesn't push Grim back
  set(ENGINE.CollisionChannel.Pawn, ENGINE.CollisionResponse.Ignore);
  // Ignore other WorldDynamic so it doesn't push zombies either
  set(ENGINE.CollisionChannel.WorldDynamic, ENGINE.CollisionResponse.Ignore);
  // Keep blocking WorldStatic if needed (though physics is disabled anyway)
  set(ENGINE.CollisionChannel.WorldStatic, ENGINE.CollisionResponse.Ignore);

  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Name of the editor-placed scene actor that acts as the weapon visual. */
const WEAPON_ACTOR_NAME = 'weapon';

/** Angular speed of the orbit (radians per second). */
const ORBIT_SPEED = 6.5;

/** Height offset from player's Y position (world units). */
const WEAPON_HEIGHT = 0.6;

/**
 * Distance from the model's pivot to the handle end (world units).
 * Shifts the weapon outward so the handle visually sits on Grim rather than the model centre.
 * Tune this until the handle lines up with Grim's body.
 */
const HANDLE_OFFSET = 2.7;

/**
 * Distance from Grim's position to the blade tip used for hit detection (world units).
 * Tune this to match the visual length of the scythe model.
 */
const BLADE_REACH = 4.0;

/**
 * Fixed rotation offset (radians) applied to make the blade point radially outward.
 * Tune this if the weapon aligns parallel to the orbit path instead of perpendicular.
 */
const BLADE_ANGLE_OFFSET = Math.PI / 2;

/** XZ-plane hit detection radius around the blade tip (world units). */
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

  /** Base orientation from the scene editor, stored as a quaternion so tilt is preserved correctly. */
  private _baseQuat = new THREE.Quaternion();

  /** Whether the base quaternion has been captured from the live scene transform yet. */
  private _baseQuatCaptured = false;

  /** Reusable quaternion and axis for orbit rotation — avoids allocations each tick. */
  private _orbitQuat = new THREE.Quaternion();
  private static readonly _Y_AXIS = new THREE.Vector3(0, 1, 0);

  /** Map of zombie -> last hit timestamp to enforce cooldown. */
  private _hitCooldowns = new Map<ENGINE.Actor, number>();

  /** Reusable vectors for position calculations. */
  private _scratchPos = new THREE.Vector3();
  private _scratchPlayerPos = new THREE.Vector3();
  private _scratchZombiePos = new THREE.Vector3();

  /** Weapon hitbox line segment: start (near handle) and end (blade tip). */
  private _weaponStart = new THREE.Vector3();
  private _weaponEnd = new THREE.Vector3();

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
        // Ensure collision profile exists
        ensureWeaponCollisionProfile();

        // Disable physics and set collision to ignore Pawns so it doesn't push Grim back
        const root = this._sceneWeaponActor.rootComponent;
        if (root instanceof ENGINE.MeshComponent) {
          root.overridePhysicsOptions({
            enabled: false,
            collisionProfile: WEAPON_COLLISION_PROFILE,
          });
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

    // Capture the scene-editor orientation on the very first tick, once the scene
    // transform is fully settled. Reading it in doBeginPlay can return identity
    // if the engine hasn't applied the serialized rotation yet.
    if (!this._baseQuatCaptured) {
      this._baseQuat.copy(this._sceneWeaponActor.rootComponent.quaternion);
      this._baseQuatCaptured = true;
    }

    // Update orbit angle
    this._orbitAngle += ORBIT_SPEED * deltaTime;

    // Get player world position
    player.rootComponent.getWorldPosition(this._scratchPlayerPos);

    const weaponY = this._scratchPlayerPos.y + WEAPON_HEIGHT;

    // Shift outward by HANDLE_OFFSET so the handle end sits on Grim rather than the model centre
    this._sceneWeaponActor.rootComponent.position.set(
      this._scratchPlayerPos.x + Math.cos(this._orbitAngle) * HANDLE_OFFSET,
      weaponY,
      this._scratchPlayerPos.z + Math.sin(this._orbitAngle) * HANDLE_OFFSET,
    );

    // Rotate so the weapon faces radially outward along the orbit direction.
    // Negate the angle so rotation direction matches the position direction (clockwise).
    // Add BLADE_ANGLE_OFFSET so the blade points outward rather than along the tangent.
    this._orbitQuat.setFromAxisAngle(SpinningWeaponActor._Y_AXIS, -this._orbitAngle + BLADE_ANGLE_OFFSET);
    this._sceneWeaponActor.rootComponent.quaternion.multiplyQuaternions(this._orbitQuat, this._baseQuat);

    // Store weapon hitbox: start near the handle (close to Grim), end at blade tip
    this._weaponStart.set(
      this._scratchPlayerPos.x + Math.cos(this._orbitAngle) * 0.5,
      weaponY,
      this._scratchPlayerPos.z + Math.sin(this._orbitAngle) * 0.5,
    );
    this._weaponEnd.set(
      this._scratchPlayerPos.x + Math.cos(this._orbitAngle) * BLADE_REACH,
      weaponY,
      this._scratchPlayerPos.z + Math.sin(this._orbitAngle) * BLADE_REACH,
    );

    // Check for hits anywhere along the weapon
    this._checkForHits(player);

    // Clean up expired cooldowns
    this._cleanupCooldowns();
  }

  private _checkForHits(player: ENGINE.Pawn): void {
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();

    // Query a larger area covering the full weapon length
    const queryCenterX = (this._weaponStart.x + this._weaponEnd.x) * 0.5;
    const queryCenterZ = (this._weaponStart.z + this._weaponEnd.z) * 0.5;
    const queryRadius = BLADE_REACH * 0.5 + HIT_RADIUS;
    this._scratchPos.set(queryCenterX, this._weaponStart.y, queryCenterZ);

    const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._scratchPos, queryRadius);

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

      // Check distance to the weapon line segment (XZ plane only)
      zombie.rootComponent.getWorldPosition(this._scratchZombiePos);
      const distSq = this._pointToSegmentDistSq(
        this._scratchZombiePos.x,
        this._scratchZombiePos.z,
        this._weaponStart.x,
        this._weaponStart.z,
        this._weaponEnd.x,
      this._weaponEnd.z,
      );

      if (distSq > HIT_RADIUS * HIT_RADIUS) {
        continue;
      }

      // Hit confirmed
      this._hitZombie(zombie, currentTime, player);
    }
  }

  /** Calculate squared distance from point (px,pz) to line segment (x1,z1)-(x2,z2). */
  private _pointToSegmentDistSq(
    px: number,
    pz: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
  ): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const segLenSq = dx * dx + dz * dz;

    if (segLenSq === 0) {
      // Segment is a point
      const dxp = px - x1;
      const dzp = pz - z1;
      return dxp * dxp + dzp * dzp;
    }

    // Project point onto line, clamped to segment
    let t = ((px - x1) * dx + (pz - z1) * dz) / segLenSq;
    t = Math.max(0, Math.min(1, t));

    const closestX = x1 + t * dx;
    const closestZ = z1 + t * dz;

    const dxp = px - closestX;
    const dzp = pz - closestZ;
    return dxp * dxp + dzp * dzp;
  }

  private _hitZombie(zombie: ENGINE.Actor, currentTime: number, player: ENGINE.Pawn): void {
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
    (zombie as unknown as { flashYellow(): void }).flashYellow();

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
