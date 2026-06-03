/**
 * Mobile HUD placement — desktop layouts stay in each UI file; mobile uses scoped CSS.
 */
import { isMobileDevice } from '../utils/mobile-device.js';

const MOBILE_HUD_STYLE_ID = 'grim-mobile-hud-styles';

const TOP_SAFE = 'max(8px, env(safe-area-inset-top, 0px))';
const LEFT_SAFE = 'max(10px, env(safe-area-inset-left, 0px))';
const RIGHT_SAFE = 'max(10px, env(safe-area-inset-right, 0px))';
const BOTTOM_SAFE = 'max(16px, env(safe-area-inset-bottom, 0px))';

const MOBILE_HEALTH_HEIGHT = 'clamp(44px, 11vw, 62px)';
/** Souls frame height at mobile scale (aspect-ratio 688 / 302). */
const MOBILE_SOULS_HEIGHT = 'clamp(58px, 14vw, 88px)';
/** Single-line collateral row below the souls frame. */
const MOBILE_COLLATERAL_LINE = 'clamp(14px, 3.5vw, 18px)';
const MOBILE_STACK_GAP = '4px';

const MOBILE_COLLATERAL_TOP = `calc(${TOP_SAFE} + ${MOBILE_SOULS_HEIGHT} + ${MOBILE_STACK_GAP})`;
const MOBILE_OBJECTIVE_TOP = `calc(${TOP_SAFE} + ${MOBILE_SOULS_HEIGHT} + ${MOBILE_STACK_GAP} + ${MOBILE_COLLATERAL_LINE} + ${MOBILE_STACK_GAP})`;

/** Reserved bottom-right zone for the aim / right stick (step 5 controls). */
export const MOBILE_RIGHT_STICK_SIZE = 'clamp(88px, 22vw, 110px)';
export const MOBILE_RIGHT_STICK_RIGHT = `calc(${RIGHT_SAFE} + 4px)`;
export const MOBILE_RIGHT_STICK_BOTTOM = `calc(${BOTTOM_SAFE} + 8px)`;

/** Bottom-left move stick zone. */
export const MOBILE_LEFT_STICK_SIZE = 'clamp(96px, 24vw, 120px)';
export const MOBILE_LEFT_STICK_LEFT = `calc(${LEFT_SAFE} + 4px)`;
export const MOBILE_LEFT_STICK_BOTTOM = `calc(${BOTTOM_SAFE} + 8px)`;

export function usesMobileHudLayout(): boolean {
  return isMobileDevice();
}

/** Inject shared mobile HUD rules once (scoped under .grim-mobile). */
export function ensureMobileHudStyles(host: HTMLElement): void {
  if (!isMobileDevice()) {
    return;
  }

  host.querySelector(`#${MOBILE_HUD_STYLE_ID}`)?.remove();

  const st = document.createElement('style');
  st.id = MOBILE_HUD_STYLE_ID;
  st.textContent = `
    .grim-mobile .grim-hud-health {
      top: ${TOP_SAFE} !important;
      left: ${LEFT_SAFE} !important;
      bottom: auto !important;
      right: auto !important;
      width: clamp(160px, 38vw, 260px) !important;
      height: auto !important;
      aspect-ratio: 862 / 235;
    }

    /* Top-right stack: souls frame first, then all objective text underneath. */
    .grim-mobile .grim-hud-souls {
      top: ${TOP_SAFE} !important;
      right: ${RIGHT_SAFE} !important;
      bottom: auto !important;
      left: auto !important;
      width: clamp(130px, 30vw, 200px) !important;
      height: auto !important;
      aspect-ratio: 688 / 302;
    }
    .grim-mobile .grim-hud-souls [data-grim-soul-count] {
      right: 18% !important;
      top: 50% !important;
      font-size: clamp(22px, 5.5vw, 34px) !important;
    }

    .grim-mobile .grim-hud-collateral {
      top: ${MOBILE_COLLATERAL_TOP} !important;
      right: ${RIGHT_SAFE} !important;
      left: auto !important;
      bottom: auto !important;
      max-width: min(46vw, 220px) !important;
      font-size: clamp(9px, 2.2vw, 11px) !important;
      line-height: 1.2 !important;
      text-align: right !important;
      white-space: normal !important;
    }

    .grim-mobile .grim-hud-mission-objective,
    .grim-mobile .grim-hud-soul-progress {
      top: ${MOBILE_OBJECTIVE_TOP} !important;
      right: ${RIGHT_SAFE} !important;
      left: auto !important;
      bottom: auto !important;
      max-width: min(44vw, 200px) !important;
      text-align: right !important;
      font-size: clamp(9px, 2.2vw, 11px) !important;
      line-height: 1.3 !important;
      letter-spacing: 0.04em !important;
    }
    .grim-mobile .grim-hud-mission-objective > div,
    .grim-mobile .grim-hud-soul-progress > div {
      font-size: clamp(9px, 2.2vw, 11px) !important;
      margin-top: 2px !important;
    }
    .grim-mobile [data-soul-progress-ui][data-stack-below-innocent] {
      top: calc(${MOBILE_OBJECTIVE_TOP} + clamp(48px, 12vw, 68px)) !important;
    }

    .grim-mobile .grim-hud-fist,
    .grim-mobile .grim-hud-grim-grinder {
      top: auto !important;
      left: auto !important;
      pointer-events: none;
    }

    /* E — left of the right-stick zone */
    .grim-mobile .grim-hud-fist {
      bottom: calc(${MOBILE_RIGHT_STICK_BOTTOM} + clamp(24px, 6vw, 36px)) !important;
      right: calc(${MOBILE_RIGHT_STICK_RIGHT} + ${MOBILE_RIGHT_STICK_SIZE} + clamp(6px, 1.5vw, 10px)) !important;
    }

    /* F — above-right of the right-stick zone */
    .grim-mobile .grim-hud-grim-grinder {
      bottom: calc(${MOBILE_RIGHT_STICK_BOTTOM} + ${MOBILE_RIGHT_STICK_SIZE} - clamp(8px, 2vw, 12px)) !important;
      right: calc(${MOBILE_RIGHT_STICK_RIGHT} + clamp(12px, 3vw, 20px)) !important;
    }

    .grim-mobile .grim-hud-fist [data-grim-hud-icon],
    .grim-mobile .grim-hud-grim-grinder [data-grim-hud-icon] {
      width: clamp(40px, 10vw, 48px) !important;
      height: clamp(40px, 10vw, 48px) !important;
    }
    .grim-mobile .grim-hud-grim-grinder [data-grim-hud-progress] {
      width: clamp(48px, 12vw, 56px) !important;
    }
    .grim-mobile .grim-hud-fist [data-grim-hud-key],
    .grim-mobile .grim-hud-grim-grinder [data-grim-hud-key] {
      font-size: clamp(9px, 2.2vw, 11px) !important;
    }
  `;
  host.appendChild(st);
}
