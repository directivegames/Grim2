/**
 * Synthetic mouse NDC for mobile aim (right stick / touch aim zone).
 */
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

const AIM_DEADZONE = 0.12;
const AIM_NDC_RADIUS = 0.42;

let aimX = 0;
let aimY = 0;
let aimActive = false;

export function resetMobileAim(): void {
  aimX = 0;
  aimY = 0;
  aimActive = false;
}

export function isMobileAimActive(): boolean {
  return aimActive && Math.hypot(aimX, aimY) > AIM_DEADZONE;
}

export function getMobileAimVector(): { x: number; y: number } {
  return { x: aimX, y: aimY };
}

/**
 * Map stick offset (-1..1) to screen NDC and push into InputManager.mousePosition.
 */
export function applyMobileAimFromStick(
  world: ENGINE.World,
  stickX: number,
  stickY: number,
  active: boolean,
): void {
  aimX = stickX;
  aimY = stickY;
  aimActive = active;

  if (!active || Math.hypot(stickX, stickY) <= AIM_DEADZONE) {
    return;
  }

  const len = Math.hypot(stickX, stickY);
  const nx = (stickX / len) * AIM_NDC_RADIUS;
  const ny = (-stickY / len) * AIM_NDC_RADIUS;
  const mouse = (world.inputManager as unknown as { mousePosition: THREE.Vector2 }).mousePosition;
  mouse.set(
    THREE.MathUtils.clamp(nx, -1, 1),
    THREE.MathUtils.clamp(ny, -1, 1),
  );
}
