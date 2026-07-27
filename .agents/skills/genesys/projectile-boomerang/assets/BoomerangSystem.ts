/**
 * BoomerangSystem.ts
 *
 * Outbound + returning projectile system with multi-blade fan spread.
 * Hit detection and visuals are handled via callbacks — no game-specific imports.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// ─── Configuration (tune per project) ────────────────────────────────────────

const BOOMERANG_SPEED        = 18;   // units/sec outbound
const BOOMERANG_RETURN_SPEED = 22;   // units/sec returning (slightly faster feels better)
const BOOMERANG_RANGE        = 14;   // distance before reversal (units)
const BOOMERANG_CATCH_RADIUS = 1.5;  // dismiss when within this distance of the player
const BOOMERANG_SPIN_RATE    = 6;    // visual spin speed (rad/sec) — caller uses blade.spinAngle

// ─── Types ────────────────────────────────────────────────────────────────────

export type BladePhase = 'outbound' | 'returning';

export interface ActiveBlade {
  /** Current world position of the blade. Copy to your weapon mesh each frame. */
  pos: THREE.Vector3;
  /** Current travel direction (unit vector). Changes when transitioning to returning. */
  dir: THREE.Vector3;
  /** Which phase this blade is in. */
  phase: BladePhase;
  /** Distance traveled in outbound phase. Resets to 0 on phase change. */
  distanceTraveled: number;
  /** Accumulated spin angle (radians). Use to rotate your mesh. */
  spinAngle: number;
  /** Index in the fan spread. 0 = center, ±1 = outer blades. */
  fanIndex: number;
  /**
   * Caller-owned set of actors hit by this blade this pass.
   * Clear it inside onBladeUpdate when transitioning to 'returning' if you want
   * the return journey to damage again.
   */
  hitActors: Set<object>;
  /** Arbitrary bag for caller state (e.g. return-hit flag). */
  userData: Record<string, unknown>;
}

export interface LaunchOptions {
  /** Number of blades to launch. 1 = single, 3 = fan, etc. Default: 1. */
  bladeCount?: number;
  /**
   * Half-angle of the fan spread in radians.
   * Outer blades launch at ±spreadHalfAngle from the center direction.
   * Ignored when bladeCount is 1. Default: 0.35 rad (~20°).
   */
  spreadHalfAngle?: number;
}

export interface BoomerangCallbacks {
  /**
   * Called every frame for each active blade, after positions are updated.
   * Move your weapon mesh and check for hits here.
   */
  onBladeUpdate: (blade: ActiveBlade) => void;

  /**
   * Called once when a blade is dismissed (caught by the player or manually cancelled).
   * Hide your weapon mesh and stop trails here.
   */
  onBladeDismiss: (blade: ActiveBlade) => void;
}

// ─── Aim resolution ───────────────────────────────────────────────────────────

const _raycaster   = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _mouseHit    = new THREE.Vector3();
const _playerPos   = new THREE.Vector3();

/**
 * Resolve the mouse cursor to a flat (XZ-plane) aim unit vector.
 *
 * `groundY` should match the player's root Y so the ground plane is correct.
 * Falls back to player facing direction when the ray misses.
 *
 * `fallbackDir` is used on mobile or when the camera ray fails. Pass the player's
 * facing direction vector there.
 */
export function resolveAimDirection(
  world: ENGINE.World,
  player: ENGINE.Pawn,
  groundY: number,
  out: THREE.Vector3,
  fallbackDir?: THREE.Vector3,
): void {
  const camera = world.getActiveCamera();

  if (camera) {
    const ndcMouse = world.inputManager.getMousePosition();
    player.rootComponent.getWorldPosition(_playerPos);
    _groundPlane.constant = -groundY;
    _raycaster.setFromCamera(ndcMouse, camera);

    if (_raycaster.ray.intersectPlane(_groundPlane, _mouseHit)) {
      const dx = _mouseHit.x - _playerPos.x;
      const dz = _mouseHit.z - _playerPos.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.01) {
        out.set(dx / len, 0, dz / len);
        return;
      }
    }
  }

  if (fallbackDir) {
    out.copy(fallbackDir).setY(0).normalize();
  } else {
    out.set(0, 0, 1);
  }
}

/**
 * Rotate a direction vector around the Y axis by `yawRad` radians, write into `out`.
 */
export function rotateDirAroundY(dir: THREE.Vector3, yawRad: number, out: THREE.Vector3): void {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  out.set(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
}

// ─── BoomerangSystem ──────────────────────────────────────────────────────────

export class BoomerangSystem {
  private readonly _blades: ActiveBlade[] = [];
  private readonly _cb: BoomerangCallbacks;
  private readonly _scratchPlayer = new THREE.Vector3();
  private readonly _scratchToPlayer = new THREE.Vector3();
  private readonly _scratchDir = new THREE.Vector3();

  constructor(callbacks: BoomerangCallbacks) {
    this._cb = callbacks;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Launch one or more blades from `launchPos` in `dir`.
   *
   * `launchPos` is cloned internally — safe to reuse the vector.
   * `dir` must be a unit vector in the XZ plane (Y = 0).
   */
  public launch(
    launchPos: THREE.Vector3,
    dir: THREE.Vector3,
    options: LaunchOptions = {},
  ): void {
    const bladeCount        = options.bladeCount ?? 1;
    const spreadHalfAngle   = options.spreadHalfAngle ?? 0.35;

    const yawOffsets = this._fanYawOffsets(bladeCount, spreadHalfAngle);

    for (let i = 0; i < bladeCount; i++) {
      rotateDirAroundY(dir, yawOffsets[i]!, this._scratchDir);

      const blade: ActiveBlade = {
        pos:              launchPos.clone(),
        dir:              this._scratchDir.clone(),
        phase:            'outbound',
        distanceTraveled: 0,
        spinAngle:        0,
        fanIndex:         i - Math.floor(bladeCount / 2),
        hitActors:        new Set(),
        userData:         {},
      };

      this._blades.push(blade);
    }
  }

  /** True when at least one blade is in flight. */
  public hasActiveBlades(): boolean {
    return this._blades.length > 0;
  }

  /** Number of blades currently in flight. */
  public activeCount(): number {
    return this._blades.length;
  }

  /**
   * Advance all blades.  Call once per tickPrePhysics.
   * `playerPos` — current world position of the player (used for homing).
   */
  public tick(deltaTime: number, playerPos: THREE.Vector3): void {
    this._scratchPlayer.copy(playerPos);

    for (let i = this._blades.length - 1; i >= 0; i--) {
      const blade = this._blades[i]!;
      const dismissed = this._tickBlade(blade, deltaTime, this._scratchPlayer);
      if (dismissed) {
        this._blades.splice(i, 1);
      }
    }
  }

  /** Immediately dismiss all blades (e.g. player died). */
  public dismissAll(): void {
    for (const blade of this._blades) {
      this._cb.onBladeDismiss(blade);
    }
    this._blades.length = 0;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _tickBlade(
    blade: ActiveBlade,
    deltaTime: number,
    playerPos: THREE.Vector3,
  ): boolean {
    blade.spinAngle += BOOMERANG_SPIN_RATE * deltaTime;

    if (blade.phase === 'outbound') {
      const step = BOOMERANG_SPEED * deltaTime;
      blade.pos.addScaledVector(blade.dir, step);
      blade.distanceTraveled += step;

      if (blade.distanceTraveled >= BOOMERANG_RANGE) {
        blade.phase = 'returning';
      }
    } else {
      // Homing: re-calculate direction toward player each frame
      this._scratchToPlayer.copy(playerPos).sub(blade.pos);
      const dist = this._scratchToPlayer.length();

      if (dist < BOOMERANG_CATCH_RADIUS) {
        this._cb.onBladeDismiss(blade);
        return true; // dismissed
      }

      blade.pos.addScaledVector(
        this._scratchToPlayer.normalize(),
        BOOMERANG_RETURN_SPEED * deltaTime,
      );
    }

    this._cb.onBladeUpdate(blade);
    return false;
  }

  private _fanYawOffsets(bladeCount: number, halfAngle: number): number[] {
    if (bladeCount === 1) return [0];

    const offsets: number[] = [];
    const step = (halfAngle * 2) / (bladeCount - 1);
    for (let i = 0; i < bladeCount; i++) {
      offsets.push(-halfAngle + step * i);
    }
    return offsets;
  }
}
