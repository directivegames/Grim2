/**
 * SpinningWeaponActor - Click-triggered three-hit combo weapon.
 *
 * Each left-click fires the next hit in the combo sequence:
 *   1. 180° sweep from right to left
 *   2. 180° sweep from left to right
 *   3. Full 360° orbit
 *
 * The weapon disappears after each hit. The combo index is remembered
 * so subsequent clicks continue the sequence. It only resets to hit 1
 * after the third hit fully completes.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { WeaponSlashComponent } from '../components/vfx/WeaponSlashComponent.js';
import { WeaponSummonVFXComponent, APPEAR_COUNT, DISMISS_COUNT } from '../components/vfx/WeaponSummonVFXComponent.js';
import { FistOfAnnoyanceActor } from './FistOfAnnoyanceActor.js';

// ─── Collision Profile ───────────────────────────────────────────────────────

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

  set(ENGINE.CollisionChannel.Pawn, ENGINE.CollisionResponse.Ignore);
  set(ENGINE.CollisionChannel.WorldDynamic, ENGINE.CollisionResponse.Ignore);
  set(ENGINE.CollisionChannel.WorldStatic, ENGINE.CollisionResponse.Ignore);

  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WEAPON_ACTOR_NAME = 'weapon';

const WEAPON_HEIGHT    = 0.6;
const HANDLE_OFFSET    = 2.7;
const BLADE_REACH      = 4.0;
const BLADE_ANGLE_OFFSET = Math.PI / 2;
const HIT_RADIUS       = 1.2;
const WEAPON_DAMAGE    = 25;
const HIT_COOLDOWN     = 0.4;

/** Duration (seconds) of each attack. */
const ATTACK_DURATIONS = [0.38, 0.38, 0.60] as const;

// ─── Boomerang constants ─────────────────────────────────────────────────────

const BOOMERANG_SPEED        = 18;           // units/sec outbound
const BOOMERANG_RETURN_SPEED = 24;           // units/sec inbound (slightly faster)
const BOOMERANG_RANGE        = 10;           // units before turning back
const BOOMERANG_SPIN_RATE    = Math.PI * 9;  // radians/sec — fast top-spin
const BOOMERANG_HEIGHT       = 0.8;          // y offset above player root
const BOOMERANG_CATCH_RADIUS = 1.8;          // distance to player that counts as "caught"
const BOOMERANG_HIT_RADIUS   = 1.1;          // damage sphere radius while in flight
const BOOMERANG_LAUNCH_OFFSET = 1.5;         // units in front of Grim at launch

const FIST_COOLDOWN          = 5;            // seconds between fist strikes (shortened for testing)
const FIST_MIN_RANGE         = 5;            // closest an enemy can be targeted
const FIST_MAX_RANGE         = 20;           // furthest an enemy can be targeted

type BoomerangPhase = 'idle' | 'outbound' | 'returning';

// ─── Attack state ────────────────────────────────────────────────────────────

const enum AttackIndex {
  One   = 0,
  Two   = 1,
  Three = 2,
}

// ─── SpinningWeaponActor ─────────────────────────────────────────────────────

@ENGINE.GameClass()
export class SpinningWeaponActor extends ENGINE.Actor {

  private _sceneWeaponActor: ENGINE.Actor | null = null;
  private _slashComponent: WeaponSlashComponent | null = null;
  private _summonVFX: WeaponSummonVFXComponent | null = null;

  /** Current orbital angle (radians). Updated each frame during attacks. */
  private _orbitAngle = 0;

  /** Angle at which the current attack began. */
  private _attackStartAngle = 0;

  /** Target angle at which the current attack ends. */
  private _attackEndAngle = 0;

  /** Elapsed time (seconds) within the current attack. */
  private _attackElapsed = 0;

  /** Which attack fires next (0 = attack1, 1 = attack2, 2 = attack3). */
  private _comboIndex: AttackIndex = AttackIndex.One;

  /** Whether an attack is currently playing. */
  private _isAttacking = false;

  private _baseQuat = new THREE.Quaternion();
  private _baseQuatCaptured = false;

  private _orbitQuat = new THREE.Quaternion();
  private static readonly _Y_AXIS = new THREE.Vector3(0, 1, 0);

  private _hitCooldowns = new Map<ENGINE.Actor, number>();

  // ── Boomerang state ───────────────────────────────────────────────────────

  private _boomerangPhase: BoomerangPhase = 'idle';
  private _boomerangPos    = new THREE.Vector3();
  private _boomerangDir    = new THREE.Vector3(); // normalised, horizontal
  private _boomerangDistanceTraveled = 0;
  private _boomerangSpinAngle = 0;
  private _boomerangSpinQuat  = new THREE.Quaternion();
  private static readonly _SPIN_AXIS = new THREE.Vector3(0, 1, 0);

  /** Game-time timestamp of the last fist strike (starts negative so it's ready immediately). */
  private _lastFistTime = -FIST_COOLDOWN;

  private _scratchPos        = new THREE.Vector3();
  private _scratchPlayerPos  = new THREE.Vector3();
  private _scratchZombiePos  = new THREE.Vector3();
  private _weaponStart       = new THREE.Vector3();
  private _weaponEnd         = new THREE.Vector3();

  // ── Input handler ─────────────────────────────────────────────────────────

  /**
   * Minimal input handler — only listens for left mouse-down to trigger attacks.
   * Declared as an arrow-function property so `this` is always correct when the
   * engine calls it through the IInputHandler interface.
   */
  private readonly _inputHandler: ENGINE.IInputHandler = {
    handleMouseDown: (button: ENGINE.MouseButton): boolean => {
      if (button === ENGINE.MouseButton.Left)  { this._onLeftClick();  return false; }
      if (button === ENGINE.MouseButton.Right) { this._onRightClick(); return false; }
      return false;
    },
    handleMouseUp:    () => false,
    handleMouseMove:  () => false,
    handleMouseClick: () => false,
    handleKeyDown:    (e: KeyboardEvent): boolean => {
      if (e.key === 'e' || e.key === 'E') { this._onEKey(); return false; }
      return false;
    },
    handleKeyUp:      () => false,
    setInputManager:  () => { /* no-op */ },
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    this._orbitAngle = 0;

    const world = this.getWorld();
    if (!world) return;

    // Find editor-placed weapon actor
    for (const actor of world.getActors()) {
      if (actor.name.toLowerCase() === WEAPON_ACTOR_NAME.toLowerCase()) {
        this._sceneWeaponActor = actor;
        break;
      }
    }

    if (this._sceneWeaponActor) {
      ensureWeaponCollisionProfile();

      const root = this._sceneWeaponActor.rootComponent;
      if (root instanceof ENGINE.MeshComponent) {
        root.overridePhysicsOptions({
          enabled: false,
          collisionProfile: WEAPON_COLLISION_PROFILE,
        });
      }

      // Start hidden
      this._setWeaponVisible(false);

      // Capture base rotation once so weapon orbits correctly
      this._baseQuat.copy(this._sceneWeaponActor.rootComponent.quaternion);
      this._baseQuatCaptured = true;
    } else {
      console.warn(`[SpinningWeaponActor] No scene actor named "${WEAPON_ACTOR_NAME}" found.`);
    }

    // Park the fist far underground so its shader is compiled by the GPU immediately
    // but the mesh is never visible to the player.
    for (const actor of world.getActors()) {
      if (actor.name.toLowerCase() === 'fistofannoyance') {
        actor.rootComponent.position.y = -1000;
        break;
      }
    }

    world.inputManager.addInputHandler(this._inputHandler);

    this._slashComponent = WeaponSlashComponent.create();
    this.rootComponent.add(this._slashComponent);

    this._summonVFX = WeaponSummonVFXComponent.create();
    this.rootComponent.add(this._summonVFX);
  }

  protected override doEndPlay(): void {
    this.getWorld()?.inputManager.removeInputHandler(this._inputHandler);
    super.doEndPlay();
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    const player = this.getWorld()?.getFirstPlayerPawn();

    // Boomerang takes priority — runs independently of melee
    if (this._boomerangPhase !== 'idle' && player) {
      this._tickBoomerang(deltaTime, player);
    }

    if (!this._isAttacking || !this._sceneWeaponActor) return;
    if (!player) return;

    if (!this._baseQuatCaptured) {
      this._baseQuat.copy(this._sceneWeaponActor.rootComponent.quaternion);
      this._baseQuatCaptured = true;
    }

    this._attackElapsed += deltaTime;
    const duration = ATTACK_DURATIONS[this._comboIndex];
    const rawProgress = Math.min(this._attackElapsed / duration, 1);
    const progress = easeOut(rawProgress);

    this._orbitAngle = this._attackStartAngle + (this._attackEndAngle - this._attackStartAngle) * progress;

    player.rootComponent.getWorldPosition(this._scratchPlayerPos);
    const weaponY = this._scratchPlayerPos.y + WEAPON_HEIGHT;

    this._sceneWeaponActor.rootComponent.position.set(
      this._scratchPlayerPos.x + Math.cos(this._orbitAngle) * HANDLE_OFFSET,
      weaponY,
      this._scratchPlayerPos.z + Math.sin(this._orbitAngle) * HANDLE_OFFSET,
    );

    this._orbitQuat.setFromAxisAngle(SpinningWeaponActor._Y_AXIS, -this._orbitAngle + BLADE_ANGLE_OFFSET);
    this._sceneWeaponActor.rootComponent.quaternion.copy(this._baseQuat).premultiply(this._orbitQuat);

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

    this._slashComponent?.addSample(
      this._scratchPlayerPos,
      this._orbitAngle,
      HANDLE_OFFSET + BLADE_REACH * 0.85,
      weaponY,
    );

    this._checkForHits(player);
    this._cleanupCooldowns();

    // Attack complete
    if (rawProgress >= 1) {
      this._comboIndex = ((this._comboIndex + 1) % 3) as AttackIndex;
      this._isAttacking = false;
      this._setWeaponVisible(false);
      this._slashComponent?.stopTrail();
    }
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private _onLeftClick(): void {
    if (this._isAttacking) return;
    if (this._boomerangPhase !== 'idle') return; // weapon is in flight

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) return;
    this._startAttack(player);
  }

  private _onRightClick(): void {
    if (this._isAttacking) return;           // mid-melee swing
    if (this._boomerangPhase !== 'idle') return; // already in flight

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) return;
    this._throwBoomerang(player);
  }

  private _onEKey(): void {
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();
    if (currentTime - this._lastFistTime < FIST_COOLDOWN) return;

    const player = world.getFirstPlayerPawn();
    if (!player) return;

    const target = this._pickFistTarget(player);
    if (!target) return; // no valid enemy — cooldown does NOT start

    const targetPos = new THREE.Vector3();
    target.rootComponent.getWorldPosition(targetPos);

    FistOfAnnoyanceActor.spawnAt(world, targetPos);
    this._lastFistTime = currentTime; // cooldown starts only now

    // Heavy camera shake on fist impact
    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(0.45, 0.6);
    }
  }

  private _pickFistTarget(player: ENGINE.Pawn): ENGINE.Actor | null {
    const playerPos = new THREE.Vector3();
    player.rootComponent.getWorldPosition(playerPos);

    const nearby = zombieSpatialManager.getNearbyZombies(playerPos, FIST_MAX_RANGE);
    const candidates: ENGINE.Actor[] = [];
    const zPos = new THREE.Vector3();

    for (const zombie of nearby) {
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

      zombie.rootComponent.getWorldPosition(zPos);
      const dx = zPos.x - playerPos.x;
      const dz = zPos.z - playerPos.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < FIST_MIN_RANGE * FIST_MIN_RANGE) continue;
      if (distSq > FIST_MAX_RANGE * FIST_MAX_RANGE) continue;

      candidates.push(zombie);
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private _startAttack(player: ENGINE.Pawn): void {
    const facing = player instanceof IsometricPlayerPawn ? player.getFacingYaw() : 0;

    // Convert facingYaw (angle from +Z axis) into orbit space (angle from +X axis).
    // facingYaw = atan2(vel.x, vel.z), orbit uses cos→X / sin→Z, offset is π/2.
    const orbitCenter = Math.PI / 2 - facing;

    switch (this._comboIndex) {
      case AttackIndex.One:
        // Sweep from right (+90°) to left (-90°) in front of Grim
        this._attackStartAngle = orbitCenter + Math.PI / 2;
        this._attackEndAngle   = orbitCenter - Math.PI / 2;
        break;
      case AttackIndex.Two:
        // Sweep from left (-90°) back to right (+90°) in front of Grim
        this._attackStartAngle = orbitCenter - Math.PI / 2;
        this._attackEndAngle   = orbitCenter + Math.PI / 2;
        break;
      case AttackIndex.Three:
        // Full 360° orbit from current position
        this._attackStartAngle = this._orbitAngle;
        this._attackEndAngle   = this._orbitAngle + Math.PI * 2;
        break;
    }

    this._orbitAngle    = this._attackStartAngle;
    this._attackElapsed = 0;
    this._isAttacking   = true;
    this._setWeaponVisible(true);
    this._slashComponent?.startTrail();
  }

  private _setWeaponVisible(visible: boolean): void {
    if (!this._sceneWeaponActor) return;
    this._sceneWeaponActor.rootComponent.visible = visible;

    if (this._summonVFX) {
      const pos = new THREE.Vector3();
      this._sceneWeaponActor.rootComponent.getWorldPosition(pos);
      this._summonVFX.burst(pos, visible ? APPEAR_COUNT : DISMISS_COUNT);
    }
  }

  // ── Boomerang ─────────────────────────────────────────────────────────────

  private _throwBoomerang(player: ENGINE.Pawn): void {
    if (!this._sceneWeaponActor) return;

    const facing = player instanceof IsometricPlayerPawn ? player.getFacingYaw() : 0;

    // facingYaw = atan2(vel.x, vel.z) → forward dir in XZ
    this._boomerangDir.set(Math.sin(facing), 0, Math.cos(facing)).normalize();

    player.rootComponent.getWorldPosition(this._boomerangPos);
    this._boomerangPos.y += BOOMERANG_HEIGHT;
    this._boomerangPos.addScaledVector(this._boomerangDir, BOOMERANG_LAUNCH_OFFSET);

    this._boomerangDistanceTraveled = 0;
    this._boomerangSpinAngle = 0;
    this._boomerangPhase = 'outbound';

    this._sceneWeaponActor.rootComponent.position.copy(this._boomerangPos);
    this._sceneWeaponActor.rootComponent.visible = true;
    if (this._summonVFX) {
      this._summonVFX.burst(this._boomerangPos.clone(), APPEAR_COUNT);
    }
  }

  private _tickBoomerang(deltaTime: number, player: ENGINE.Pawn): void {
    if (!this._sceneWeaponActor) return;

    // Spin
    this._boomerangSpinAngle += BOOMERANG_SPIN_RATE * deltaTime;
    this._boomerangSpinQuat.setFromAxisAngle(SpinningWeaponActor._SPIN_AXIS, this._boomerangSpinAngle);
    this._sceneWeaponActor.rootComponent.quaternion.copy(this._baseQuat).premultiply(this._boomerangSpinQuat);

    if (this._boomerangPhase === 'outbound') {
      const step = BOOMERANG_SPEED * deltaTime;
      this._boomerangPos.addScaledVector(this._boomerangDir, step);
      this._boomerangDistanceTraveled += step;

      if (this._boomerangDistanceTraveled >= BOOMERANG_RANGE) {
        this._boomerangPhase = 'returning';
      }
    } else {
      // Steer toward Grim's current position
      const playerPos = new THREE.Vector3();
      player.rootComponent.getWorldPosition(playerPos);
      playerPos.y += BOOMERANG_HEIGHT;

      const toGrim = playerPos.clone().sub(this._boomerangPos);
      const dist   = toGrim.length();

      if (dist < BOOMERANG_CATCH_RADIUS) {
        // Caught
        this._boomerangPhase = 'idle';
        this._sceneWeaponActor.rootComponent.visible = false;
        if (this._summonVFX) {
          this._summonVFX.burst(this._boomerangPos.clone(), DISMISS_COUNT);
        }
        return;
      }

      this._boomerangPos.addScaledVector(toGrim.normalize(), BOOMERANG_RETURN_SPEED * deltaTime);
    }

    this._sceneWeaponActor.rootComponent.position.copy(this._boomerangPos);
    this._checkBoomerangHits();
  }

  // ── Hit detection ─────────────────────────────────────────────────────────

  private _checkBoomerangHits(): void {
    const world = this.getWorld();
    if (!world) return;

    const player = world.getFirstPlayerPawn();
    const currentTime = world.getGameTime();

    const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._boomerangPos, BOOMERANG_HIT_RADIUS + 1);

    for (const zombie of nearbyZombies) {
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

      const lastHit = this._hitCooldowns.get(zombie);
      if (lastHit !== undefined && currentTime - lastHit < HIT_COOLDOWN) continue;

      zombie.rootComponent.getWorldPosition(this._scratchZombiePos);
      const dx = this._scratchZombiePos.x - this._boomerangPos.x;
      const dz = this._scratchZombiePos.z - this._boomerangPos.z;
      if (dx * dx + dz * dz > BOOMERANG_HIT_RADIUS * BOOMERANG_HIT_RADIUS) continue;

      this._hitCooldowns.set(zombie, currentTime);

      const hitInfo: DamageHitInfo = {
        hitLocation: this._scratchZombiePos.clone(),
        hitNormal: new THREE.Vector3(0, 1, 0),
      };
      zombie.getComponent(ENGINE.CharacterStatsComponent)?.takeDamage(WEAPON_DAMAGE, hitInfo);
      (zombie as unknown as { flashYellow(): void }).flashYellow();

      if (player instanceof IsometricPlayerPawn) {
        player.triggerScreenShake(0.1, 0.2);
      }
    }
  }

  private _checkForHits(player: ENGINE.Pawn): void {
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();

    const queryCenterX = (this._weaponStart.x + this._weaponEnd.x) * 0.5;
    const queryCenterZ = (this._weaponStart.z + this._weaponEnd.z) * 0.5;
    const queryRadius  = BLADE_REACH * 0.5 + HIT_RADIUS;
    this._scratchPos.set(queryCenterX, this._weaponStart.y, queryCenterZ);

    const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._scratchPos, queryRadius);

    for (const zombie of nearbyZombies) {
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) {
        continue;
      }

      const lastHit = this._hitCooldowns.get(zombie);
      if (lastHit !== undefined && currentTime - lastHit < HIT_COOLDOWN) {
        continue;
      }

      zombie.rootComponent.getWorldPosition(this._scratchZombiePos);
      const distSq = this._pointToSegmentDistSq(
        this._scratchZombiePos.x, this._scratchZombiePos.z,
        this._weaponStart.x,      this._weaponStart.z,
        this._weaponEnd.x,        this._weaponEnd.z,
      );

      if (distSq > HIT_RADIUS * HIT_RADIUS) {
        continue;
      }

      this._hitZombie(zombie, currentTime, player);
    }
  }

  private _pointToSegmentDistSq(
    px: number, pz: number,
    x1: number, z1: number,
    x2: number, z2: number,
  ): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const segLenSq = dx * dx + dz * dz;

    if (segLenSq === 0) {
      const dxp = px - x1;
      const dzp = pz - z1;
      return dxp * dxp + dzp * dzp;
    }

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

    const stats = zombie.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.takeDamage(WEAPON_DAMAGE, hitInfo);
    }

    (zombie as unknown as { flashYellow(): void }).flashYellow();

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
