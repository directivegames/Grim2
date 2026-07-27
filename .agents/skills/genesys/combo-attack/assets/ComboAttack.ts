/**
 * ComboAttack.ts
 *
 * Three-hit melee combo state machine with mouse-aimed arc and input buffering.
 * Hit detection, weapon visuals, and audio are handled via callbacks — this file
 * has no game-specific dependencies.
 *
 * State flow:  idle → windup → swing → recovery → idle (loops combo index 0→1→2→0)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Duration of each combo swing arc in seconds. Index matches combo index 0/1/2. */
const ATTACK_DURATIONS = [0.20, 0.18, 0.28] as const;

/** Brief anticipation pause before the swing begins (seconds). */
const WIND_UP_DURATION = 0.04;

/** Short gap between combo hits — lets each beat read as separate (seconds). */
const RECOVERY_DURATION = 0.05;

/** Arc swept by each combo hit. Override these to change feel. */
const ARC_HALF_SWEEP = Math.PI / 2; // 90° each side = 180° total

// ─── Types ────────────────────────────────────────────────────────────────────

type ComboPhase = 'idle' | 'windup' | 'swing' | 'recovery';
type ComboIndex = 0 | 1 | 2;

export interface ComboCallbacks {
  /**
   * Called once when wind-up begins.
   * `startAngle` is the orbit angle where the blade will appear.
   */
  onWindupStart?: (comboIndex: ComboIndex, startAngle: number) => void;

  /**
   * Called once when the blade begins moving.
   * `startAngle` and `endAngle` define the full arc in orbit space (radians).
   */
  onSwingStart?: (comboIndex: ComboIndex, startAngle: number, endAngle: number) => void;

  /**
   * Called every frame during the swing.
   * `orbitAngle` is the current blade position.
   * `progress` is 0→1 (eased, not linear).
   * Use this to move the weapon mesh and check for hits.
   */
  onSwingProgress?: (comboIndex: ComboIndex, orbitAngle: number, progress: number) => void;

  /**
   * Called once when the blade finishes its arc.
   * Hide the weapon mesh and stop trails here.
   */
  onSwingEnd?: (comboIndex: ComboIndex) => void;
}

// ─── Easing ───────────────────────────────────────────────────────────────────

/**
 * Heavy-start easing: slow wind-up into the arc, fast through the mid-section,
 * ease out at the end. Produces the impactful "whoosh" feel of action game hits.
 */
function heavySwingProgress(t: number): number {
  // Slow start (0→0.25 range), fast middle, slow finish
  if (t < 0.25) {
    return 2 * t * t;
  }
  if (t < 0.75) {
    return -0.125 + 2.5 * t - t * t;
  }
  const u = 1 - t;
  return 1 - 2 * u * u;
}

// ─── Mouse aim ────────────────────────────────────────────────────────────────

const _raycaster   = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _mouseHit    = new THREE.Vector3();
const _playerPos   = new THREE.Vector3();

/**
 * Resolve mouse cursor to a world-space yaw angle (radians) from the player.
 *
 * Returns the angle from +Z toward the cursor intersection on the ground plane.
 * Falls back to `fallbackYaw` (player facing) when the ray misses.
 *
 * `groundY` should be the Y of the player's root position so the ground plane
 * is at the right height.
 */
export function resolveAimAngle(
  world: ENGINE.World,
  player: ENGINE.Pawn,
  groundY: number,
  fallbackYaw = 0,
): number {
  const camera = world.getActiveCamera();
  if (!camera) {
    return fallbackYaw;
  }

  const ndcMouse = world.inputManager.getMousePosition();
  player.rootComponent.getWorldPosition(_playerPos);
  _groundPlane.constant = -groundY;
  _raycaster.setFromCamera(ndcMouse, camera);

  if (_raycaster.ray.intersectPlane(_groundPlane, _mouseHit)) {
    const dx = _mouseHit.x - _playerPos.x;
    const dz = _mouseHit.z - _playerPos.z;
    if (dx * dx + dz * dz > 0.0001) {
      return Math.atan2(dx, dz);
    }
  }

  return fallbackYaw;
}

// ─── ComboAttack ──────────────────────────────────────────────────────────────

export class ComboAttack {
  private _phase: ComboPhase = 'idle';
  private _comboIndex: ComboIndex = 0;

  private _attackStartAngle = 0;
  private _attackEndAngle   = 0;
  private _orbitAngle       = 0;

  private _windupElapsed   = 0;
  private _swingElapsed    = 0;
  private _recoveryLeft    = 0;

  private _queuedMelee  = false;
  private _lmbHeld      = false;

  private readonly _cb: ComboCallbacks;

  constructor(callbacks: ComboCallbacks) {
    this._cb = callbacks;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Call on LMB down. */
  public onMouseDown(): void {
    this._lmbHeld = true;
    this._tryStartOrQueue();
  }

  /** Call on LMB up. */
  public onMouseUp(): void {
    this._lmbHeld = false;
  }

  /**
   * Call once per tickPrePhysics.
   *
   * `aimAngle` — yaw from +Z toward the attack aim point (e.g. mouse cursor).
   *   Use `resolveAimAngle()` for mouse, or pass the player's facing yaw.
   */
  public tick(deltaTime: number, aimAngle: number): void {
    switch (this._phase) {
      case 'idle':
        this._tryChain();
        break;

      case 'windup':
        this._windupElapsed += deltaTime;
        this._cb.onWindupStart?.(this._comboIndex, this._attackStartAngle);
        if (this._windupElapsed >= WIND_UP_DURATION) {
          this._beginSwing();
        }
        break;

      case 'swing': {
        this._swingElapsed += deltaTime;
        const duration = ATTACK_DURATIONS[this._comboIndex];
        const rawT = Math.min(this._swingElapsed / duration, 1);
        const progress = heavySwingProgress(rawT);

        this._orbitAngle =
          this._attackStartAngle +
          (this._attackEndAngle - this._attackStartAngle) * progress;

        this._cb.onSwingProgress?.(this._comboIndex, this._orbitAngle, progress);

        if (rawT >= 1) {
          this._finishSwing(aimAngle);
        }
        break;
      }

      case 'recovery':
        this._recoveryLeft -= deltaTime;
        if (this._recoveryLeft <= 0) {
          this._phase = 'idle';
          this._tryChain();
        }
        break;
    }
  }

  /** Clear all buffered input and reset to idle. Call on pause, death, or map exit. */
  public releaseCombatInput(): void {
    if (this._phase !== 'idle') {
      this._cb.onSwingEnd?.(this._comboIndex);
    }
    this._lmbHeld = false;
    this._queuedMelee = false;
    this._phase = 'idle';
    this._windupElapsed = 0;
    this._swingElapsed = 0;
    this._recoveryLeft = 0;
  }

  public isIdle(): boolean {
    return this._phase === 'idle';
  }

  public isBusy(): boolean {
    return this._phase !== 'idle';
  }

  public getComboIndex(): ComboIndex {
    return this._comboIndex;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _tryStartOrQueue(): void {
    if (this._phase !== 'idle') {
      this._queuedMelee = true;
      return;
    }
    this._startAttack();
  }

  private _tryChain(): void {
    if (!this._queuedMelee && !this._lmbHeld) {
      return;
    }
    this._queuedMelee = false;
    this._startAttack();
  }

  private _startAttack(): void {
    // At construction time we don't yet have the aim angle — the caller passes it
    // via tick(). Store a placeholder; _setArcAngles is called at swing start.
    this._phase = 'windup';
    this._windupElapsed = 0;
    this._queuedMelee = false;
  }

  /**
   * Set orbital arc angles based on aimAngle and current combo index.
   *
   * Orbit space: angle 0 = +X axis. cos(angle)→X, sin(angle)→Z.
   * aimAngle is from +Z axis (atan2(dx, dz)), so we convert:
   *   orbitCenter = π/2 - aimAngle
   *
   * Combo arcs:
   *   0 — 180° right to left  (orbitCenter + 90° → orbitCenter - 90°)
   *   1 — 180° left to right  (orbitCenter - 90° → orbitCenter + 90°)
   *   2 — Full 360° from current position
   */
  private _setArcAngles(aimAngle: number): void {
    const center = Math.PI / 2 - aimAngle;

    switch (this._comboIndex) {
      case 0:
        this._attackStartAngle = center + ARC_HALF_SWEEP;
        this._attackEndAngle   = center - ARC_HALF_SWEEP;
        break;
      case 1:
        this._attackStartAngle = center - ARC_HALF_SWEEP;
        this._attackEndAngle   = center + ARC_HALF_SWEEP;
        break;
      case 2:
        this._attackStartAngle = this._orbitAngle;
        this._attackEndAngle   = this._orbitAngle + Math.PI * 2;
        break;
    }

    this._orbitAngle = this._attackStartAngle;
  }

  private _beginSwing(): void {
    // Arc angles are frozen at swing start so the blade follows the initial aim.
    // We don't have aimAngle here — tick() passes it; use the stored one.
    // Callers must ensure tick() is called with the current aimAngle each frame.
    this._phase = 'swing';
    this._swingElapsed = 0;
    this._cb.onSwingStart?.(this._comboIndex, this._attackStartAngle, this._attackEndAngle);
  }

  private _finishSwing(aimAngle: number): void {
    this._cb.onSwingEnd?.(this._comboIndex);
    this._comboIndex = ((this._comboIndex + 1) % 3) as ComboIndex;
    this._phase = 'recovery';
    this._recoveryLeft = RECOVERY_DURATION;
    // Pre-compute angles for the next potential combo hit
    this._setArcAngles(aimAngle);
  }
}

// ─── Usage note ───────────────────────────────────────────────────────────────
//
// Override ATTACK_DURATIONS, WIND_UP_DURATION, RECOVERY_DURATION, ARC_HALF_SWEEP
// at the top of this file to tune feel for your game.
//
// For orbital weapon positioning from the orbit angle:
//   pos.x = playerPos.x + Math.cos(orbitAngle) * HANDLE_OFFSET
//   pos.z = playerPos.z + Math.sin(orbitAngle) * HANDLE_OFFSET
//
// See references/arc-math.md for the full coordinate system explanation.
