/**
 * IsometricPlayerPawn - Vampire Survivors style pawn using Grim2.
 *
 * Camera design (root never rotates → no flicker):
 *   root (y = 0 always)
 *   └─ cameraPivot  ← fixed isometric angle baked in at setup
 *      └─ springArm
 *         └─ camera
 *   └─ visualMesh (Grim2.glb) ← rotation.y smooth facing; skeletal float animations
 *   └─ movementComponent (IsometricMovementComponent)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { ISO_YAW, IsometricMovementComponent } from '../components/movement/IsometricMovementComponent.js';
import { DustTrailComponent } from '../components/vfx/DustTrailComponent.js';
import { BlobShadowComponent } from '../components/vfx/BlobShadowComponent.js';
import { WeaponSwingArcComponent } from '../components/vfx/WeaponSwingArcComponent.js';
import { FistAbilityHUDUI } from '../ui/FistAbilityHUDUI.js';
import { HealthBarUI } from '../ui/HealthBarUI.js';
import { ShopItemIconsHUDUI } from '../ui/ShopItemIconsHUDUI.js';
import { killStreakTracker } from './KillStreakTracker.js';
import { comboMeterTracker } from './ComboMeterTracker.js';
import { grimVault } from '../game/GrimVault.js';
import { hookPlayerDamageMitigation } from '../utils/player-combat-stats.js';
import { missionRunner } from '../mission/MissionRunner.js';
import { missionState } from '../mission/MissionState.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';
import { destroyActorWhenGltfIdle } from '../utils/safe-actor-destroy.js';

/**
 * True symmetric isometric tilt: elevation arctan(1/√2) ≈ 35.26° from horizontal,
 * paired with ISO_YAW = 45° (horizontal corner view). Negated = look down (Y-up).
 */
const ISO_PITCH = -Math.atan(1 / Math.sqrt(2));
const ROTATE_SPEED = 20; // rad/s – visual mesh facing

const GRIM2_MODEL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grim2/Grim2.glb` as ENGINE.ModelPath;
const GRIM2_ANIM_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grim2/Animationgrim.anim.json`;
const GRIM2_MATERIAL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/textures/Grim2texture.material.json` as ENGINE.MaterialPath;

/** Editor-placed Grim2 prop to remove at runtime. */
const SCENE_PLACEHOLDER_GRIM2_ACTOR_UUID = '7e97a710b8d5f00b';

/** Spawn options for {@link IsometricPlayerPawn.create} (used by `pawnFactory` in `game.ts`). */
export type IsometricPlayerPawnOptions = ENGINE.CharacterPawnOptions & {
  cameraDistance?: number;
  visualGroundClearance?: number;
};

@ENGINE.GameClass()
export class IsometricPlayerPawn extends ENGINE.CharacterPawn {

  /**
   * Spring-arm length = distance from character to camera (only camera used in play
   * after scene view-target cameras are turned off in `game.ts`).
   */
  @ENGINE.property({ type: 'number', min: 5, max: 80, step: 1, category: 'Camera' })
  public cameraDistance: number = 15;

  /**
   * Direct local Y of the Grim2 mesh relative to the capsule root.
   */
  @ENGINE.property({ type: 'number', min: -1, max: 2, step: 0.001, category: 'Visual' })
  public visualGroundClearance: number = 0.292;

  public override initialize(options?: IsometricPlayerPawnOptions): void {
    if (options?.cameraDistance != null) {
      this.cameraDistance = options.cameraDistance;
    }
    if (options?.visualGroundClearance != null) {
      this.visualGroundClearance = options.visualGroundClearance;
    }

    const playerStats = ENGINE.CharacterStatsComponent.create({
      maxHealth: 100,
      healthRegen: 0,
      attackCooldown: 1,
      attackRange: 2,
      attackDamage: 0,
      speed: 5,
    });

    super.initialize({
      ...options,
      sceneComponents: [...(options?.sceneComponents ?? []), playerStats],
    });
  }

  // ── Internal state ────────────────────────────────────────────────────────

  private _facingYaw: number = Math.PI; // start facing engine forward (-Z)

  private _sceneGrim2PlaceholderRemoved: boolean = false;

  /** Weapon swing arc indicator component. */
  private _weaponArcComponent: WeaponSwingArcComponent | null = null;

  /** Souls collected from defeated zombies. */
  public soulsCollected: number = 0;

  /** Fractional heal from soul leech — whole HP applied when buffer reaches 1. */
  private _soulHealBuffer = 0;

  /** Health bar UI reference. */
  private _healthBarUI: HealthBarUI | null = null;
  private _fistAbilityHUD: FistAbilityHUDUI | null = null;

  /** Hit number UI reference. */
  private _hitNumberUI: import('../ui/HitNumberUI.js').HitNumberUI | null = null;

  /** KO sign UI reference. */
  private _koSignUI: import('../ui/KOSignUI.js').KOSignUI | null = null;

  // ── Mouse tracking for weapon arc ─────────────────────────────────────────

  private readonly _raycaster = new THREE.Raycaster();
  private readonly _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly _mouseHitPoint = new THREE.Vector3();
  private readonly _playerPosScratch = new THREE.Vector3();

  private static readonly _ARC_COLOR_READY = new THREE.Color(0x88ccff);
  private static readonly _ARC_COLOR_WINDUP = new THREE.Color(0xcc66ff);

  // ── Screen shake state ──────────────────────────────────────────────────

  private _shakeIntensity  = 0;
  private _shakeDurationMs = 0;   // real-time ms
  private _shakeStartMs    = 0;   // performance.now() when shake began
  private readonly _shakeOffset = new THREE.Vector3();
  private _shakeRoll = 0;        // Camera roll during shake (radians)

  // ── Camera FOV / zoom state ───────────────────────────────────────────────

  private static readonly BASE_FOV = 50;
  private static readonly SPRINT_FOV_BOOST = 4;      // +4 FOV when moving
  private static readonly KILL_FOV_PUNCH = 3;        // +3 FOV on kill
  private static readonly STREAK_FOV_BOOST = 12;     // +12 FOV during slomo
  private static readonly DEATH_ZOOM_START = 16.5;     // Starting zoom distance
  private static readonly DEATH_ZOOM_END = 10;       // Target zoom when low health

  private _currentFOV = IsometricPlayerPawn.BASE_FOV;
  private _targetFOV = IsometricPlayerPawn.BASE_FOV;
  private _fovPunchDecay = 0;

  // ── Cinematic focus state ────────────────────────────────────────────────

  private _cinematicActive    = false;
  private _cinematicReturning = false;
  private readonly _cinematicTarget = new THREE.Vector3();
  private readonly _cinematicOffset = new THREE.Vector3();
  private readonly _cinematicDesired = new THREE.Vector3();
  private readonly _cinematicPlayerPos = new THREE.Vector3();
  private static readonly _ZERO_VEC = new THREE.Vector3(0, 0, 0);

  // ── Kill-streak orbit (camera yaws around Grim while he moves) ───────────

  private static readonly STREAK_ORBIT_SWEEP_RAD = Math.PI * 2;
  /** Wall-clock seconds to ease camera yaw back after orbit / slow-mo ends. */
  private static readonly STREAK_ORBIT_RETURN_DURATION_SEC = 1.15;

  private _streakOrbitActive = false;
  private _streakOrbitReturning = false;
  private _streakOrbitElapsed = 0;
  private _streakOrbitDuration = 0;
  private _streakOrbitYaw = 0;
  private _streakOrbitReturnElapsed = 0;
  private _streakOrbitReturnStartYaw = 0;

  // ── Slow-motion screen overlay ────────────────────────────────────────────

  private _slomoOverlayEl: HTMLDivElement | null = null;

  // ── Damage vignette state ────────────────────────────────────────────────

  private _vignetteEl:       HTMLDivElement | null = null;
  private _vignetteStartMs   = 0;     // performance.now() when vignette was shown
  private _vignetteDurationMs = 900;  // 0.9 real seconds to fade out
  private _vignetteActive    = false;
  private _lastKnownHealth   = -1;
  private _missionDeathReported = false;
  /** World position when the pawn first begins play (mission restart spawn). */
  private _missionSpawnPosition: THREE.Vector3 | null = null;
  private _missionSpawnYaw = 0;

  private readonly _onHealthChanged = (current: number, max: number): void => {
    if (this._lastKnownHealth >= 0 && current < this._lastKnownHealth) {
      this._showDamageVignette();
    }
    this._lastKnownHealth = current;
    this._healthBarUI?.updateHealth(current, max);

    if (
      current <= 0 &&
      missionState.isActive &&
      !this._missionDeathReported
    ) {
      this._missionDeathReported = true;
      missionState.onGrimDied();
    }
  };

  // ── Component factory overrides ───────────────────────────────────────────

  protected override setupAnimationComponent(): ENGINE.AnimationStateMachineComponent | null {
    const anim = ENGINE.AnimationStateMachineComponent.create({ configUrl: GRIM2_ANIM_URL });
    this.rootComponent.add(anim);
    return anim;
  }

  protected override setupVisualComponent(): ENGINE.SceneComponent | null {
    const meshComponent = ENGINE.GLTFMeshComponent.create({
      modelUrl: GRIM2_MODEL_URL,
      material: GRIM2_MATERIAL_URL,
      scale: new THREE.Vector3(1, 1, 1),
      rotation: new THREE.Euler(0, Math.PI, 0),
      position: new THREE.Vector3(0, this.visualGroundClearance, 0),
      physicsOptions: { enabled: false },
      castShadow: true,
    });

    // Add the 2 point lights from the scene Grim2
    const leftLight = ENGINE.PointLightComponent.create({
      color: new THREE.Color(0.964686, 0.964686, 0.061246),
      intensity: 5,
      position: new THREE.Vector3(-0.114043, 1.331329, 0.335526),
    });
    leftLight.name = 'Point Light';
    meshComponent.add(leftLight);

    const rightLight = ENGINE.PointLightComponent.create({
      color: new THREE.Color(0.964686, 0.964686, 0.061246),
      intensity: 5,
      position: new THREE.Vector3(0.060097, 1.331329, 0.335526),
    });
    rightLight.name = 'Point Light 02';
    meshComponent.add(rightLight);

    this.rootComponent.add(meshComponent);

    const dustTrail = DustTrailComponent.create();
    this.rootComponent.add(dustTrail);

    const shadow = BlobShadowComponent.create({ radius: 0.55, opacity: 0.35 });
    this.rootComponent.add(shadow);

    // Weapon swing arc indicator - shows 180° attack area on floor
    const weaponArc = WeaponSwingArcComponent.create();
    this.rootComponent.add(weaponArc);
    this._weaponArcComponent = weaponArc;

    return meshComponent;
  }

  protected override createMovementComponent(): ENGINE.BasePawnMovementComponent {
    const mc = IsometricMovementComponent.create();
    mc.accelerationLambda = 30;
    mc.decelerationLambda = 25;
    return mc;
  }

  /**
   * Builds the isometric camera rig.
   * Because the root never rotates, the pivot's LOCAL rotation equals its
   * WORLD rotation – baked once at setup, never needs updating per-frame.
   */
  protected override setupCamera(): THREE.Camera {
    const camera = new THREE.PerspectiveCamera(50, 1, ENGINE.CAMERA_NEAR, ENGINE.CAMERA_FAR);

    this.cameraPivot = ENGINE.SceneComponent.create();
    this.cameraPivot.rotation.set(ISO_PITCH, ISO_YAW, 0, 'YXZ');

    this.springArm = ENGINE.SpringArmComponent.create({
      armLength: this.cameraDistance,
      collisionEnabled: false,
    });

    this.rootComponent.add(this.cameraPivot);
    this.cameraPivot.add(this.springArm);
    this.springArm.add(camera);

    return camera;
  }

  /** No-op: root never rotates so camera is always stable. */
  protected override updateCamera(_dt: number): void { /* intentionally empty */ }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Credit fractional heal per kill (base soul leech + upgrades).
   * Whole HP is applied once the buffer reaches 1.0.
   */
  public addSoulHealCredit(amount: number): void {
    if (amount <= 0 || !Number.isFinite(amount)) {
      return;
    }

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (!stats) {
      return;
    }

    const cur = stats.getCurrentHealth();
    const max = stats.getMaxHealth();
    if (cur >= max) {
      return;
    }

    this._soulHealBuffer += amount;
    const whole = Math.floor(this._soulHealBuffer);
    if (whole < 1) {
      return;
    }

    this._soulHealBuffer -= whole;
    stats.heal(Math.min(whole, max - cur));
  }

  /** Teleport to scene spawn and restore full health for a new mission attempt. */
  public prepareForMissionStart(): void {
    this._missionDeathReported = false;
    this.setHiddenInGame(false);
    this.endKillStreakOrbit();
    this.endSlomoEffect();
    this._soulHealBuffer = 0;

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      // heal() is gated on isDead, so we must clear private state directly first,
      // then fire onHealthChanged so the health bar updates before applyGrimVaultStats
      // calls setMaxHealth() — otherwise that call fires onHealthChanged(0, max) while
      // _missionDeathReported=false, immediately triggering onGrimDied() at mission start.
      const mutableStats = stats as unknown as {
        currentHealth: number;
        isDead: boolean;
      };
      const max = stats.getMaxHealth();
      mutableStats.isDead = false;
      mutableStats.currentHealth = max;
      this._lastKnownHealth = max;
      stats.onHealthChanged.invoke(max, max);
    }

    this.applyGrimVaultStats();
    this.resetToMissionSpawn();
  }

  /** Return Grim to the position captured at first begin play. */
  public resetToMissionSpawn(): void {
    this._captureMissionSpawnFromPlayerStart();
    if (!this._missionSpawnPosition) {
      return;
    }

    const mc = this.movementComponent;
    if (mc instanceof IsometricMovementComponent) {
      mc.resetRuntimeMotion();

      // Teleport with ignoreCollision=true puts the kinematic body exactly at
      // the target. PlayerStart sits at the floor surface (Y=0), so without an
      // upward offset Grim ends up half-embedded in the road geometry and the
      // character controller can't push him up out of it. Spawn a few units
      // above; gravity in the locked Ready-To-Reap branch settles him onto the
      // floor before gameplay unlocks.
      const target = IsometricPlayerPawn._spawnTargetScratch.copy(this._missionSpawnPosition);
      target.y += 2;

      mc.setPawnWorldTransform({
        position: target,
        rotation: new THREE.Euler(0, this._missionSpawnYaw, 0),
      });
    } else {
      this.rootComponent.position.copy(this._missionSpawnPosition);
      this.rootComponent.rotation.y = this._missionSpawnYaw;
    }
    this.rootComponent.updateWorldMatrix(true, true);
  }

  private static readonly _spawnTargetScratch = new THREE.Vector3();

  /** Use the actual ENGINE.PlayerStart actor as the authoritative mission spawn. */
  private _captureMissionSpawnFromPlayerStart(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    const playerStart = world.getActors(ENGINE.PlayerStart)[0];
    if (!playerStart) {
      return;
    }

    playerStart.rootComponent.getWorldPosition(this._playerPosScratch);
    this._missionSpawnPosition = this._playerPosScratch.clone();
    this._missionSpawnYaw = playerStart.rootComponent.rotation.y;
  }

  /** Apply purchased Grim upgrades to runtime stats (call after vault changes or mission start). */
  public applyGrimVaultStats(): void {
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (!stats) {
      return;
    }
    this._soulHealBuffer = 0;
    const grim = grimVault.computeStats();
    const prevMax = stats.getMaxHealth();
    const ratio = prevMax > 0 ? stats.getCurrentHealth() / prevMax : 1;

    stats.setMaxHealth(grim.maxHealth);
    const targetHealth = Math.round(grim.maxHealth * ratio);
    const cur = stats.getCurrentHealth();
    if (targetHealth > cur) {
      stats.heal(targetHealth - cur);
    }
    stats.setSpeed(grim.moveSpeed);
    stats.setAttackDamage(grim.attackMult);
    hookPlayerDamageMitigation(stats);
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    this._captureMissionSpawnFromPlayerStart();
    if (!this._missionSpawnPosition) {
      this.rootComponent.getWorldPosition(this._playerPosScratch);
      this._missionSpawnPosition = this._playerPosScratch.clone();
      this._missionSpawnYaw = this.rootComponent.rotation.y;
    }

    this.applyGrimVaultStats();
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      this._lastKnownHealth = stats.getCurrentHealth();
      stats.onHealthChanged.add(this._onHealthChanged);
      // Initialize health bar UI asynchronously
      void this._initHealthBarUI(stats);
      void this._initFistAbilityHUD();
      void this._initShopItemIconsHUD();
      // Initialize hit number UI
      void this._initHitNumberUI();
      // Initialize KO sign UI
      void this._initKOSignUI();
    }
  }

  private async _initHealthBarUI(stats: ENGINE.CharacterStatsComponent): Promise<void> {
    this._healthBarUI = await HealthBarUI.getInstance(this.getWorld());
    this._healthBarUI.updateHealth(stats.getCurrentHealth(), stats.getMaxHealth());
  }

  private async _initFistAbilityHUD(): Promise<void> {
    this._fistAbilityHUD = await FistAbilityHUDUI.getInstance(this.getWorld());
  }

  private async _initShopItemIconsHUD(): Promise<void> {
    await ShopItemIconsHUDUI.getInstance(this.getWorld());
  }

  private async _initHitNumberUI(): Promise<void> {
    const { HitNumberUI } = await import('../ui/HitNumberUI.js');
    this._hitNumberUI = HitNumberUI.getInstance(this.getWorld());
  }

  private async _initKOSignUI(): Promise<void> {
    const { KOSignUI } = await import('../ui/KOSignUI.js');
    this._koSignUI = KOSignUI.getInstance(this.getWorld());
  }

  /** Current visual facing angle (radians, Y-axis). Used by the weapon for sweep directions. */
  public getFacingYaw(): number {
    return this._facingYaw;
  }

  /** Jumping disabled for VS-style. */
  public override handleJump(_strength: number = 1): void { /* intentionally empty */ }

  /** Fixed camera distance — no mouse-wheel zoom. */
  public override handleMouseWheel(_e: WheelEvent): boolean {
    return false;
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    // Dynamic camera distance with zoom during slomo and death proximity
    const targetDistance = this._calculateTargetCameraDistance();
    this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, targetDistance, 2.0 * deltaTime);

    if (this.springArm && this.springArm.armLength !== this.cameraDistance) {
      this.springArm.armLength = this.cameraDistance;
    }

    this._removeSceneGrim2PlaceholderOnce();

    super.tickPrePhysics(deltaTime); // handles animation parameters
    this._updateVisualFacing(deltaTime);
    this._updateWeaponArcFromMouse(); // Always update arc, even when standing still
    this._updateKillStreakOrbit(deltaTime);
    this._updateCinematicCamera(deltaTime);
    this._updateScreenShake(deltaTime);
    this._updateDamageVignette(deltaTime);
    this._updateCameraFOV(deltaTime);
    // Update health bar animation
    this._healthBarUI?.tick(deltaTime);
    this._fistAbilityHUD?.tick();
    // Update hit number animations
    this._hitNumberUI?.tick();
    // Update KO sign animations
    this._koSignUI?.tick();

    const world = this.getWorld();
    if (world) {
      killStreakTracker.tick(world, deltaTime);
      comboMeterTracker.tick(world, deltaTime);
      missionRunner.tick(world, deltaTime);
    }
  }

  // ── Dynamic camera FOV & zoom ─────────────────────────────────────────────

  private _calculateTargetCameraDistance(): number {
    const world = this.getWorld();
    if (!world) return IsometricPlayerPawn.DEATH_ZOOM_START;

    const slomo = (world as unknown as { slomo: number }).slomo ?? 1.0;
    const baseDistance = IsometricPlayerPawn.DEATH_ZOOM_START;

    // Zoom in during slomo (cinematic feel)
    const slomoZoomFactor = slomo < 0.5 ? (1.0 - slomo) * 0.3 : 0;

    // Zoom in slightly when health is low (death tension)
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    const healthPercent = stats ? stats.getCurrentHealth() / stats.getMaxHealth() : 1.0;
    const deathZoomFactor = healthPercent < 0.25 ? (0.25 - healthPercent) * 0.5 : 0;

    return baseDistance * (1 - slomoZoomFactor - deathZoomFactor);
  }

  private _updateCameraFOV(deltaTime: number): void {
    const world = this.getWorld();
    if (!world) return;

    // Base FOV
    let target = IsometricPlayerPawn.BASE_FOV;

    // Speed boost: FOV increases when moving fast
    const mc = this.movementComponent;
    if (mc instanceof IsometricMovementComponent) {
      const speed = mc.getWorldVelocity().length();
      if (speed > 3) {
        target += IsometricPlayerPawn.SPRINT_FOV_BOOST * Math.min((speed - 3) / 2, 1);
      }
    }

    // Slomo boost: dramatic wide FOV during kill streaks
    const slomo = (world as unknown as { slomo: number }).slomo ?? 1.0;
    if (slomo < 0.5) {
      target += IsometricPlayerPawn.STREAK_FOV_BOOST * (1.0 - slomo);
    }

    // Punch decay: gradually return from kill FOV punch
    if (this._fovPunchDecay > 0) {
      target += this._fovPunchDecay;
      this._fovPunchDecay = THREE.MathUtils.lerp(this._fovPunchDecay, 0, 4.0 * deltaTime);
      if (this._fovPunchDecay < 0.1) this._fovPunchDecay = 0;
    }

    this._targetFOV = target;
    this._currentFOV = THREE.MathUtils.lerp(this._currentFOV, this._targetFOV, 5.0 * deltaTime);

    // Apply to camera
    const camera = world.getActiveCamera();
    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.fov - this._currentFOV) > 0.1) {
      camera.fov = this._currentFOV;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Trigger a brief FOV "punch" on kill for visceral feedback.
   * @param intensity - Scale of the punch (1.0 = full KILL_FOV_PUNCH)
   */
  public triggerFOVPunch(intensity = 1.0): void {
    this._fovPunchDecay = IsometricPlayerPawn.KILL_FOV_PUNCH * intensity;
  }

  /**
   * Kill-streak freeze-frame punch — backdrop-filter over the canvas (not gameContainer.filter).
   */
  public triggerKillStreakPunch(): void {
    const world = this.getWorld();
    const container = world?.gameContainer;
    if (!container) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:198',
      'background:transparent',
    ].join(';');
    container.appendChild(overlay);

    const startTime = performance.now();
    const totalMs = 380;
    const animate = (): void => {
      const t = Math.min((performance.now() - startTime) / totalMs, 1);
      let sat = 1;
      let con = 1;
      if (t < 0.18) {
        const kick = t / 0.18;
        sat = 1 - kick * 0.78;
        con = 1 + kick * 0.5;
      } else {
        const out = (t - 0.18) / 0.82;
        sat = 0.22 + out * 0.78;
        con = 1.5 - out * 0.5;
      }
      const filter = `saturate(${sat}) contrast(${con})`;
      overlay.style.backdropFilter = filter;
      overlay.style.setProperty('-webkit-backdrop-filter', filter);
      if (t < 1) requestAnimationFrame(animate);
      else overlay.remove();
    };
    requestAnimationFrame(animate);
  }

  /**
   * Activate the slow-motion visual overlay: desaturation, blue-tinted vignette,
   * plus a punchy white flash on entry. Call when kill-streak slomo begins.
   */
  public startSlomoEffect(): void {
    const world = this.getWorld();
    const container = world?.gameContainer;
    if (!container) return;

    // Flash on entry
    this._spawnSlomoFlash(container, 'rgba(255,255,255,0.55)', 180);

    // Remove any previous overlay
    this._slomoOverlayEl?.remove();

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'z-index:195',
      'transition:opacity 0.18s ease-out',
      'opacity:0',
      // Desaturate + slight cool tint + radial vignette
      'background:radial-gradient(ellipse at center, transparent 38%, rgba(10,20,60,0.55) 100%)',
      'backdrop-filter:saturate(0.25) brightness(0.88) hue-rotate(15deg)',
      '-webkit-backdrop-filter:saturate(0.25) brightness(0.88) hue-rotate(15deg)',
    ].join(';');
    container.appendChild(overlay);
    this._slomoOverlayEl = overlay;

    // Fade in on next frame so the CSS transition fires
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });
  }

  /**
   * Deactivate the slow-motion overlay with a flash on exit. Call when slomo ends.
   */
  public endSlomoEffect(): void {
    const world = this.getWorld();
    const container = world?.gameContainer;

    if (container) {
      this._spawnSlomoFlash(container, 'rgba(255,255,255,0.4)', 260);
    }

    const overlay = this._slomoOverlayEl;
    if (!overlay) return;
    this._slomoOverlayEl = null;

    overlay.style.transition = 'opacity 0.35s ease-in';
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 400);
  }

  private _spawnSlomoFlash(container: HTMLElement, color: string, durationMs: number): void {
    const flash = document.createElement('div');
    flash.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      `z-index:199`,
      `background:${color}`,
      'opacity:1',
    ].join(';');
    container.appendChild(flash);
    const start = performance.now();
    const animate = (): void => {
      const t = Math.min((performance.now() - start) / durationMs, 1);
      flash.style.opacity = String(1 - t);
      if (t < 1) requestAnimationFrame(animate);
      else flash.remove();
    };
    requestAnimationFrame(animate);
  }

  // ── Visual facing ─────────────────────────────────────────────────────────

  private _updateVisualFacing(deltaTime: number): void {
    if (!this.visualComponent) return;
    const mc = this.movementComponent;
    if (!(mc instanceof IsometricMovementComponent)) return;

    const vel = mc.getWorldVelocity();
    if (vel.lengthSq() < 0.01) return;

    const targetYaw = Math.atan2(vel.x, vel.z);

    let diff = targetYaw - this._facingYaw;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    this._facingYaw += Math.sign(diff) * Math.min(Math.abs(diff), ROTATE_SPEED * deltaTime);

    this.visualComponent.rotation.y = this._facingYaw;
  }

  /**
   * Update weapon arc to point toward mouse cursor (where the weapon will swing).
   */
  private _updateWeaponArcFromMouse(): void {
    if (!this._weaponArcComponent) return;

    const world = this.getWorld();
    if (!world) return;

    const camera = world.getActiveCamera();
    if (!camera) return;

    // Get mouse position and raycast to ground plane
    const ndcMouse = world.inputManager.getMousePosition();
    this._raycaster.setFromCamera(ndcMouse, camera);

    if (this._raycaster.ray.intersectPlane(this._groundPlane, this._mouseHitPoint)) {
      // Calculate angle from player to mouse hit point
      this.rootComponent.getWorldPosition(this._playerPosScratch);
      const dx = this._mouseHitPoint.x - this._playerPosScratch.x;
      const dz = this._mouseHitPoint.z - this._playerPosScratch.z;
      const aimAngle = Math.atan2(dx, dz);

      this._weaponArcComponent.setAimDirection(aimAngle);
    }
  }

  /** Drop the level-authoring Grim2 instance so only the pawn copy exists at runtime. */
  private _removeSceneGrim2PlaceholderOnce(): void {
    if (this._sceneGrim2PlaceholderRemoved) return;
    const world = this.getWorld();
    if (!world) return;
    for (const actor of world.getActors()) {
      if (actor.uuid !== SCENE_PLACEHOLDER_GRIM2_ACTOR_UUID) continue;

      // Defer destroy until GLTF load callbacks finish (avoids "ensure failed").
      this._sceneGrim2PlaceholderRemoved = true;
      destroyActorWhenGltfIdle(actor);
      return;
    }
  }

  /**
   * Reset the placeholder-removed flag so that when the gameplay scene reloads
   * (e.g. after quitting to the main menu and replaying), the placeholder is
   * correctly destroyed again on the next play session.
   */
  public resetScenePlaceholderFlag(): void {
    this._sceneGrim2PlaceholderRemoved = false;
  }

  // ── Animation parameters ─────────────────────────────────────────────────

  protected override getAnimationParameters(): Record<string, unknown> {
    const mc = this.movementComponent;
    if (!(mc instanceof IsometricMovementComponent)) return { state: 'float' };

    const moving = mc.getWorldVelocity().length() > 0.1;
    return {
      state: moving ? 'floatForwards' : 'float',
    };
  }

  // ── Screen shake ─────────────────────────────────────────────────────────

  /**
   * Trigger a brief camera shake effect.
   * @param intensity - Maximum shake offset in world units
   * @param duration - Shake duration in seconds
   */
  public triggerScreenShake(intensity: number, duration: number): void {
    this._shakeIntensity  = intensity;
    this._shakeDurationMs = duration * 1000;  // convert seconds → ms for real-time comparison
    this._shakeStartMs    = performance.now();
  }

  /** Highlights the floor arc during melee wind-up. */
  public setMeleeArcWindup(windup: boolean): void {
    this._weaponArcComponent?.setArcColor(
      windup ? IsometricPlayerPawn._ARC_COLOR_WINDUP : IsometricPlayerPawn._ARC_COLOR_READY,
    );
  }

  // ── Screen shake with smooth noise (not raw random) for polished feel ─────

  private _shakePhase = 0; // Accumulated phase for noise sampling

  private _updateScreenShake(deltaTime: number): void {
    if (!this.cameraPivot) return;

    if (this._shakeDurationMs > 0) {
      const elapsed = performance.now() - this._shakeStartMs;

      if (elapsed >= this._shakeDurationMs) {
        this._shakeOffset.set(0, 0, 0);
        this._shakeDurationMs = 0;
        this._shakePhase = 0;
      } else {
        const t = elapsed / this._shakeDurationMs;
        const currentIntensity = this._shakeIntensity * (1 - t * t); // Ease-out decay

        // Advance phase based on time (8Hz shake frequency)
        this._shakePhase += deltaTime * 50;

        // Smooth noise-like shake using multiple sine waves
        const x = this._shakeNoise(this._shakePhase) * currentIntensity;
        const z = this._shakeNoise(this._shakePhase + 100) * currentIntensity;

        this._shakeOffset.set(x, 0, z);

        // Camera roll during shake for more physical impact feel
        const rollIntensity = currentIntensity * 0.025; // subtle roll during shake
        this._shakeRoll = this._shakeNoiseRoll(this._shakePhase * 0.5) * rollIntensity;
      }
    } else {
      this._shakeOffset.set(0, 0, 0);
      this._shakePhase = 0;
    }

    // Combine cinematic pan + shake into final cameraPivot offset
    this.cameraPivot.position.set(
      this._cinematicOffset.x + this._shakeOffset.x,
      this._cinematicOffset.y + this._shakeOffset.y,
      this._cinematicOffset.z + this._shakeOffset.z,
    );

    // Apply camera roll during shake for more physical feel
    if (this._shakeDurationMs > 0) {
      this.cameraPivot.rotation.z = this._shakeRoll;
    } else {
      this.cameraPivot.rotation.z = THREE.MathUtils.lerp(this.cameraPivot.rotation.z, 0, 5.0 * deltaTime);
    }
  }

  /**
   * Smooth pseudo-noise function using summed sines.
   * Produces continuous, non-jittery shake motion that feels polished.
   */
  private _shakeNoise(phase: number): number {
    // Multiple sine waves at different frequencies for noise-like but smooth motion
    const a = Math.sin(phase) * 0.5;
    const b = Math.sin(phase * 1.3 + 1) * 0.25;
    const c = Math.sin(phase * 2.1 + 2) * 0.125;
    const d = Math.sin(phase * 3.7 + 3) * 0.0625;
    return a + b + c + d; // Range roughly [-0.9, 0.9], normalized feel
  }

  /**
   * Separate noise function for camera roll (different frequency for variety).
   */
  private _shakeNoiseRoll(phase: number): number {
    const a = Math.sin(phase * 0.7) * 0.5;
    const b = Math.sin(phase * 1.1 + 2) * 0.3;
    return a + b;
  }

  // ── Kill-streak orbit ─────────────────────────────────────────────────────

  /**
   * Orbit the isometric camera around Grim (pivot on player root — follows movement).
   * Duration should match kill-streak slow-mo (wall-clock seconds).
   */
  public startKillStreakOrbit(durationSec: number): void {
    this._streakOrbitDuration = Math.max(0.5, durationSec);
    this._streakOrbitElapsed = 0;
    this._streakOrbitYaw = 0;
    this._streakOrbitActive = true;
    this._streakOrbitReturning = false;

    this._cinematicActive = false;
    this._cinematicReturning = false;
    this._cinematicOffset.set(0, 0, 0);
  }

  /** Begin easing camera yaw back to default isometric. */
  public endKillStreakOrbit(): void {
    this._beginOrbitReturn();
  }

  /** Wrap orbit offset to [-π, π] so return takes the shortest path (avoids 2π→0 spin). */
  private _normalizeOrbitYawOffset(yaw: number): number {
    const twoPi = Math.PI * 2;
    let a = yaw % twoPi;
    if (a > Math.PI) a -= twoPi;
    if (a < -Math.PI) a += twoPi;
    return a;
  }

  private _beginOrbitReturn(): void {
    this._streakOrbitActive = false;
    this._streakOrbitYaw = this._normalizeOrbitYawOffset(this._streakOrbitYaw);

    if (Math.abs(this._streakOrbitYaw) < 0.02) {
      this._streakOrbitReturning = false;
      this._streakOrbitYaw = 0;
      this._streakOrbitReturnElapsed = 0;
      this._applyIsometricCameraRotation(0);
      return;
    }

    this._streakOrbitReturning = true;
    this._streakOrbitReturnStartYaw = this._streakOrbitYaw;
    this._streakOrbitReturnElapsed = 0;
  }

  private _applyIsometricCameraRotation(extraYaw: number, rollZ = 0): void {
    if (!this.cameraPivot) return;
    this.cameraPivot.rotation.set(ISO_PITCH, ISO_YAW + extraYaw, rollZ, 'YXZ');
  }

  private static _easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  private _updateKillStreakOrbit(deltaTime: number): void {
    if (!this.cameraPivot) return;
    if (!this._streakOrbitActive && !this._streakOrbitReturning) return;

    const world = this.getWorld();
    const realDt = world ? getUnscaledDeltaTime(world, deltaTime) : deltaTime;

    if (this._streakOrbitReturning) {
      this._streakOrbitReturnElapsed += realDt;
      const t = Math.min(
        this._streakOrbitReturnElapsed / IsometricPlayerPawn.STREAK_ORBIT_RETURN_DURATION_SEC,
        1,
      );
      const eased = 1 - Math.pow(1 - t, 3);
      this._streakOrbitYaw = this._streakOrbitReturnStartYaw * (1 - eased);
      this._applyIsometricCameraRotation(this._streakOrbitYaw);

      if (t >= 1) {
        this._streakOrbitYaw = 0;
        this._streakOrbitReturning = false;
        this._streakOrbitReturnElapsed = 0;
        this._applyIsometricCameraRotation(0);
      }
      return;
    }

    this._streakOrbitElapsed += realDt;
    const t = Math.min(this._streakOrbitElapsed / this._streakOrbitDuration, 1);
    const eased = IsometricPlayerPawn._easeInOutCubic(t);
    this._streakOrbitYaw = IsometricPlayerPawn.STREAK_ORBIT_SWEEP_RAD * eased;
    this._applyIsometricCameraRotation(this._streakOrbitYaw);

    if (t >= 1) {
      this._beginOrbitReturn();
    }
  }

  // ── Cinematic focus ───────────────────────────────────────────────────────

  /** Pan the camera toward a world position and hold there. */
  public startCinematicFocus(worldTarget: THREE.Vector3): void {
    if (this._streakOrbitActive || this._streakOrbitReturning) return;
    this._cinematicTarget.copy(worldTarget);
    this._cinematicActive    = true;
    this._cinematicReturning = false;
  }

  /** Begin returning the camera to the player. */
  public endCinematicFocus(): void {
    this._cinematicReturning = true;
  }

  private _updateCinematicCamera(deltaTime: number): void {
    if (!this._cinematicActive && this._cinematicOffset.lengthSq() < 0.0001) return;

    const PAN_SPEED    = 5.0;   // lerp speed toward/from target
    const MAX_OFFSET   = 7.0;   // max world-unit pan distance
    const PAN_FRACTION = 0.45;  // how far toward the fist to pan (45%)

    if (this._cinematicReturning || !this._cinematicActive) {
      this._cinematicOffset.lerp(IsometricPlayerPawn._ZERO_VEC, PAN_SPEED * deltaTime);
      if (this._cinematicOffset.lengthSq() < 0.001) {
        this._cinematicOffset.set(0, 0, 0);
        this._cinematicActive    = false;
        this._cinematicReturning = false;
      }
      return;
    }

    // Compute desired offset in root-local (=world) XZ toward the fist
    const playerPos = this._cinematicPlayerPos;
    this.rootComponent.getWorldPosition(playerPos);

    this._cinematicDesired.set(
      this._cinematicTarget.x - playerPos.x,
      0,
      this._cinematicTarget.z - playerPos.z,
    ).multiplyScalar(PAN_FRACTION);

    const len = this._cinematicDesired.length();
    if (len > MAX_OFFSET) this._cinematicDesired.multiplyScalar(MAX_OFFSET / len);

    this._cinematicOffset.lerp(this._cinematicDesired, PAN_SPEED * deltaTime);
  }

  // ── Damage vignette ──────────────────────────────────────────────────────

  private _showDamageVignette(): void {
    const world = this.getWorld();
    if (!world) return;
    const container = world.gameContainer;
    if (!container) return;

    if (!this._vignetteEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'inset:0',
        'background:radial-gradient(circle,transparent 40%,rgba(200,0,0,0.65) 100%)',
        'pointer-events:none',
        'opacity:0',
        'z-index:150',
      ].join(';');
      container.appendChild(el);
      this._vignetteEl = el;
    }

    this._vignetteEl.style.opacity = '1';
    this._vignetteActive  = true;
    this._vignetteStartMs = performance.now();
  }

  private _updateDamageVignette(_deltaTime: number): void {
    if (!this._vignetteActive || !this._vignetteEl) return;
    const elapsed = performance.now() - this._vignetteStartMs;
    const alpha = Math.max(0, 1 - elapsed / this._vignetteDurationMs);
    this._vignetteEl.style.opacity = String(alpha);
    if (alpha <= 0) this._vignetteActive = false;
  }

  protected override doEndPlay(): void {
    // Ensure slomo is restored if the pawn is destroyed mid-cinematic
    const world = this.getWorld();
    if (world) {
      (world as unknown as { slomo: number }).slomo = 1;
    }
    this.endKillStreakOrbit();
    this._streakOrbitReturning = false;
    this._streakOrbitYaw = 0;
    this._slomoOverlayEl?.remove();
    this._slomoOverlayEl = null;
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    stats?.onHealthChanged.remove(this._onHealthChanged);
    this._vignetteEl?.remove();
    this._vignetteEl = null;
    // Clean up health bar UI
    this._healthBarUI?.destroy();
    this._healthBarUI = null;
    this._fistAbilityHUD?.destroy();
    this._fistAbilityHUD = null;
    // Clean up KO sign UI
    this._koSignUI?.destroy();
    this._koSignUI = null;
    super.doEndPlay();
  }
}
