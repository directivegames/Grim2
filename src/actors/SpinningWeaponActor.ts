/**
 * SpinningWeaponActor - Three-hit combo weapon (click or hold LMB).
 *
 * Left-click or hold fires the combo sequence:
 *   1. 180° sweep from right to left
 *   2. 180° sweep from left to right
 *   3. Full 360° orbit
 *
 * The weapon disappears after each hit. The combo index is remembered
 * so subsequent clicks or a held button continue the sequence. It only resets to hit 1
 * after the third hit fully completes.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { WeaponSlashComponent } from '../components/vfx/WeaponSlashComponent.js';
import { WeaponSlashParticleComponent } from '../components/vfx/WeaponSlashParticleComponent.js';
import { WeaponSwingLightComponent } from '../components/vfx/WeaponSwingLightComponent.js';
import { WeaponSummonVFXComponent, APPEAR_COUNT, DISMISS_COUNT } from '../components/vfx/WeaponSummonVFXComponent.js';
import { BloodSplatterComponent } from '../components/vfx/BloodSplatterComponent.js';
import { BoomerangTrailComponent } from '../components/vfx/BoomerangTrailComponent.js';
import { grimVault } from '../game/GrimVault.js';
import { getPlayerWeaponDamage } from '../utils/player-combat-stats.js';
import { FistOfAnnoyanceActor } from './FistOfAnnoyanceActor.js';
import { GrimGrinderModeActor } from './GrimGrinderModeActor.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { HitNumberUI } from '../ui/HitNumberUI.js';
import { missionState } from '../mission/MissionState.js';
import { collectSceneWeapons } from '../utils/scene-visual-pool.js';
import { getMobileAimWorldDirection } from '../utils/mobile-aim.js';
import { isMobileDevice } from '../utils/mobile-device.js';

// ─── Collision Profile ───────────────────────────────────────────────────────

const WEAPON_COLLISION_PROFILE = 'WeaponNoBlock';

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;
const weaponAsyncPhysicsDisableQueued = new WeakSet<ENGINE.SceneNode>();

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

function disableWeaponActorPhysics(weaponRoot: ENGINE.SceneNode): void {
  ensureWeaponCollisionProfile();

  const disableMeshPhysics = (node: ENGINE.SceneNode): void => {
    if (node instanceof ENGINE.MeshNode || node instanceof ENGINE.ModelMeshNode) {
      node.overridePhysicsOptions({
        enabled: false,
        collisionProfile: WEAPON_COLLISION_PROFILE,
      });
    }
  };

  disableMeshPhysics(weaponRoot);
  for (const mesh of weaponRoot.getNodes(ENGINE.MeshNode)) {
    disableMeshPhysics(mesh);
  }
  for (const mesh of weaponRoot.getNodes(ENGINE.ModelMeshNode)) {
    disableMeshPhysics(mesh);
  }

  // GLTF physics can be created after begin play when the model finishes loading.
  // Queue one post-load disable pass per root so no late Rapier body can remain.
  const gltfMeshes = weaponRoot.getNodes(ENGINE.ModelMeshNode);
  if (gltfMeshes.length === 0 || weaponAsyncPhysicsDisableQueued.has(weaponRoot)) {
    return;
  }

  weaponAsyncPhysicsDisableQueued.add(weaponRoot);
  void Promise.all(gltfMeshes.map(mesh => mesh.waitForLoad().catch(() => undefined))).then(() => {
    if (!weaponRoot.getWorld()) {
      return;
    }
    disableMeshPhysics(weaponRoot);
    for (const mesh of weaponRoot.getNodes(ENGINE.MeshNode)) {
      disableMeshPhysics(mesh);
    }
    for (const mesh of weaponRoot.getNodes(ENGINE.ModelMeshNode)) {
      disableMeshPhysics(mesh);
    }
  });
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WEAPON_ACTOR_NAME = 'weapon';
const WEAPON_PARK_Y = -1000;

const WEAPON_HEIGHT    = 0.6;
const HANDLE_OFFSET    = 2.7;
const BLADE_REACH      = 4.0;
const BLADE_ANGLE_OFFSET = Math.PI / 2;
const HIT_RADIUS       = 1.2;
const HIT_COOLDOWN     = 0.4;

/** Duration (seconds) of the swing arc per combo hit (after wind-up). */
const ATTACK_DURATIONS = [0.20, 0.18, 0.28] as const;

/** Brief anticipation before the blade appears and moves. */
const WIND_UP_DURATION = 0.04;

/** Gap between combo swings so each hit reads as its own beat. */
const RECOVERY_DURATION = 0.05;

/** How quickly the visible blade rotation catches up to the hit arc (rad/s factor). */
const BLADE_LAG_SPEED = 11;

/** Max forward pitch (radians) at mid-swing for inertia feel. */
const BLADE_PITCH_MAX = 0.28;

// ─── Boomerang constants ─────────────────────────────────────────────────────

const BOOMERANG_SPEED        = 18;           // units/sec outbound
const BOOMERANG_RETURN_SPEED = 24;           // units/sec inbound (slightly faster)
const BOOMERANG_RANGE        = 10;           // units before turning back
const BOOMERANG_SPIN_RATE    = Math.PI * 9;  // radians/sec — fast top-spin
const BOOMERANG_HEIGHT       = 0.8;          // y offset above player root
const BOOMERANG_CATCH_RADIUS = 1.8;          // distance to player that counts as "caught"
const BOOMERANG_HIT_RADIUS   = 1.1;          // damage sphere radius while in flight
const BOOMERANG_LAUNCH_OFFSET = 1.5;         // units in front of Grim at launch

const SOUL_THROW_SKILL_ID       = 'soulThrow';
export const SOUL_THROW_COOLDOWN_L3 = 10;          // shared cooldown at rank 3
const SOUL_THROW_ARC_HALF_SPREAD = 0.28;       // radians between center and side blades
const SOUL_THROW_DAMAGE_MULT_L3 = 0.55;        // rank 3 per-blade damage multiplier

/** Shared with FistAbilityHUDUI for cooldown display. */
export const FIST_COOLDOWN_SEC = 5;
const FIST_COOLDOWN = FIST_COOLDOWN_SEC;
const FIST_MIN_RANGE         = 5;            // closest an enemy can be targeted
const FIST_MAX_RANGE         = 20;           // furthest an enemy can be targeted

type SoulBladePhase = 'outbound' | 'returning';

interface ActiveSoulBlade {
  phase: SoulBladePhase;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  distanceTraveled: number;
  spinAngle: number;
  /** 0 = scene weapon mesh; 1+ = extra trail-only blades */
  visualSlot: number;
  trail: BoomerangTrailComponent | null;
}

type MeleePhase = 'idle' | 'windup' | 'swing' | 'recovery';

// ─── Attack state ────────────────────────────────────────────────────────────

const enum AttackIndex {
  One   = 0,
  Two   = 1,
  Three = 2,
}

// ─── SpinningWeaponActor ─────────────────────────────────────────────────────

@ENGINE.GameClass()
export class SpinningWeaponActor extends ENGINE.Actor {

  /** Editor-placed weapons: "weapon", "weapon 02", "weapon 03" (slot 0 = melee). */
  private _sceneWeaponActors: ENGINE.SceneNode[] = [];
  private _slashComponent:    WeaponSlashComponent | null = null;
  private _slashParticles:    WeaponSlashParticleComponent | null = null;
  private _swingLight:        WeaponSwingLightComponent | null = null;
  private _summonVFX:         WeaponSummonVFXComponent | null = null;
  private _bloodSplatter:     BloodSplatterComponent | null = null;
  private _boomerangTrail:    BoomerangTrailComponent | null = null;

  /** Current orbital angle (radians). Updated each frame during attacks. */
  private _orbitAngle = 0;

  /** Angle at which the current attack began. */
  private _attackStartAngle = 0;

  /** Target angle at which the current attack ends. */
  private _attackEndAngle = 0;

  /** Which attack fires next (0 = attack1, 1 = attack2, 2 = attack3). */
  private _comboIndex: AttackIndex = AttackIndex.One;

  /** Melee sequence phase (wind-up → swing → recovery). */
  private _meleePhase: MeleePhase = 'idle';

  /** Elapsed game-time seconds in current wind-up phase. */
  private _windupElapsedSec = 0;

  /** Elapsed game-time seconds in current swing phase. */
  private _swingElapsedSec = 0;

  /** Remaining game-time seconds until recovery ends. */
  private _recoveryRemainingSec = 0;

  /** Visual orbit angle — lags behind hit arc during swing. */
  private _displayOrbitAngle = 0;

  private readonly _weaponBaseQuats: THREE.Quaternion[] = [];

  private _orbitQuat = new THREE.Quaternion();
  private _pitchQuat = new THREE.Quaternion();
  private static readonly _Y_AXIS = new THREE.Vector3(0, 1, 0);
  private static readonly _PITCH_AXIS = new THREE.Vector3(1, 0, 0);

  private _hitCooldowns = new Map<ENGINE.Actor, number>();

  // ── Soul Throw (boomerang) state ──────────────────────────────────────────

  private readonly _soulBlades: ActiveSoulBlade[] = [];
  private _extraBladeTrails: BoomerangTrailComponent[] = [];
  private _boomerangSpinQuat  = new THREE.Quaternion();
  private static readonly _SPIN_AXIS = new THREE.Vector3(0, 1, 0);
  private readonly _bladeDirScratch = new THREE.Vector3();

  /** Rank 3 Soul Throw cooldown (starts ready). */
  private _lastSoulThrowTime = -SOUL_THROW_COOLDOWN_L3;

  /** Game-time timestamp of the last fist strike (starts negative so it's ready immediately). */
  private _lastFistTime = -FIST_COOLDOWN;

  /** Buffered melee input - set when clicked during active attack. */
  private _queuedMelee = false;

  /** Hold LMB to chain combo hits without repeated clicks. */
  private _leftMouseHeld = false;

  private _scratchPos        = new THREE.Vector3();
  private _scratchPlayerPos  = new THREE.Vector3();
  private _scratchZombiePos  = new THREE.Vector3();
  private readonly _fistTargetScratch = new THREE.Vector3();
  private readonly _soulBladeDirScratch = new THREE.Vector3();
  private readonly _soulBladeLaunchScratch = new THREE.Vector3();
  private readonly _hitNormalScratch = new THREE.Vector3();
  private readonly _hitLocationScratch = new THREE.Vector3();
  private _weaponStart       = new THREE.Vector3();
  private _weaponEnd         = new THREE.Vector3();

  /** Reused each call to _checkForHits — avoids per-frame Set allocation. */
  private readonly _hitZombiesThisFrame = new Set<ENGINE.Actor>();
  /** Scratch for NDC projection in damage numbers — avoids .clone() per hit. */
  private readonly _ndcScratch = new THREE.Vector3();

  // ── Mouse-to-world helpers (pre-allocated, no per-throw GC) ──────────────
  private readonly _raycaster     = new THREE.Raycaster();
  private readonly _groundPlane   = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly _mouseHitPoint = new THREE.Vector3();

  // ── Input handler ─────────────────────────────────────────────────────────

  /**
   * Minimal input handler — left mouse down/up for attacks and soul throw on right click.
   */
  private readonly _inputHandler: ENGINE.IInputHandler = {
    handleMouseDown: (button: ENGINE.MouseButton): boolean => {
      if (button === ENGINE.MouseButton.Left) {
        this._leftMouseHeld = true;
        this._onLeftClick();
        return false;
      }
      if (button === ENGINE.MouseButton.Right) { this._onRightClick(); return false; }
      return false;
    },
    handleMouseUp: (button: ENGINE.MouseButton): boolean => {
      if (button === ENGINE.MouseButton.Left) {
        this._leftMouseHeld = false;
        return false;
      }
      return false;
    },
    handleMouseMove:  () => false,
    handleMouseClick: () => false,
    handleKeyDown:    (e: KeyboardEvent): boolean => {
      if (e.key === 'e' || e.key === 'E') { this._onEKey(); return false; }
      if (e.key === 'f' || e.key === 'F') { this._onFKey(); return false; }
      return false;
    },
    handleKeyUp:      () => false,
    setInputManager:  () => { /* no-op */ },
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this._orbitAngle = 0;

    const world = this.getWorld();
    if (!world) return false;

    this._sceneWeaponActors = collectSceneWeapons(world);

    if (this._sceneWeaponActors.length > 0) {
      ensureWeaponCollisionProfile();

      for (const weaponActor of this._sceneWeaponActors) {
        disableWeaponActorPhysics(weaponActor);
        weaponActor.visible = false;
        this._weaponBaseQuats.push(weaponActor.quaternion.clone());
      }
    } else {
      console.warn(`[SpinningWeaponActor] No scene actors named "${WEAPON_ACTOR_NAME}" (or "weapon 02", etc.) found.`);
    }

    // Input handler
    world.inputManager.addInputHandler(this._inputHandler);

    // Create components in order - warmup happens AFTER all components exist
    this._slashComponent = WeaponSlashComponent.create();
    this.rootComponent.add(this._slashComponent);

    this._slashParticles = WeaponSlashParticleComponent.create();
    this.rootComponent.add(this._slashParticles);

    this._swingLight = WeaponSwingLightComponent.create();
    this.rootComponent.add(this._swingLight);

    this._summonVFX = WeaponSummonVFXComponent.create();
    this.rootComponent.add(this._summonVFX);

    this._bloodSplatter = BloodSplatterComponent.create();
    this.rootComponent.add(this._bloodSplatter);

    this._boomerangTrail = BoomerangTrailComponent.create();
    this.rootComponent.add(this._boomerangTrail);

    this._extraBladeTrails = [
      BoomerangTrailComponent.create(),
      BoomerangTrailComponent.create(),
    ];
    for (const trail of this._extraBladeTrails) {
      this.rootComponent.add(trail);
    }

    // Post-creation warmups (now components actually exist)
    // Blood splatter pool is already warmed in its beginPlay
    // Summon VFX warmup: burst some particles off-screen to compile shaders
    this._summonVFX?.burst(new THREE.Vector3(0, -1000, 0), 6);
  
    return true;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.getWorld()?.inputManager.removeInputHandler(this._inputHandler);
    return true;
  }

  private _meleeWeapon(): ENGINE.SceneNode | null {
    return this._sceneWeaponActors[0] ?? null;
  }

  private _getSceneWeapon(slot: number): ENGINE.SceneNode | null {
    return this._sceneWeaponActors[slot] ?? null;
  }

  private _getWeaponBaseQuat(slot: number): THREE.Quaternion {
    return this._weaponBaseQuats[slot] ?? this._weaponBaseQuats[0] ?? new THREE.Quaternion();
  }

  private _isWeaponSlotUsedBySoulBlade(slot: number): boolean {
    return this._soulBlades.some((b) => b.visualSlot === slot);
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    const player = this.getWorld()?.getFirstPlayerPawn();

    if (this._soulBlades.length > 0 && player) {
      this._tickSoulBlades(deltaTime, player);
    }

    if (!this._meleeWeapon() || !player) return;

    if (this._meleePhase === 'recovery') {
      this._recoveryRemainingSec -= deltaTime;
      if (this._recoveryRemainingSec <= 0) {
        this._meleePhase = 'idle';
        this._tryChainMelee(player);
      }
      return;
    }

    if (this._meleePhase === 'idle') {
      this._tryChainMelee(player);
      return;
    }
    if (this._isWeaponSlotUsedBySoulBlade(0)) return;

    if (this._meleePhase === 'windup') {
      this._orbitAngle = this._attackStartAngle;
      this._displayOrbitAngle = this._attackStartAngle;
      this._updateWeaponPose(player, 0);

      this._windupElapsedSec += deltaTime;
      if (this._windupElapsedSec >= WIND_UP_DURATION) {
        this._beginSwing(player);
      }
      return;
    }

    this._swingElapsedSec += deltaTime;
    const swingElapsedSec = this._swingElapsedSec;
    const duration = ATTACK_DURATIONS[this._comboIndex];
    const rawProgress = Math.min(swingElapsedSec / duration, 1);
    const progress = heavySwingProgress(rawProgress);

    this._orbitAngle = this._attackStartAngle + (this._attackEndAngle - this._attackStartAngle) * progress;

    const lagT = Math.min(1, BLADE_LAG_SPEED * deltaTime);
    this._displayOrbitAngle += (this._orbitAngle - this._displayOrbitAngle) * lagT;

    const bladePitch = Math.sin(progress * Math.PI) * BLADE_PITCH_MAX;
    this._updateWeaponPose(player, bladePitch);
    this._swingLight?.followBlade(this._weaponStart, this._weaponEnd);

    this._slashComponent?.addSample(
      this._scratchPlayerPos,
      this._orbitAngle,
      HANDLE_OFFSET + BLADE_REACH * 0.85,
      this._scratchPlayerPos.y + WEAPON_HEIGHT,
    );

    this._checkForHits(player);
    this._cleanupCooldowns();

    if (rawProgress >= 1) {
      this._finishSwing(player);
    }
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private _onLeftClick(): void {
    if (GrimGrinderModeActor.isActive()) {
      return;
    }
    // Buffer input during wind-up, swing, or recovery (combo window)
    if (this._isMeleeBusy()) {
      this._queuedMelee = true;
      return;
    }
    if (this._soulThrowBlocksMelee()) return;

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) return;
    this._startAttack(player);
  }

  /** Continue combo when idle if LMB is held or a click was buffered. */
  private _tryChainMelee(player: ENGINE.Pawn): void {
    if (this._meleePhase !== 'idle') {
      return;
    }
    if (!this._queuedMelee && !this._leftMouseHeld) {
      return;
    }
    if (GrimGrinderModeActor.isActive() || this._soulThrowBlocksMelee()) {
      return;
    }
    this._queuedMelee = false;
    this._startAttack(player);
  }

  /** Mobile THROW button and external callers. */
  public triggerSoulThrow(): void {
    this._onRightClick();
  }

  public static triggerSoulThrow(world: ENGINE.World): void {
    const actor = world.getActors().find(
      (a): a is SpinningWeaponActor => a instanceof SpinningWeaponActor,
    );
    actor?.triggerSoulThrow();
  }

  /** Mobile HUD / external callers (same as E key). */
  public triggerFistAbility(): void {
    this._onEKey();
  }

  public static triggerFistAbility(world: ENGINE.World): void {
    SpinningWeaponActor.findInWorld(world)?.triggerFistAbility();
  }

  public static triggerGrimGrinder(world: ENGINE.World): void {
    GrimGrinderModeActor.tryActivate(world);
  }

  /** Auto-swing while mobile aim stick is held (returns true if a new swing started). */
  public tryMobileAutoMelee(): boolean {
    if (!isMobileDevice()) {
      return false;
    }
    if (GrimGrinderModeActor.isActive() || this._soulThrowBlocksMelee()) {
      return false;
    }
    if (this._isMeleeBusy()) {
      this._queuedMelee = true;
      return false;
    }
    this._onLeftClick();
    return true;
  }

  /** Clear held/buffered attack input when leaving gameplay (pause, map, fail screen). */
  public releaseCombatInput(): void {
    this._leftMouseHeld = false;
    this._queuedMelee = false;

    if (this._meleePhase === 'idle') {
      return;
    }

    this._meleePhase = 'idle';
    this._recoveryRemainingSec = 0;
    this._windupElapsedSec = 0;
    this._swingElapsedSec = 0;
    this._setWeaponVisible(false);
    this._swingLight?.endSwing();
    this._slashComponent?.stopTrail();

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.setMeleeArcWindup(false);
    }
  }

  private _onRightClick(): void {
    if (GrimGrinderModeActor.isActive()) {
      return;
    }
    if (this._getSoulThrowLevel() < 1) return;
    if (this._isMeleeBusy() && this._getSoulThrowLevel() < 3) return;
    if (this._getSoulThrowLevel() < 3 && this._hasActiveSoulBlades()) return;
    if (this._isSoulThrowOnCooldown()) return;

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) return;
    this._launchSoulThrow(player);
  }

  private _onFKey(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    GrimGrinderModeActor.tryActivate(world);
  }

  private _onEKey(): void {
    if (GrimGrinderModeActor.isActive()) {
      return;
    }
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();
    if (currentTime - this._lastFistTime < FIST_COOLDOWN) return;

    const player = world.getFirstPlayerPawn();
    if (!player) return;

    const fistLevel = Math.min(3, Math.max(1, grimVault.getSkillLevel('fistOfAnnoyance')));
    const targets = this._pickFistTargets(player, fistLevel);
    if (targets.length === 0) return; // no valid enemy — cooldown does NOT start

    const offsets: [number, number][] = [
      [0, 0],
      [1.4, 0.9],
      [-1.3, -1.0],
    ];

    player.getWorldPosition(this._scratchPlayerPos);

    for (let i = 0; i < targets.length; i++) {
      targets[i]!.rootComponent.getWorldPosition(this._fistTargetScratch);
      const off = offsets[i] ?? [0, 0];
      this._fistTargetScratch.x += off[0];
      this._fistTargetScratch.z += off[1];
      FistOfAnnoyanceActor.spawnAt(world, this._fistTargetScratch);
      getGameAudioManager(world).playAtDistance(
        'fistImpact',
        this._fistTargetScratch,
        this._scratchPlayerPos,
        FIST_MAX_RANGE,
        0.15,
      );
    }

    this._lastFistTime = currentTime; // cooldown starts only now

    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(0.15 + fistLevel * 0.05, 0.35 + fistLevel * 0.05);
    }
  }

  private _pickFistTargets(player: ENGINE.Pawn, maxCount: number): ENGINE.Actor[] {
    player.getWorldPosition(this._scratchPlayerPos);

    const nearby = zombieSpatialManager.getNearbyZombies(this._scratchPlayerPos, FIST_MAX_RANGE);
    const candidates: ENGINE.Actor[] = [];

    // On mobile the player explicitly taps the skill button — allow targeting enemies
    // at any distance within max range (no minimum), so close-combat zombies are valid.
    const minRangeSq = isMobileDevice() ? 0 : FIST_MIN_RANGE * FIST_MIN_RANGE;

    for (const zombie of nearby) {
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

      zombie.rootComponent.getWorldPosition(this._scratchZombiePos);
      const dx = this._scratchZombiePos.x - this._scratchPlayerPos.x;
      const dz = this._scratchZombiePos.z - this._scratchPlayerPos.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < minRangeSq) continue;
      if (distSq > FIST_MAX_RANGE * FIST_MAX_RANGE) continue;

      candidates.push(zombie);
    }

    if (candidates.length === 0) return [];

    const picked: ENGINE.Actor[] = [];
    const pool = [...candidates];
    const count = Math.min(maxCount, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picked.push(pool[idx]!);
      pool.splice(idx, 1);
    }
    return picked;
  }

  private _startAttack(player: ENGINE.Pawn): void {
    // Compute attack direction toward mouse cursor (same pattern as boomerang throw).
    let attackYaw = player instanceof IsometricPlayerPawn ? player.getFacingYaw() : 0;

    const world = this.getWorld();
    if (world) {
      const camera = world.getActiveCamera();
      if (camera) {
        const ndcMouse = world.inputManager.getMousePosition();
        player.getWorldPosition(this._scratchPlayerPos);
        this._groundPlane.constant = -this._scratchPlayerPos.y;
        this._raycaster.setFromCamera(ndcMouse, camera);
        if (this._raycaster.ray.intersectPlane(this._groundPlane, this._mouseHitPoint)) {
          const dx = this._mouseHitPoint.x - this._scratchPlayerPos.x;
          const dz = this._mouseHitPoint.z - this._scratchPlayerPos.z;
          if (dx * dx + dz * dz > 0.0001) {
            attackYaw = Math.atan2(dx, dz); // angle from +Z toward cursor
          }
        }
      }
    }

    // Convert attackYaw (angle from +Z axis) into orbit space (angle from +X axis).
    // orbit uses cos→X / sin→Z, offset is π/2.
    const orbitCenter = Math.PI / 2 - attackYaw;

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

    this._orbitAngle            = this._attackStartAngle;
    this._displayOrbitAngle     = this._attackStartAngle;
    this._windupElapsedSec      = 0;
    this._meleePhase            = 'windup';
    this._hasPrevWeaponPos      = false;
    this._queuedMelee           = false;
    this._setWeaponVisible(false);

    if (player instanceof IsometricPlayerPawn) {
      player.setMeleeArcWindup(true);
    }
  }

  /** Wind-up complete — reveal blade, VFX, audio, and begin the arc. */
  private _beginSwing(player: ENGINE.Pawn): void {
    this._meleePhase = 'swing';
    this._swingElapsedSec = 0;
    this._hasPrevWeaponPos = false;

    this._setWeaponVisible(true);
    player.getWorldPosition(this._scratchPlayerPos);
    this._swingLight?.beginSwing(this._comboIndex === AttackIndex.Three);
    this._slashComponent?.startTrail();
    this._slashParticles?.burstArc(
      this._scratchPlayerPos,
      this._attackStartAngle,
      this._attackEndAngle,
      WEAPON_HEIGHT,
    );

    if (player instanceof IsometricPlayerPawn) {
      const finisher = this._comboIndex === AttackIndex.Three;
      player.setMeleeArcWindup(false);
      player.triggerScreenShake(finisher ? 0.11 : 0.065, finisher ? 0.17 : 0.11);
    }

    const world = this.getWorld();
    if (world) {
      const audioManager = getGameAudioManager(world);
      if (this._comboIndex === AttackIndex.Three) {
        audioManager.play('spinBlade', 1.15, true);
      } else {
        const soundKey = this._comboIndex === AttackIndex.Two ? 'bladeSwing2' : 'bladeSwing';
        audioManager.play(soundKey, 1.25, true);
      }
    }
  }

  private _finishSwing(_player: ENGINE.Pawn): void {
    this._comboIndex = ((this._comboIndex + 1) % 3) as AttackIndex;
    this._setWeaponVisible(false);
    this._swingLight?.endSwing();
    this._slashComponent?.stopTrail();
    this._meleePhase = 'recovery';
    this._recoveryRemainingSec = RECOVERY_DURATION;
  }

  private _isMeleeBusy(): boolean {
    return this._meleePhase !== 'idle';
  }

  private _updateWeaponPose(player: ENGINE.Pawn, bladePitch: number): void {
    const weapon = this._meleeWeapon();
    if (!weapon) return;

    player.getWorldPosition(this._scratchPlayerPos);
    const weaponY = this._scratchPlayerPos.y + WEAPON_HEIGHT;

    weapon.position.set(
      this._scratchPlayerPos.x + Math.cos(this._orbitAngle) * HANDLE_OFFSET,
      weaponY,
      this._scratchPlayerPos.z + Math.sin(this._orbitAngle) * HANDLE_OFFSET,
    );

    const visualAngle = this._meleePhase === 'swing' ? this._displayOrbitAngle : this._orbitAngle;
    this._orbitQuat.setFromAxisAngle(SpinningWeaponActor._Y_AXIS, -visualAngle + BLADE_ANGLE_OFFSET);
    weapon.quaternion.copy(this._getWeaponBaseQuat(0)).premultiply(this._orbitQuat);

    if (bladePitch !== 0) {
      this._pitchQuat.setFromAxisAngle(SpinningWeaponActor._PITCH_AXIS, bladePitch);
      weapon.quaternion.multiply(this._pitchQuat);
    }

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
  }

  private _setWeaponVisible(visible: boolean): void {
    const weapon = this._meleeWeapon();
    if (!weapon || this._isWeaponSlotUsedBySoulBlade(0)) return;
    weapon.visible = visible;

    if (this._summonVFX) {
      weapon.getWorldPosition(this._scratchPos);
      this._summonVFX.burst(this._scratchPos, visible ? APPEAR_COUNT : DISMISS_COUNT);
    }
  }

  // ── Soul Throw ────────────────────────────────────────────────────────────

  private _getSoulThrowLevel(): number {
    return grimVault.getSkillLevel(SOUL_THROW_SKILL_ID);
  }

  private _hasActiveSoulBlades(): boolean {
    return this._soulBlades.length > 0;
  }

  /** Ranks 1–2 lock melee while blades are in flight; rank 3 does not. */
  private _soulThrowBlocksMelee(): boolean {
    return this._getSoulThrowLevel() < 3 && this._hasActiveSoulBlades();
  }

  private _isSoulThrowOnCooldown(): boolean {
    if (this._getSoulThrowLevel() < 3) return false;
    const world = this.getWorld();
    if (!world) return false;
    return world.getGameTime() - this._lastSoulThrowTime < SOUL_THROW_COOLDOWN_L3;
  }

  private _getWeaponDamage(): number {
    return getPlayerWeaponDamage();
  }

  private _soulThrowDamage(): number {
    const base = this._getWeaponDamage();
    return this._getSoulThrowLevel() >= 3
      ? Math.max(1, Math.round(base * SOUL_THROW_DAMAGE_MULT_L3))
      : base;
  }

  private _rotateDirAroundY(dir: THREE.Vector3, yaw: number, out: THREE.Vector3): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    out.set(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
  }

  private _resolveAimDirection(player: ENGINE.Pawn, out: THREE.Vector3): void {
    if (isMobileDevice()) {
      if (getMobileAimWorldDirection(out)) {
        return;
      }
      const yaw = player instanceof IsometricPlayerPawn ? player.getMovementYaw() : 0;
      out.set(Math.sin(yaw), 0, Math.cos(yaw));
      return;
    }

    const world = this.getWorld();
    let dirSet = false;

    if (world) {
      const camera = world.getActiveCamera();
      if (camera) {
        const ndcMouse = world.inputManager.getMousePosition();
        player.getWorldPosition(this._scratchPlayerPos);
        this._groundPlane.constant = -this._scratchPlayerPos.y;
        this._raycaster.setFromCamera(ndcMouse, camera);

        if (this._raycaster.ray.intersectPlane(this._groundPlane, this._mouseHitPoint)) {
          const dx = this._mouseHitPoint.x - this._scratchPlayerPos.x;
          const dz = this._mouseHitPoint.z - this._scratchPlayerPos.z;
          const len = Math.sqrt(dx * dx + dz * dz);
          if (len > 0.01) {
            out.set(dx / len, 0, dz / len);
            dirSet = true;
          }
        }
      }
    }

    if (!dirSet) {
      const facing = player instanceof IsometricPlayerPawn ? player.getFacingYaw() : 0;
      out.set(Math.sin(facing), 0, Math.cos(facing));
    }
  }

  private _launchSoulThrow(player: ENGINE.Pawn): void {
    const level = this._getSoulThrowLevel();
    if (level < 1) return;

    const world = this.getWorld();
    if (!world) return;

    this._resolveAimDirection(player, this._bladeDirScratch);

    const bladeCount = level >= 2 ? 3 : 1;
    const yawOffsets =
      bladeCount === 1
        ? [0]
        : [-SOUL_THROW_ARC_HALF_SPREAD, 0, SOUL_THROW_ARC_HALF_SPREAD];

    for (let i = 0; i < bladeCount; i++) {
      this._rotateDirAroundY(this._bladeDirScratch, yawOffsets[i]!, this._soulBladeDirScratch);
      this._spawnSoulBlade(player, this._soulBladeDirScratch, i);
    }

    if (level >= 3) {
      this._lastSoulThrowTime = world.getGameTime();
    }

    getGameAudioManager(world).play('spinBlade', 1.0, true);
  }

  private _spawnSoulBlade(player: ENGINE.Pawn, dir: THREE.Vector3, visualSlot: number): void {
    player.getWorldPosition(this._soulBladeLaunchScratch);
    this._soulBladeLaunchScratch.y += BOOMERANG_HEIGHT;
    this._soulBladeLaunchScratch.addScaledVector(dir, BOOMERANG_LAUNCH_OFFSET);
    const launchPos = this._soulBladeLaunchScratch.clone();

    const trail =
      visualSlot === 0
        ? this._boomerangTrail
        : this._extraBladeTrails[visualSlot - 1] ?? null;

    const blade: ActiveSoulBlade = {
      phase: 'outbound',
      pos: launchPos,
      dir: dir.clone(),
      distanceTraveled: 0,
      spinAngle: 0,
      visualSlot,
      trail,
    };

    this._soulBlades.push(blade);
    trail?.start();

    const weapon = this._getSceneWeapon(visualSlot);
    if (weapon) {
      weapon.position.copy(launchPos);
      // The thrown weapon is visual-only; damage uses manual swept checks.
      disableWeaponActorPhysics(weapon);
      weapon.visible = true;
      if (visualSlot === 0 && this._summonVFX) {
        this._summonVFX.burst(launchPos, APPEAR_COUNT);
      }
    }
  }

  private _tickSoulBlades(deltaTime: number, player: ENGINE.Pawn): void {
    for (let i = this._soulBlades.length - 1; i >= 0; i--) {
      this._tickOneSoulBlade(this._soulBlades[i]!, deltaTime, player);
    }
  }

  private _tickOneSoulBlade(blade: ActiveSoulBlade, deltaTime: number, player: ENGINE.Pawn): void {
    blade.spinAngle += BOOMERANG_SPIN_RATE * deltaTime;

    if (blade.phase === 'outbound') {
      const step = BOOMERANG_SPEED * deltaTime;
      blade.pos.addScaledVector(blade.dir, step);
      blade.distanceTraveled += step;
      if (blade.distanceTraveled >= BOOMERANG_RANGE) {
        blade.phase = 'returning';
      }
    } else {
      player.getWorldPosition(this._scratchPlayerPos);
      this._scratchPlayerPos.y += BOOMERANG_HEIGHT;

      this._scratchPos.copy(this._scratchPlayerPos).sub(blade.pos);
      const dist = this._scratchPos.length();

      if (dist < BOOMERANG_CATCH_RADIUS) {
        this._dismissSoulBlade(blade);
        return;
      }

      blade.pos.addScaledVector(this._scratchPos.normalize(), BOOMERANG_RETURN_SPEED * deltaTime);
    }

    const weapon = this._getSceneWeapon(blade.visualSlot);
    if (weapon) {
      this._boomerangSpinQuat.setFromAxisAngle(SpinningWeaponActor._SPIN_AXIS, blade.spinAngle);
      weapon.quaternion
        .copy(this._getWeaponBaseQuat(blade.visualSlot))
        .premultiply(this._boomerangSpinQuat);
      weapon.position.copy(blade.pos);
    }

    void blade.trail?.addPoint(blade.pos);
    this._checkSoulBladeHits(blade);
  }

  private _dismissSoulBlade(blade: ActiveSoulBlade): void {
    const idx = this._soulBlades.indexOf(blade);
    if (idx >= 0) {
      this._soulBlades.splice(idx, 1);
    }

    blade.trail?.stop();

    const weapon = this._getSceneWeapon(blade.visualSlot);
    if (weapon) {
      weapon.visible = false;
      disableWeaponActorPhysics(weapon);
      if (blade.visualSlot === 0 && this._summonVFX) {
        this._summonVFX.burst(blade.pos, DISMISS_COUNT);
      }
      weapon.position.y = WEAPON_PARK_Y;
    }
  }

  private _checkSoulBladeHits(blade: ActiveSoulBlade): void {
    const world = this.getWorld();
    if (!world) return;

    const player = world.getFirstPlayerPawn();
    const currentTime = world.getGameTime();
    const damage = this._soulThrowDamage();

    const nearbyZombies = zombieSpatialManager.getNearbyZombies(
      blade.pos,
      BOOMERANG_HIT_RADIUS + 1,
    );

    for (const zombie of nearbyZombies) {
      if ((zombie as unknown as { isHiddenInGame(): boolean }).isHiddenInGame()) {
        continue;
      }

      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

      const lastHit = this._hitCooldowns.get(zombie);
      if (lastHit !== undefined && currentTime - lastHit < HIT_COOLDOWN) continue;

      zombie.rootComponent.getWorldPosition(this._scratchZombiePos);
      const dx = this._scratchZombiePos.x - blade.pos.x;
      const dz = this._scratchZombiePos.z - blade.pos.z;
      if (dx * dx + dz * dz > BOOMERANG_HIT_RADIUS * BOOMERANG_HIT_RADIUS) continue;

      this._hitCooldowns.set(zombie, currentTime);

      this._hitNormalScratch.copy(this._scratchZombiePos).sub(blade.pos).setY(0);
      if (this._hitNormalScratch.lengthSq() < 1e-8) {
        this._hitNormalScratch.set(1, 0, 0);
      } else {
        this._hitNormalScratch.normalize();
      }
      this._hitLocationScratch.copy(this._scratchZombiePos);
      const hitInfo: DamageHitInfo = {
        hitLocation: this._hitLocationScratch,
        hitNormal: this._hitNormalScratch,
      };
      const stats = zombie.getComponent(ENGINE.CharacterStatsComponent);
      if (stats) {
        stats.takeDamage(damage, hitInfo);
        missionState.onDamageDealt(damage);
      }
      (zombie as unknown as { flashYellow(): void }).flashYellow();

      this._bloodSplatter?.burst(this._scratchZombiePos);
      this._showHitNumber(world, this._scratchZombiePos, damage);

      if (player instanceof IsometricPlayerPawn) {
        player.triggerScreenShake(0.12, 0.25);
      }
    }
  }

  // ── Hit detection ─────────────────────────────────────────────────────────

  private _showHitNumber(
    world: ENGINE.World,
    pos: THREE.Vector3,
    damage: number = this._getWeaponDamage(),
  ): void {
    HitNumberUI.getInstance(world).showDamage(damage, pos);
  }

  /** Previous frame weapon positions for swept hit detection. */
  private _prevWeaponStart = new THREE.Vector3();
  private _prevWeaponEnd = new THREE.Vector3();
  private _hasPrevWeaponPos = false;

  private _checkForHits(player: ENGINE.Pawn): void {
    const world = this.getWorld();
    if (!world) return;

    const currentTime = world.getGameTime();

    // Swept detection: if we have previous positions, check multiple substeps
    // to prevent the blade from teleporting through enemies during frame drops
    const startX = this._hasPrevWeaponPos ? this._prevWeaponStart.x : this._weaponStart.x;
    const startZ = this._hasPrevWeaponPos ? this._prevWeaponStart.z : this._weaponStart.z;
    const endX = this._hasPrevWeaponPos ? this._prevWeaponEnd.x : this._weaponEnd.x;
    const endZ = this._hasPrevWeaponPos ? this._prevWeaponEnd.z : this._weaponEnd.z;

    // Calculate how far we moved this frame for determining substeps
    const dx = this._weaponEnd.x - endX;
    const dz = this._weaponEnd.z - endZ;
    const moveDist = Math.sqrt(dx * dx + dz * dz);

    // Use more substeps for larger movements (up to 4 substeps max)
    const subSteps = Math.min(4, Math.max(1, Math.ceil(moveDist / 1.5)));

    // Query a larger area to cover the swept volume
    const queryCenterX = (startX + this._weaponEnd.x) * 0.5;
    const queryCenterZ = (startZ + this._weaponEnd.z) * 0.5;
    const queryRadius  = Math.max(BLADE_REACH, moveDist) * 0.5 + HIT_RADIUS + 1.0;
    this._scratchPos.set(queryCenterX, this._weaponStart.y, queryCenterZ);

    const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._scratchPos, queryRadius);
    const hitZombies = this._hitZombiesThisFrame;
    hitZombies.clear();

    // Check each substep along the swept path
    for (let step = 0; step < subSteps; step++) {
      const t = step / (subSteps - 1 || 1); // 0 to 1
      const stepStartX = THREE.MathUtils.lerp(startX, this._weaponStart.x, t);
      const stepStartZ = THREE.MathUtils.lerp(startZ, this._weaponStart.z, t);
      const stepEndX = THREE.MathUtils.lerp(endX, this._weaponEnd.x, t);
      const stepEndZ = THREE.MathUtils.lerp(endZ, this._weaponEnd.z, t);

      for (const zombie of nearbyZombies) {
        if (hitZombies.has(zombie)) continue; // Already hit this frame

        // Skip hidden (recycled/pooled) zombies
        if ((zombie as unknown as { isHiddenInGame(): boolean }).isHiddenInGame()) {
          continue;
        }

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
          stepStartX, stepStartZ,
          stepEndX,    stepEndZ,
        );

        if (distSq <= HIT_RADIUS * HIT_RADIUS) {
          hitZombies.add(zombie);
          this._hitZombie(zombie, currentTime, player);
        }
      }
    }

    // Store positions for next frame's sweep
    this._prevWeaponStart.copy(this._weaponStart);
    this._prevWeaponEnd.copy(this._weaponEnd);
    this._hasPrevWeaponPos = true;
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
    player.getWorldPosition(this._scratchPlayerPos);

    this._hitNormalScratch.copy(this._scratchZombiePos).sub(this._scratchPlayerPos).setY(0);
    if (this._hitNormalScratch.lengthSq() < 1e-8) {
      this._hitNormalScratch.set(1, 0, 0);
    } else {
      this._hitNormalScratch.normalize();
    }
    this._hitLocationScratch.copy(this._scratchZombiePos);
    const hitInfo: DamageHitInfo = {
      hitLocation: this._hitLocationScratch,
      hitNormal: this._hitNormalScratch,
    };

    const damage = this._getWeaponDamage();
    const stats = zombie.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.takeDamage(damage, hitInfo);
      missionState.onDamageDealt(damage);
    }

    (zombie as unknown as { flashYellow(): void }).flashYellow();

    // Blood splatter at hit location
    this._bloodSplatter?.burst(this._scratchZombiePos);

    // Show hit number with background
    const world = this.getWorld();
    if (world) {
      this._showHitNumber(world, this._scratchZombiePos, damage);
    }

    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(0.22, 0.34);
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

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

  public getFistCooldownRemaining(): number {
    const world = this.getWorld();
    if (!world) {
      return 0;
    }
    const elapsed = world.getGameTime() - this._lastFistTime;
    return Math.max(0, FIST_COOLDOWN - elapsed);
  }

  public isFistReady(): boolean {
    return this.getFistCooldownRemaining() <= 0;
  }

  /** Remaining cooldown in seconds for the rank-3 Soul Throw (0 at ranks 1–2 or when ready). */
  public getSoulThrowCooldownRemaining(): number {
    if (this._getSoulThrowLevel() < 3) return 0;
    const world = this.getWorld();
    if (!world) return 0;
    const elapsed = world.getGameTime() - this._lastSoulThrowTime;
    return Math.max(0, SOUL_THROW_COOLDOWN_L3 - elapsed);
  }

  /** True while rank 1–2 blades are in flight (blocks re-throw until they return). */
  public hasSoulBladesInFlight(): boolean {
    return this._hasActiveSoulBlades();
  }

  /** True during wind-up, swing, or recovery (Soul Throw blocked below rank 3). */
  public isMeleeBusy(): boolean {
    return this._isMeleeBusy();
  }

  /** Current soulThrow skill level (0 = not unlocked). */
  public getSoulThrowSkillLevel(): number {
    return this._getSoulThrowLevel();
  }

  public static findInWorld(world: ENGINE.World): SpinningWeaponActor | null {
    for (const actor of world.getActors()) {
      if (actor instanceof SpinningWeaponActor) {
        return actor;
      }
    }
    return null;
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Heavy swing curve: slow wind-in → fast middle → firm deceleration at the end.
 */
function heavySwingProgress(t: number): number {
  const slowEnd = 0.10;
  const fastEnd = 0.82;

  if (t <= 0) return 0;
  if (t >= 1) return 1;

  if (t < slowEnd) {
    const u = t / slowEnd;
    return 0.07 * u * u;
  }

  if (t < fastEnd) {
    const u = (t - slowEnd) / (fastEnd - slowEnd);
    return 0.07 + 0.83 * (u * u * (3 - 2 * u));
  }

  const u = (t - fastEnd) / (1 - fastEnd);
  return 0.90 + 0.10 * (1 - Math.pow(1 - u, 3));
}
