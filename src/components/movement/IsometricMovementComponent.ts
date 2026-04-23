/**
 * IsometricMovementComponent - Vampire Survivors style movement.
 *
 * Only the properties you need are shown in the editor:
 *   maxSpeed, accelerationLambda, decelerationLambda, speedModifier
 *
 * Internals:
 *  - Movement applied along fixed world-space isometric axes.
 *  - Root component NEVER rotates (the pawn rotates the visual mesh instead).
 *  - Diagonal input is normalised – W+D = same speed as W alone.
 *  - Jumping is disabled.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Yaw (radians) of the isometric camera – defines the movement axes. */
export const ISO_YAW = Math.PI / 4; // 45°

/** World-space forward axis for the iso view (W key). */
export function isoForwardAxis(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
}

/** World-space right axis for the iso view (D key). */
export function isoRightAxis(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).normalize();
}

@ENGINE.GameClass()
export class IsometricMovementComponent extends ENGINE.CharacterMovementComponent {

  // ── Editor-visible properties ─────────────────────────────────────────────
  // maxSpeed / accelerationLambda / decelerationLambda / speedModifier are
  // inherited from CharacterMovementComponent and remain fully editable.

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

  private _worldVelocity: THREE.Vector3 = new THREE.Vector3();

  /** Current world-space planar velocity – read by the pawn for visual rotation. */
  public getWorldVelocity(): THREE.Vector3 {
    return this._worldVelocity;
  }

  // Jumping disabled.
  public override jump(_strength: number = 1): void { /* no-op */ }
  public override stopJump(): void { /* no-op */ }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public override tickPostPhysics(deltaTime: number): void {
    const owner = this.getActor()!;
    const root  = owner.rootComponent;

    if (owner.isSimulatedProxy()) {
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

    const isoFwd   = isoForwardAxis(ISO_YAW);
    const isoRight = isoRightAxis(ISO_YAW);

    const delta = new THREE.Vector3()
      .addScaledVector(isoFwd,   this.forwardVelocity * deltaTime)
      .addScaledVector(isoRight, this.rightVelocity   * deltaTime);

    // Cache velocity so the pawn can read it without re-computing.
    this._worldVelocity.set(0, 0, 0)
      .addScaledVector(isoFwd,   this.forwardVelocity)
      .addScaledVector(isoRight, this.rightVelocity);

    if (this.hasCharacterController && root instanceof ENGINE.PrimitiveComponent) {
      this._applyControllerMovement(root, delta, deltaTime);
    } else {
      delta.y = 0;
      root.addWorldPosition(delta);
    }

    // Root yaw is NEVER changed here.
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
      delta.copy(this.teleportPosition.clone().sub(root.position));
    }

    const { isGrounded } = physics.computeCharacterMovement(
      this, root, delta.toArray(), !!this.teleportPosition,
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
