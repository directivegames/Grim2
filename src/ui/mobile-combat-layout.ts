/**
 * Mobile combat chrome — pause / throw buttons and touch fallback zones.
 */
import * as THREE from 'three';

import { isMobileDevice } from '../utils/mobile-device.js';
import {
  MOBILE_LEFT_STICK_BOTTOM,
  MOBILE_LEFT_STICK_LEFT,
  MOBILE_LEFT_STICK_SIZE,
  MOBILE_RIGHT_STICK_BOTTOM,
  MOBILE_RIGHT_STICK_RIGHT,
  MOBILE_RIGHT_STICK_SIZE,
} from './mobile-hud-layout.js';

const STYLE_ID = 'grim-mobile-combat-styles';
const ROOT_ATTR = 'data-grim-mobile-combat';

export const MOBILE_COMBAT_ROOT_ATTR = ROOT_ATTR;

export function ensureMobileCombatStyles(host: HTMLElement): void {
  if (!isMobileDevice()) {
    return;
  }

  if (host.querySelector(`#${STYLE_ID}`)) {
    return;
  }

  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    [${ROOT_ATTR}] {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 11;
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-combat-btn {
      pointer-events: auto;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
      min-width: 48px;
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      border: 1px solid rgba(120, 180, 220, 0.55);
      background: rgba(8, 14, 22, 0.72);
      color: rgba(200, 235, 255, 0.95);
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(10px, 2.4vw, 12px);
      letter-spacing: 0.14em;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      user-select: none;
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-combat-btn:active {
      transform: scale(0.96);
      filter: brightness(1.15);
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-pause-btn {
      position: absolute;
      top: max(8px, env(safe-area-inset-top, 0px));
      left: max(10px, env(safe-area-inset-left, 0px));
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-throw-btn {
      position: absolute;
      left: calc(${MOBILE_LEFT_STICK_LEFT} + ${MOBILE_LEFT_STICK_SIZE} + clamp(8px, 2vw, 14px));
      bottom: calc(${MOBILE_LEFT_STICK_BOTTOM} + clamp(36px, 9vw, 52px));
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-touch-fallback {
      position: absolute;
      pointer-events: auto;
      touch-action: none;
      z-index: 10;
      background: transparent;
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-touch-move {
      left: ${MOBILE_LEFT_STICK_LEFT};
      bottom: ${MOBILE_LEFT_STICK_BOTTOM};
      width: ${MOBILE_LEFT_STICK_SIZE};
      height: ${MOBILE_LEFT_STICK_SIZE};
    }
    .grim-mobile [${ROOT_ATTR}] .grim-mobile-touch-aim {
      right: ${MOBILE_RIGHT_STICK_RIGHT};
      bottom: ${MOBILE_RIGHT_STICK_BOTTOM};
      width: ${MOBILE_RIGHT_STICK_SIZE};
      height: ${MOBILE_RIGHT_STICK_SIZE};
    }
    .grim-mobile .grim-mobile-joystick-left,
    .grim-mobile .grim-mobile-joystick-right {
      touch-action: none;
    }
  `;
  host.appendChild(st);
}

export type TouchStickCallback = (
  stickX: number,
  stickY: number,
  active: boolean,
) => void;

/** Bind a touch zone to normalized stick output (-1..1). */
export function bindTouchStickZone(
  zone: HTMLElement,
  onStick: TouchStickCallback,
): () => void {
  const activeTouches = new Map<number, { x: number; y: number }>();
  let centerX = 0;
  let centerY = 0;
  let radius = 48;

  const updateCenter = (): void => {
    const rect = zone.getBoundingClientRect();
    centerX = rect.left + rect.width * 0.5;
    centerY = rect.top + rect.height * 0.5;
    radius = Math.max(36, Math.min(rect.width, rect.height) * 0.42);
  };

  const emit = (x: number, y: number, active: boolean): void => {
    if (!active) {
      onStick(0, 0, false);
      return;
    }
    const nx = THREE.MathUtils.clamp((x - centerX) / radius, -1, 1);
    const ny = THREE.MathUtils.clamp((y - centerY) / radius, -1, 1);
    onStick(nx, ny, true);
  };

  const onStart = (e: TouchEvent): void => {
    updateCenter();
    for (const t of Array.from(e.changedTouches)) {
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    const first = activeTouches.values().next().value;
    if (first) {
      emit(first.x, first.y, true);
    }
    e.preventDefault();
  };

  const onMove = (e: TouchEvent): void => {
    updateCenter();
    for (const t of Array.from(e.changedTouches)) {
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
    const first = activeTouches.values().next().value;
    if (first) {
      emit(first.x, first.y, true);
    }
    e.preventDefault();
  };

  const onEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      activeTouches.delete(t.identifier);
    }
    if (activeTouches.size === 0) {
      emit(0, 0, false);
    } else {
      const first = activeTouches.values().next().value;
      if (first) {
        emit(first.x, first.y, true);
      }
    }
    e.preventDefault();
  };

  zone.addEventListener('touchstart', onStart, { passive: false });
  zone.addEventListener('touchmove', onMove, { passive: false });
  zone.addEventListener('touchend', onEnd, { passive: false });
  zone.addEventListener('touchcancel', onEnd, { passive: false });

  return () => {
    zone.removeEventListener('touchstart', onStart);
    zone.removeEventListener('touchmove', onMove);
    zone.removeEventListener('touchend', onEnd);
    zone.removeEventListener('touchcancel', onEnd);
    onStick(0, 0, false);
  };
}
