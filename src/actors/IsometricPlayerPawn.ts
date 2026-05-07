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

  /** Souls collected from defeated zombies. */
  public soulsCollected: number = 0;

  // ── Screen shake state ──────────────────────────────────────────────────

  private _shakeIntensity  = 0;
  private _shakeDurationMs = 0;   // real-time ms
  private _shakeStartMs    = 0;   // performance.now() when shake began
  private readonly _shakeOffset = new THREE.Vector3();

  // ── Cinematic focus state ────────────────────────────────────────────────

  private _cinematicActive    = false;
  private _cinematicReturning = false;
  private readonly _cinematicTarget = new THREE.Vector3();
  private readonly _cinematicOffset = new THREE.Vector3();
  private readonly _cinematicDesired = new THREE.Vector3();
  private readonly _cinematicPlayerPos = new THREE.Vector3();
  private static readonly _ZERO_VEC = new THREE.Vector3(0, 0, 0);

  // ── Damage vignette state ────────────────────────────────────────────────

  private _vignetteEl:       HTMLDivElement | null = null;
  private _vignetteStartMs   = 0;     // performance.now() when vignette was shown
  private _vignetteDurationMs = 900;  // 0.9 real seconds to fade out
  private _vignetteActive    = false;
  private _lastKnownHealth   = -1;

  private readonly _onHealthChanged = (current: number): void => {
    if (this._lastKnownHealth >= 0 && current < this._lastKnownHealth) {
      this._showDamageVignette();
    }
    this._lastKnownHealth = current;
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

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      this._lastKnownHealth = stats.getCurrentHealth();
      stats.onHealthChanged.add(this._onHealthChanged);
    }
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
    if (this.springArm && this.springArm.armLength !== this.cameraDistance) {
      this.springArm.armLength = this.cameraDistance;
    }

    this._removeSceneGrim2PlaceholderOnce();

    super.tickPrePhysics(deltaTime); // handles animation parameters
    this._updateVisualFacing(deltaTime);
    this._updateCinematicCamera(deltaTime);
    this._updateScreenShake(deltaTime);
    this._updateDamageVignette(deltaTime);
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

  /** Drop the level-authoring Grim2 instance so only the pawn copy exists at runtime. */
  private _removeSceneGrim2PlaceholderOnce(): void {
    if (this._sceneGrim2PlaceholderRemoved) return;
    const world = this.getWorld();
    if (!world) return;
    for (const actor of world.getActors()) {
      if (actor.uuid === SCENE_PLACEHOLDER_GRIM2_ACTOR_UUID) {
        actor.destroy();
        this._sceneGrim2PlaceholderRemoved = true;
        return;
      }
    }
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

  private _updateScreenShake(_deltaTime: number): void {
    if (!this.cameraPivot) return;

    if (this._shakeDurationMs > 0) {
      const elapsed = performance.now() - this._shakeStartMs;

      if (elapsed >= this._shakeDurationMs) {
        this._shakeOffset.set(0, 0, 0);
        this._shakeDurationMs = 0;
      } else {
        const t = elapsed / this._shakeDurationMs;
        const currentIntensity = this._shakeIntensity * (1 - t);
        this._shakeOffset.set(
          (Math.random() - 0.5) * 2 * currentIntensity,
          0,
          (Math.random() - 0.5) * 2 * currentIntensity,
        );
      }
    } else {
      this._shakeOffset.set(0, 0, 0);
    }

    // Combine cinematic pan + shake into final cameraPivot offset
    this.cameraPivot.position.set(
      this._cinematicOffset.x + this._shakeOffset.x,
      this._cinematicOffset.y + this._shakeOffset.y,
      this._cinematicOffset.z + this._shakeOffset.z,
    );
  }

  // ── Cinematic focus ───────────────────────────────────────────────────────

  /** Pan the camera toward a world position and hold there. */
  public startCinematicFocus(worldTarget: THREE.Vector3): void {
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
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    stats?.onHealthChanged.remove(this._onHealthChanged);
    this._vignetteEl?.remove();
    this._vignetteEl = null;
    super.doEndPlay();
  }
}
