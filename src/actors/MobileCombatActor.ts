/**
 * MobileCombatActor — aim via right stick / touch, move via left stick / touch, auto-melee on mobile.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { SpinningWeaponActor } from './SpinningWeaponActor.js';
import {
  applyMobileAimFromStick,
  isMobileAimActive,
  resetMobileAim,
} from '../utils/mobile-aim.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { IsometricMovementComponent } from '../components/movement/IsometricMovementComponent.js';

const MOVE_DEADZONE = 0.14;
const AUTO_MELEE_COOLDOWN_SEC = 0.42;

@ENGINE.GameClass()
export class MobileCombatActor extends ENGINE.Actor {
  private _moveX = 0;
  private _moveY = 0;
  private _moveActive = false;
  private _autoMeleeCooldown = 0;

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
      const nx = zone > 0 ? (data.position.x / zone) : 0;
      const ny = zone > 0 ? (data.position.y / zone) : 0;
      const active = data.type !== 'end';

      if (index === ENGINE.VirtualJoystickIndex.Right) {
        applyMobileAimFromStick(world, nx, ny, active);
        return true;
      }

      if (index === ENGINE.VirtualJoystickIndex.Left) {
        this._moveX = active ? nx : 0;
        this._moveY = active ? ny : 0;
        this._moveActive = active && Math.hypot(nx, ny) > MOVE_DEADZONE;
        return true;
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

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    this.getWorld()?.inputManager.addInputHandler(this._inputHandler);
  }

  protected override doEndPlay(): void {
    this.getWorld()?.inputManager.removeInputHandler(this._inputHandler);
    resetMobileAim();
    super.doEndPlay();
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (!isMobileDevice() || !isGameplayUnlocked()) {
      return;
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

  public setTouchAim(stickX: number, stickY: number, active: boolean): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    applyMobileAimFromStick(world, stickX, stickY, active);
  }

  /** Clear virtual stick state when gameplay input is flushed. */
  public resetCombatInput(): void {
    this._moveX = 0;
    this._moveY = 0;
    this._moveActive = false;
    this._autoMeleeCooldown = 0;

    const pawn = this.getWorld()?.getFirstPlayerPawn();
    if (pawn instanceof IsometricPlayerPawn) {
      const move = pawn.getComponents(IsometricMovementComponent)[0];
      move?.setMobileStickInput(0, 0);
    }
  }

  public static ensureExists(world: ENGINE.World): MobileCombatActor {
    const existing = world.getActors().find(
      (a): a is MobileCombatActor => a instanceof MobileCombatActor,
    );
    if (existing) {
      return existing;
    }

    const actor = MobileCombatActor.create({ name: 'MobileCombat' });
    world.addActor(actor);
    return actor;
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

    const move = pawn.getComponents(IsometricMovementComponent)[0];
    if (!move) {
      return;
    }

    if (!this._moveActive) {
      move.setMobileStickInput(0, 0);
      return;
    }

    const inv = 1 / Math.max(1, Math.hypot(this._moveX, this._moveY));
    const sx = this._moveX * inv;
    const sy = this._moveY * inv;

    move.setMobileStickInput(-sy, sx);
  }

  private _tickAutoMelee(deltaTime: number): void {
    this._autoMeleeCooldown = Math.max(0, this._autoMeleeCooldown - deltaTime);
    if (this._autoMeleeCooldown > 0 || !isMobileAimActive()) {
      return;
    }

    const weapon = this.getWorld()?.getActors().find(
      (a): a is SpinningWeaponActor => a instanceof SpinningWeaponActor,
    );
    if (!weapon) {
      return;
    }

    if (weapon.tryMobileAutoMelee()) {
      this._autoMeleeCooldown = AUTO_MELEE_COOLDOWN_SEC;
    }
  }
}
