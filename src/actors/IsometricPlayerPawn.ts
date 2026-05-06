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

/**
 * True symmetric isometric tilt: elevation arctan(1/√2) ≈ 35.26° from horizontal,
 * paired with ISO_YAW = 45° (horizontal corner view). Negated = look down (Y-up).
 */
const ISO_PITCH = -Math.atan(1 / Math.sqrt(2));
const ROTATE_SPEED = 20; // rad/s – visual mesh facing

const GRIM2_MODEL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grim2/Grim2.glb` as ENGINE.ModelPath;
const GRIM2_ANIM_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grim2/Animationgrim.anim.json`;

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

  private _shakeIntensity = 0;
  private _shakeDuration = 0;
  private _shakeElapsed = 0;
  private readonly _shakeOffset = new THREE.Vector3();

  // ── Component factory overrides ───────────────────────────────────────────

  protected override setupAnimationComponent(): ENGINE.AnimationStateMachineComponent | null {
    const anim = ENGINE.AnimationStateMachineComponent.create({ configUrl: GRIM2_ANIM_URL });
    this.rootComponent.add(anim);
    return anim;
  }

  protected override setupVisualComponent(): ENGINE.SceneComponent | null {
    const meshComponent = ENGINE.GLTFMeshComponent.create({
      modelUrl: GRIM2_MODEL_URL,
      scale: new THREE.Vector3(1, 1, 1),
      rotation: new THREE.Euler(0, Math.PI, 0),
      position: new THREE.Vector3(0, this.visualGroundClearance, 0),
      physicsOptions: { enabled: false },
      castShadow: true,
    });

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
    this._updateScreenShake(deltaTime);
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
    this._shakeIntensity = intensity;
    this._shakeDuration = duration;
    this._shakeElapsed = 0;
  }

  private _updateScreenShake(deltaTime: number): void {
    if (this._shakeDuration <= 0 || !this.cameraPivot) return;

    this._shakeElapsed += deltaTime;

    if (this._shakeElapsed >= this._shakeDuration) {
      this.cameraPivot.position.set(0, 0, 0);
      this._shakeDuration = 0;
      return;
    }

    const t = this._shakeElapsed / this._shakeDuration;
    const falloff = 1 - t;
    const currentIntensity = this._shakeIntensity * falloff;

    this._shakeOffset.set(
      (Math.random() - 0.5) * 2 * currentIntensity,
      0,
      (Math.random() - 0.5) * 2 * currentIntensity
    );

    this.cameraPivot.position.copy(this._shakeOffset);
  }
}
