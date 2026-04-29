/**
 * IsometricPlayerPawn - Vampire Survivors style pawn.
 *
 * Camera design (root never rotates → no flicker):
 *   root (y = 0 always)
 *   └─ cameraPivot  ← fixed isometric angle baked in at setup
 *      └─ springArm
 *         └─ camera
 *   └─ visualMesh (Grim.glb) ← rotation.y + gentle vertical bob; no skeletal animation
 *   └─ movementComponent (IsometricMovementComponent)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { ISO_YAW, IsometricMovementComponent } from '../components/movement/IsometricMovementComponent.js';

/**
 * True symmetric isometric tilt: elevation arctan(1/√2) ≈ 35.26° from horizontal,
 * paired with ISO_YAW = 45° (horizontal corner view). Negated = look down (Y-up).
 */
const ISO_PITCH = -Math.atan(1 / Math.sqrt(2));
const ROTATE_SPEED  = 20;                             // rad/s – visual mesh facing

const GRIM_MODEL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grim.glb` as ENGINE.ModelPath;

/** Same scale as editor Grim in `default.genesys-scene` actor `62` (no extra size multiplier). */
const GRIM_VISUAL_SCALE = new THREE.Vector3(1.384186, 1.398043, 1);

/** Editor-placed Grim prop to remove at runtime (same mesh + scale now lives on the pawn). */
const SCENE_PLACEHOLDER_GRIM_ACTOR_UUID = '8c22bf6ad6ba2932';

/** Eye point lights — local space under the Grim mesh (from scene actor `62`). */
const GRIM_EYE_COLOR = new THREE.Color(0.234551, 0.665387, 0.03434);
const GRIM_EYE_INTENSITY = 2.5;
const GRIM_EYE_LEFT_POS = new THREE.Vector3(-0.087567, 0.570423, 0.437998);
const GRIM_EYE_RIGHT_POS = new THREE.Vector3(0.062339, 0.570423, 0.437998);
const GRIM_EYE_LIGHT_SCALE = new THREE.Vector3(1, 1, 0.184712);

/** World units – peak vertical offset for idle float (sine amplitude). */
const FLOAT_BOB_AMPLITUDE = 0.07;
/** Bob angular speed (rad/s). */
const FLOAT_BOB_SPEED = 2.2;

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
  public cameraDistance: number = 35 * 1.15;

  /**
   * Direct local Y of the Grim mesh relative to the capsule root.
   * 0.292 = editor-tuned value where the mesh sits cleanly above the ground.
   * Does not affect physics/capsule.
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

  /** Direct local Y of the visual root before the float bob offset is applied. */
  private getVisualMeshBaseLocalY(): number {
    return this.visualGroundClearance;
  }

  // ── Internal state ────────────────────────────────────────────────────────

  private _facingYaw: number = Math.PI; // start facing engine forward (-Z)

  private _floatPhase: number = 0;

  private _sceneGrimPlaceholderRemoved: boolean = false;

  // ── Screen shake state ──────────────────────────────────────────────────

  private _shakeIntensity = 0;
  private _shakeDuration = 0;
  private _shakeElapsed = 0;
  private readonly _shakeOffset = new THREE.Vector3();
  private readonly _basePivotPosition = new THREE.Vector3();

  // ── Component factory overrides ───────────────────────────────────────────

  /** Grim has no rigged locomotion clips — skip the mannequin state machine. */
  protected override setupAnimationComponent(): ENGINE.AnimationStateMachineComponent | null {
    return null;
  }

  /**
   * Grim mesh at the same scale as the editor-placed reference in `default.genesys-scene`,
   * plus matching eye point lights as child components.
   */
  protected override setupVisualComponent(): ENGINE.SceneComponent | null {
    const meshComponent = ENGINE.GLTFMeshComponent.create({
      modelUrl: GRIM_MODEL_URL,
      scale: GRIM_VISUAL_SCALE.clone(),
      rotation: new THREE.Euler(0, Math.PI, 0),
      position: new THREE.Vector3(0, this.getVisualMeshBaseLocalY(), 0),
      physicsOptions: { enabled: false },
      castShadow: true,
    });

    const eyeOpts = {
      color: GRIM_EYE_COLOR,
      intensity: GRIM_EYE_INTENSITY,
      scale: GRIM_EYE_LIGHT_SCALE.clone(),
      castShadow: false,
      bakeLightmaps: false,
    } as const;

    const eyeLeft = ENGINE.PointLightComponent.create({
      ...eyeOpts,
      position: GRIM_EYE_LEFT_POS.clone(),
    });
    const eyeRight = ENGINE.PointLightComponent.create({
      ...eyeOpts,
      position: GRIM_EYE_RIGHT_POS.clone(),
    });
    meshComponent.add(eyeLeft);
    meshComponent.add(eyeRight);

    this.rootComponent.add(meshComponent);
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

  /** Jumping disabled for VS-style. */
  public override handleJump(_strength: number = 1): void { /* intentionally empty */ }

  /** Fixed camera distance — no mouse-wheel zoom (see {@link cameraDistance}). */
  public override handleMouseWheel(_e: WheelEvent): boolean {
    return false;
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    // Keep spring arm in sync when cameraDistance is changed in the editor.
    if (this.springArm && this.springArm.armLength !== this.cameraDistance) {
      this.springArm.armLength = this.cameraDistance;
    }

    this._removeSceneGrimPlaceholderOnce();

    super.tickPrePhysics(deltaTime); // handles animation parameters
    this._updateVisualFacing(deltaTime);
    this._updateFloatingBob(deltaTime);
    this._updateScreenShake(deltaTime);
  }

  // ── Visual facing ─────────────────────────────────────────────────────────

  private _updateVisualFacing(deltaTime: number): void {
    if (!this.visualComponent) return;
    const mc = this.movementComponent;
    if (!(mc instanceof IsometricMovementComponent)) return;

    const vel = mc.getWorldVelocity();
    if (vel.lengthSq() < 0.01) return; // idle – keep last facing direction

    const targetYaw = Math.atan2(vel.x, vel.z);

    // Shortest-arc smooth interpolation.
    let diff = targetYaw - this._facingYaw;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    this._facingYaw += Math.sign(diff) * Math.min(Math.abs(diff), ROTATE_SPEED * deltaTime);

    this.visualComponent.rotation.y = this._facingYaw;
  }

  /** Drop the level-authoring Grim instance so only the pawn copy exists at runtime. */
  private _removeSceneGrimPlaceholderOnce(): void {
    if (this._sceneGrimPlaceholderRemoved) return;
    const world = this.getWorld();
    if (!world) return;
    for (const actor of world.getActors()) {
      if (actor.uuid === SCENE_PLACEHOLDER_GRIM_ACTOR_UUID) {
        actor.destroy();
        this._sceneGrimPlaceholderRemoved = true;
        return;
      }
    }
  }

  private _updateFloatingBob(deltaTime: number): void {
    const vis = this.visualComponent;
    if (!vis) return;
    this._floatPhase += deltaTime * FLOAT_BOB_SPEED;
    const baseY = this.getVisualMeshBaseLocalY();
    vis.position.y = baseY + Math.sin(this._floatPhase) * FLOAT_BOB_AMPLITUDE;
  }

  // ── Animation parameters ─────────────────────────────────────────────────

  protected override getAnimationParameters(): Record<string, unknown> {
    const mc = this.movementComponent;
    if (!(mc instanceof IsometricMovementComponent)) return {};

    const moving = mc.getWorldVelocity().length() > 0.1;
    return {
      isRunning : moving,
      isJumping : false,
      forward   : moving ? 1 : 0,
      back      : 0,
      right     : 0,
      left      : 0,
    };
  }

  // ── Screen shake ─────────────────────────────────────────────────────────

  /**
   * Trigger a brief camera shake effect.
   * @param intensity - Maximum shake offset in world units
   * @param duration - Shake duration in seconds
   */
  public triggerScreenShake(intensity: number, duration: number): void {
    this._shakeIntensity = intensity;
    this._shakeDuration = duration;
    this._shakeElapsed = 0;
  }

  private _updateScreenShake(deltaTime: number): void {
    if (this._shakeDuration <= 0 || !this.cameraPivot) return;

    this._shakeElapsed += deltaTime;

    if (this._shakeElapsed >= this._shakeDuration) {
      // Shake finished - reset camera pivot position
      this.cameraPivot.position.set(0, 0, 0);
      this._shakeDuration = 0;
      return;
    }

    // Calculate falloff (1 at start, 0 at end)
    const t = this._shakeElapsed / this._shakeDuration;
    const falloff = 1 - t;
    const currentIntensity = this._shakeIntensity * falloff;

    // Random offset on X and Z only (don't shake Y as it looks weird in isometric)
    this._shakeOffset.set(
      (Math.random() - 0.5) * 2 * currentIntensity,
      0,
      (Math.random() - 0.5) * 2 * currentIntensity
    );

    this.cameraPivot.position.copy(this._shakeOffset);
  }
}
