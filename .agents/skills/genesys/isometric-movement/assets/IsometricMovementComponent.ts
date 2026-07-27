/**
 * IsometricMovementComponent — Vampire Survivors style movement.
 *
 * Only the properties you need are shown in the editor:
 *   maxSpeed, accelerationLambda, decelerationLambda, speedModifier
 *
 * Internals:
 *  - Movement applied along fixed world-space isometric axes.
 *  - Root component NEVER rotates (the pawn rotates the visual mesh instead).
 *  - Diagonal input is normalised – W+D = same speed as W alone.
 *  - Jumping is disabled.
 *
 * Adaptation required:
 *  - Set `inputLocked = true` whenever the player should not move (pause, cutscene, UI modal).
 *  - Root component must be KinematicVelocityBased for character controller collision.
 *  - ISO_YAW (45°) can be changed for different iso angles; update the camera pivot to match.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Yaw (radians) of the isometric camera – defines the movement axes. */
export const ISO_YAW = Math.PI / 4; // 45°

const SIN_YAW = Math.sin(ISO_YAW);
const COS_YAW = Math.cos(ISO_YAW);

/** Pre-computed world-space forward axis for the iso view (W key). */
export const ISO_FORWARD_AXIS = Object.freeze(
  new THREE.Vector3(-SIN_YAW, 0, -COS_YAW).normalize()
);

/** Pre-computed world-space right axis for the iso view (D key). */
export const ISO_RIGHT_AXIS = Object.freeze(
  new THREE.Vector3(COS_YAW, 0, -SIN_YAW).normalize()
);

@ENGINE.GameClass()
export class IsometricMovementComponent extends ENGINE.CharacterMovementComponent {

  // ── Hide inherited properties irrelevant to VS-style movement ────────────
  /** @internal */ @ENGINE.property({ hidden: true }) declare public lookRightSpeed: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public lookUpSpeed: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public jumpSpeed: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public maxMidAirJumps: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public midAirAccelerationLambda: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public midAirDecelerationLambda: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public jumpStrengthModifier: number;
  /** @internal */ @ENGINE.property({ hidden: true }) declare public characterControllerOptions: ENGINE.CharacterControllerOptions | null;

  // ── Internal state ────────────────────────────────────────────────────────

  private _worldVelocity = new THREE.Vector3();
  /** Deferred world position applied on the next character-controller step. */
  private teleportPosition: THREE.Vector3 | null = null;
  private readonly _deltaScratch = new THREE.Vector3();
  private static readonly _worldPosScratch = new THREE.Vector3();
  private lastMotionTypeLogTime = 0;

  /**
   * Set to true to zero all inputs while keeping the character controller alive.
   * Use for pause screens, cutscenes, and UI modals.
   * Gravity and queued teleports still resolve when locked.
   */
  public inputLocked = false;

  /** Current world-space planar velocity — read by the pawn for visual rotation. */
  public getWorldVelocity(): THREE.Vector3 {
    return this._worldVelocity;
  }

  /** World Y rotation from current input or velocity; null if no heading. */
  public getMovementHeadingYaw(): number | null {
    const fwd = this.forwardInput.value;
    const right = this.rightInput.value;
    const lenSq = fwd * fwd + right * right;
    if (lenSq > 0.0001) {
      const inv = 1 / Math.sqrt(lenSq);
      const dirX = ISO_FORWARD_AXIS.x * fwd * inv + ISO_RIGHT_AXIS.x * right * inv;
      const dirZ = ISO_FORWARD_AXIS.z * fwd * inv + ISO_RIGHT_AXIS.z * right * inv;
      return Math.atan2(dirX, dirZ);
    }
    if (this._worldVelocity.lengthSq() > 0.01) {
      return Math.atan2(this._worldVelocity.x, this._worldVelocity.z);
    }
    return null;
  }

  /** Mobile virtual stick → planar movement input. Values in range -1..+1. */
  public setMobileStickInput(forward: number, right: number): void {
    this.forwardInput.value = forward;
    this.rightInput.value = right;
  }

  /** Clear cached input and velocity. Call before teleporting or respawning. */
  public resetRuntimeMotion(): void {
    this.forwardInput.value = 0;
    this.rightInput.value = 0;
    this.lookUpInput.value = 0;
    this.lookRightInput.value = 0;
    this.zoomInput.value = 0;
    this.forwardVelocity = 0;
    this.rightVelocity = 0;
    this.verticalVelocity = 0;
    this.teleportPosition = null;
    this._worldVelocity.set(0, 0, 0);
  }

  // Jumping disabled.
  public override jump(_strength: number = 1): void { /* no-op */ }
  public override stopJump(): void { /* no-op */ }
  // Movement runs in tickPostPhysics; suppress parent's tickPrePhysics path.
  protected override performMovementStep(_deltaTime: number): void { /* no-op */ }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public override tickPostPhysics(deltaTime: number): void {
    const owner = this.getActor()!;
    const root  = owner.rootComponent;

    if (owner.isSimulatedProxy()) {
      this._trackNetTransform(owner, root);
      return;
    }

    if (this.inputLocked) {
      // Zero inputs but keep the character controller alive so gravity and
      // queued teleports (setPawnWorldTransform) still resolve each frame.
      this.forwardInput.value = 0;
      this.rightInput.value = 0;
      this.lookUpInput.value = 0;
      this.lookRightInput.value = 0;
      this.zoomInput.value = 0;
      this.forwardVelocity = 0;
      this.rightVelocity = 0;
      this._worldVelocity.set(0, 0, 0);

      if (this.hasCharacterController && root instanceof ENGINE.PrimitiveComponent) {
        this._deltaScratch.set(0, 0, 0);
        this._applyControllerMovement(root, this._deltaScratch, deltaTime);
      }

      this._trackNetTransform(owner, root);
      return;
    }

    const maxSpeed = this.maxSpeed * this.speedModifier;

    // Normalise diagonal input so W+D is the same speed as W.
    const rawFwd   = this.forwardInput.value;
    const rawRight = this.rightInput.value;
    const len      = Math.sqrt(rawFwd * rawFwd + rawRight * rawRight);
    const s        = len > 1 ? 1 / len : 1;

    this.forwardVelocity = this.updateVelocity({
      input: { value: rawFwd * s, isAbsolute: false },
      maxSpeed,
      currentSpeed: this.forwardVelocity,
      accelerationLambda: this.accelerationLambda,
      decelerationLambda: this.decelerationLambda,
      deltaTime,
    });
    this.rightVelocity = this.updateVelocity({
      input: { value: rawRight * s, isAbsolute: false },
      maxSpeed,
      currentSpeed: this.rightVelocity,
      accelerationLambda: this.accelerationLambda,
      decelerationLambda: this.decelerationLambda,
      deltaTime,
    });

    this._deltaScratch
      .set(0, 0, 0)
      .addScaledVector(ISO_FORWARD_AXIS, this.forwardVelocity * deltaTime)
      .addScaledVector(ISO_RIGHT_AXIS, this.rightVelocity * deltaTime);

    this._worldVelocity.set(0, 0, 0)
      .addScaledVector(ISO_FORWARD_AXIS, this.forwardVelocity)
      .addScaledVector(ISO_RIGHT_AXIS, this.rightVelocity);

    if (this.hasCharacterController && root instanceof ENGINE.PrimitiveComponent) {
      this._applyControllerMovement(root, this._deltaScratch, deltaTime);
    } else {
      this._deltaScratch.y = 0;
      root.addWorldPosition(this._deltaScratch);
    }

    this._trackNetTransform(owner, root);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _applyControllerMovement(
    root: ENGINE.PrimitiveComponent,
    delta: THREE.Vector3,
    dt: number,
  ): void {
    if (root.getMotionType() !== ENGINE.PhysicsMotionType.KinematicVelocityBased) {
      const now = Date.now();
      if (now - this.lastMotionTypeLogTime >= 10_000) {
        console.error(`${this.getPathName()}: root must be KinematicVelocityBased.`);
        this.lastMotionTypeLogTime = now;
      }
    }

    const physics = this.getPhysicsEngine()!;
    this.verticalVelocity += physics.getOptions()!.gravity.y * dt
      * this.characterControllerOptions!.simulatedGravityScale;
    delta.y += this.verticalVelocity * dt;

    root.setPhysicsTransformUpdateFlags({
      sendPosition: false, sendRotation: false,
      receivePosition: true, receiveRotation: false,
    });

    if (this.teleportPosition) {
      root.getWorldPosition(IsometricMovementComponent._worldPosScratch);
      delta.copy(this.teleportPosition).sub(IsometricMovementComponent._worldPosScratch);
    }

    const { isGrounded } = physics.computeCharacterMovement(
      this, root, delta.toArray(), !!this.teleportPosition, dt,
    );
    this.teleportPosition = null;

    this.isGrounded = isGrounded;
    if (this.isGrounded) {
      this.lastGroundedTime = performance.now();
      this.jumpsUsed = 0;
    }

    this.jumpFrames += 1;
    if (this.isGrounded && this.jumpFrames >= 10) {
      this.verticalVelocity = 0;
    }
  }

  private _trackNetTransform(owner: ENGINE.Actor, root: ENGINE.SceneComponent): void {
    const predictor = (owner as any).movementPredictor;
    if (predictor && !owner.isSimulatedProxy()) {
      predictor.addLocalTransform({
        timestamp: performance.now(),
        position: root.position,
        rotation: root.quaternion,
        scale: root.scale,
      });
    }
  }
}
