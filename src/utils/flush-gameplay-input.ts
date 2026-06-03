import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { MobileCombatActor } from '../actors/MobileCombatActor.js';
import { SpinningWeaponActor } from '../actors/SpinningWeaponActor.js';
import { IsometricMovementComponent } from '../components/movement/IsometricMovementComponent.js';
import { resetMobileAim } from './mobile-aim.js';

/** Engine PlayerController keeps sticky key state; fields are private in typings only. */
interface PlayerControllerStickyState {
  forward: number;
  backward: number;
  left: number;
  right: number;
  zoom: number;
  mouseLookUp: number;
  mouseLookRight: number;
  gamepadLookUp: number;
  gamepadLookRight: number;
  joystickLookUp: number;
  joystickLookRight: number;
  jumpPressedThisFrame: boolean;
  jumpReleasedThisFrame: boolean;
}

type StickyInputManager = {
  keys: Set<string>;
  mouseButtons: Set<number>;
};

let _blurHookInstalled = false;

function findPlayerController(world: ENGINE.World): ENGINE.PlayerController | null {
  for (const actor of world.getActors()) {
    if (actor instanceof ENGINE.PlayerController) {
      return actor;
    }
  }
  return null;
}

function resetPlayerController(controller: ENGINE.PlayerController): void {
  const c = controller as unknown as PlayerControllerStickyState;
  c.forward = 0;
  c.backward = 0;
  c.left = 0;
  c.right = 0;
  c.zoom = 0;
  c.mouseLookUp = 0;
  c.mouseLookRight = 0;
  c.gamepadLookUp = 0;
  c.gamepadLookRight = 0;
  c.joystickLookUp = 0;
  c.joystickLookRight = 0;
  c.jumpPressedThisFrame = false;
  c.jumpReleasedThisFrame = false;
}

function clearInputManagerStickyState(world: ENGINE.World): void {
  try {
    const im = world.inputManager as unknown as StickyInputManager;
    im.keys?.clear();
    im.mouseButtons?.clear();
  } catch {
    /* world may be tearing down */
  }
}

/**
 * Drop held mouse / keyboard / stick state so it cannot carry over across pause,
 * fail screens, map UI, or mission intros (InputManager ignores keyup while disabled).
 */
export function flushGameplayInput(world: ENGINE.World): void {
  SpinningWeaponActor.findInWorld(world)?.releaseCombatInput();

  for (const actor of world.getActors()) {
    if (actor instanceof MobileCombatActor) {
      actor.resetCombatInput();
    }
  }

  resetMobileAim();

  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    const mc = pawn.getComponents(IsometricMovementComponent)[0];
    mc?.resetRuntimeMotion();
  }

  const controller = findPlayerController(world);
  if (controller) {
    resetPlayerController(controller);
  }

  clearInputManagerStickyState(world);
}

/** Safety net when the tab loses focus while keys or mouse buttons are held. */
export function ensureGameplayInputFlushOnBlur(world: ENGINE.World): void {
  if (_blurHookInstalled || typeof window === 'undefined') {
    return;
  }
  _blurHookInstalled = true;

  const flush = (): void => {
    flushGameplayInput(world);
  };

  window.addEventListener('blur', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  });
}
