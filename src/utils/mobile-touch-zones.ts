/**
 * Tag engine nipple joystick zones and align them with Grim mobile HUD layout.
 */
import { isMobileDevice } from './mobile-device.js';
import {
  MOBILE_LEFT_STICK_BOTTOM,
  MOBILE_LEFT_STICK_LEFT,
  MOBILE_LEFT_STICK_SIZE,
  MOBILE_RIGHT_STICK_BOTTOM,
  MOBILE_RIGHT_STICK_RIGHT,
  MOBILE_RIGHT_STICK_SIZE,
} from '../ui/mobile-hud-layout.js';

const LEFT_CLASS = 'grim-mobile-joystick-left';
const RIGHT_CLASS = 'grim-mobile-joystick-right';

export type JoystickZoneRefs = {
  left: HTMLElement | null;
  right: HTMLElement | null;
};

/** Find engine-created joystick zones (absolute divs at default 20px corners). */
export function findEngineJoystickZones(host: HTMLElement): JoystickZoneRefs {
  let left: HTMLElement | null = null;
  let right: HTMLElement | null = null;

  for (const el of host.children) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const s = el.style;
    if (s.position !== 'absolute' || !s.bottom || !s.width) {
      continue;
    }
    if (s.left === '20px' && s.bottom === '20px') {
      left = el;
    } else if (s.right === '20px' && s.bottom === '20px') {
      right = el;
    }
  }

  if (!left) {
    left = host.querySelector<HTMLElement>(`.${LEFT_CLASS}`);
  }
  if (!right) {
    right = host.querySelector<HTMLElement>(`.${RIGHT_CLASS}`);
  }

  return { left, right };
}

export function alignMobileJoystickZones(host: HTMLElement): JoystickZoneRefs {
  if (!isMobileDevice()) {
    return { left: null, right: null };
  }

  const refs = findEngineJoystickZones(host);
  if (refs.left) {
    refs.left.classList.add(LEFT_CLASS);
    refs.left.style.left = MOBILE_LEFT_STICK_LEFT;
    refs.left.style.right = 'auto';
    refs.left.style.bottom = MOBILE_LEFT_STICK_BOTTOM;
    refs.left.style.width = MOBILE_LEFT_STICK_SIZE;
    refs.left.style.height = MOBILE_LEFT_STICK_SIZE;
    refs.left.style.zIndex = '12';
  }
  if (refs.right) {
    // Right stick is disabled — hide the engine zone so it doesn't capture taps
    // intended for skill buttons occupying the bottom-right corner.
    refs.right.classList.add(RIGHT_CLASS);
    refs.right.style.display = 'none';
  }
  return refs;
}

/** Retry alignment until engine touch zones appear (async nipple init). */
export function scheduleMobileJoystickAlignment(
  host: HTMLElement,
  maxAttempts = 24,
  intervalMs = 250,
): () => void {
  if (!isMobileDevice()) {
    return () => { /* no-op */ };
  }

  let attempts = 0;
  let timer = 0;
  const tick = (): void => {
    const refs = alignMobileJoystickZones(host);
    attempts++;
    if ((refs.left && refs.right) || attempts >= maxAttempts) {
      if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }
    }
  };

  tick();
  timer = window.setInterval(tick, intervalMs);
  return () => {
    if (timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  };
}
