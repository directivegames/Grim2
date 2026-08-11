/**
 * MobileCombatActor — aim via right stick / touch, move via left stick / touch, auto-melee on mobile.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';

import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { SpinningWeaponActor } from './SpinningWeaponActor.js';
import {
  applyMobileAimFromStick,
  isMobileAimActive,
  resetMobileAim,
  syncMobileAimMouse,
} from '../utils/mobile-aim.js';
import {
  getNearestMobileMeleeTarget,
  hasMobileMeleeTargetInAim,
} from '../utils/mobile-melee-target.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { IsometricMovementComponent } from '../components/movement/IsometricMovementComponent.js';

const MOVE_DEADZONE = 0.14;
const AUTO_MELEE_COOLDOWN_SEC = 0.22;
/** Quick right-stick tap with aim held → soul throw (hold + drag = aim / auto-melee). */
const THROW_TAP_MAX_MS = 280;
const THROW_TAP_MIN_DEFLECTION = 0.07;

type InputHandlersList = { inputHandlers: ENGINE.IInputHandler[] };

@ENGINE.GameClass()
export class MobileCombatActor extends GameRootNode {
  private _moveX = 0;
  private _moveY = 0;
  private _moveActive = false;
  private _autoMeleeCooldown = 0;
  private _aimStartX = 0;
  private _aimStartY = 0;
  private _aimSessionStartMs = 0;
  private _aimSessionPeak = 0;
  private _aimSessionOpen = false;
  private _aimLastNx = 0;
  private _aimLastNy = 0;
  private readonly _swingAimScratch = new THREE.Vector3();

  private readonly _inputHandler: ENGINE.IInputHandler = {
    handleVirtualJoystick: (
      index: ENGINE.VirtualJoystickIndex,
      data: ENGINE.VirtualJoystickData,
    ): boolean => {
      if (!isMobileDevice() || !isGameplayUnlocked()) {
        return false;
      }

      const world = this.getWorld();
      if (!world) {
        return false;
      }

      const zone = this._zoneSize(index);
      const active = data.type !== 'end';

      if (index === ENGINE.VirtualJoystickIndex.Right) {
        // Right stick is disabled — proximity auto-attack handles attacking.
        return false;
      }

      if (index === ENGINE.VirtualJoystickIndex.Left) {
        // PlayerController uses delta-from-start; do not consume left stick here.
        return false;
      }

      return false;
    },
    handleKeyDown: () => false,
    handleKeyUp: () => false,
    handleMouseDown: () => false,
    handleMouseUp: () => false,
    handleMouseMove: () => false,
    handleMouseClick: () => false,
    setInputManager: () => { /* no-op */ },
  };

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    const world = this.getWorld();
    if (!world) {
      return false;
    }
    this._registerInputHandlerBeforePlayerController(world);
  
    return true;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    const world = this.getWorld();
    if (world) {
      world.inputManager.removeInputHandler(this._inputHandler);
    }
    resetMobileAim();
    return true;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (!isMobileDevice() || !isGameplayUnlocked()) {
      return;
    }

    const world = this.getWorld();
    if (world) {
      syncMobileAimMouse(world);
    }

    this._applyMoveInput();
    this._tickAutoMelee(deltaTime);
  }

  /** Touch fallback zones call this when engine joysticks are absent. */
  public setTouchMove(stickX: number, stickY: number, active: boolean): void {
    this._moveX = stickX;
    this._moveY = stickY;
    this._moveActive = active && Math.hypot(stickX, stickY) > MOVE_DEADZONE;
  }

  public setTouchAim(_stickX: number, _stickY: number, _active: boolean): void {
    // Right stick / aim is disabled — proximity auto-attack handles attacking.
  }

  /** Clear virtual stick state when gameplay input is flushed. */
  public resetCombatInput(): void {
    this._moveX = 0;
    this._moveY = 0;
    this._moveActive = false;
    this._autoMeleeCooldown = 0;
    resetMobileAim();

    const pawn = this.getWorld()?.getFirstPlayerPawn();
    if (pawn instanceof IsometricPlayerPawn) {
      const move = pawn.getNodes(IsometricMovementComponent)[0];
      move?.setMobileStickInput(0, 0);
    }
  }

  public static ensureExists(world: ENGINE.World): MobileCombatActor {
    const existing = world.getRootNodes().find(
      (a): a is MobileCombatActor => a instanceof MobileCombatActor,
    );
    if (existing) {
      return existing;
    }

    const actor = MobileCombatActor.create({ name: 'MobileCombat' });
    world.add(actor);
    return actor;
  }

  /** Right stick aim must run before PlayerController; left stick passes through. */
  private _registerInputHandlerBeforePlayerController(world: ENGINE.World): void {
    const im = world.inputManager;
    im.addInputHandler(this._inputHandler);
    const handlers = (im as unknown as InputHandlersList).inputHandlers;
    const idx = handlers.indexOf(this._inputHandler);
    if (idx > 0) {
      handlers.splice(idx, 1);
      handlers.unshift(this._inputHandler);
    }
    this._inputHandler.setInputManager(im);
  }

  private _beginAimSession(): void {
    this._aimSessionStartMs = performance.now();
    this._aimSessionPeak = 0;
    this._aimSessionOpen = true;
    this._aimLastNx = 0;
    this._aimLastNy = 0;
  }

  private _updateAimStick(world: ENGINE.World, nx: number, ny: number): void {
    if (!this._aimSessionOpen) {
      this._beginAimSession();
    }
    const mag = Math.hypot(nx, ny);
    if (mag > this._aimSessionPeak) {
      this._aimSessionPeak = mag;
      this._aimLastNx = nx;
      this._aimLastNy = ny;
    }
    applyMobileAimFromStick(world, nx, ny, true);
  }

  /** Short tap with stick deflected → throw; longer hold → aim/melee only. */
  private _endAimStick(world: ENGINE.World): void {
    if (this._aimSessionOpen) {
      const elapsed = performance.now() - this._aimSessionStartMs;
      const tapThrow =
        this._aimSessionPeak >= THROW_TAP_MIN_DEFLECTION &&
        elapsed <= THROW_TAP_MAX_MS;

      if (tapThrow) {
        applyMobileAimFromStick(world, this._aimLastNx, this._aimLastNy, true);
        SpinningWeaponActor.triggerSoulThrow(world);
      }
      this._aimSessionOpen = false;
    }
    applyMobileAimFromStick(world, 0, 0, false);
  }

  private _zoneSize(index: ENGINE.VirtualJoystickIndex): number {
    const sizeOpt = this.getWorld()?.inputManager.options.virtualJoystickOptions?.size;
    const size = sizeOpt ?? 120;
    return size * 0.75;
  }

  private _applyMoveInput(): void {
    const pawn = this.getWorld()?.getFirstPlayerPawn();
    if (!(pawn instanceof IsometricPlayerPawn)) {
      return;
    }

    const move = pawn.getNodes(IsometricMovementComponent)[0];
    if (!move) {
      return;
    }

    if (!this._moveActive) {
      return;
    }

    const inv = 1 / Math.max(1, Math.hypot(this._moveX, this._moveY));
    const sx = this._moveX * inv;
    const sy = this._moveY * inv;

    move.setMobileStickInput(-sy, sx);
  }

  private _tickAutoMelee(deltaTime: number): void {
    this._autoMeleeCooldown = Math.max(0, this._autoMeleeCooldown - deltaTime);

    if (this._autoMeleeCooldown > 0) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }

    // Primary: swing toward the held aim direction. Fallback: auto-attack the
    // nearest enemy in reach (so attacks land even if aim never registers active).
    const aimTarget = isMobileAimActive() && hasMobileMeleeTargetInAim(world);
    const proximityTarget = aimTarget ? null : getNearestMobileMeleeTarget(world);
    if (!aimTarget && !proximityTarget) {
      return;
    }

    const weapon = world.getRootNodes().find(
      (a): a is SpinningWeaponActor => a instanceof SpinningWeaponActor,
    );
    if (!weapon) {
      return;
    }

    // Point the swing at the enemy when relying on the proximity fallback.
    if (proximityTarget) {
      this._aimSwingAt(world, proximityTarget);
    }

    if (weapon.tryMobileAutoMelee()) {
      this._autoMeleeCooldown = AUTO_MELEE_COOLDOWN_SEC;
    }
  }

  /** Set the synthetic aim cursor toward `target` so the melee arc faces it. */
  private _aimSwingAt(world: ENGINE.World, target: ENGINE.SceneNode): void {
    const camera = world.getActiveCamera();
    if (!camera) {
      return;
    }
    target.getWorldPosition(this._swingAimScratch);
    this._swingAimScratch.project(camera);
    const mouse = (world.inputManager as unknown as { mousePosition: THREE.Vector2 }).mousePosition;
    mouse.set(
      THREE.MathUtils.clamp(this._swingAimScratch.x, -1, 1),
      THREE.MathUtils.clamp(this._swingAimScratch.y, -1, 1),
    );
  }
}
