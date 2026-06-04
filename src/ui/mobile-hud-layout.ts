/**
 * Mobile HUD placement — desktop layouts stay in each UI file; mobile uses scoped CSS.
 */
import { isMobileDevice } from '../utils/mobile-device.js';

const MOBILE_HUD_STYLE_ID = 'grim-mobile-hud-styles';
const MOBILE_MISSION_COL_ID = 'grim-mobile-mission-col';

const TOP_SAFE = 'max(8px, env(safe-area-inset-top, 0px))';
const LEFT_SAFE = 'max(10px, env(safe-area-inset-left, 0px))';
const RIGHT_SAFE = 'max(10px, env(safe-area-inset-right, 0px))';
const BOTTOM_SAFE = 'max(16px, env(safe-area-inset-bottom, 0px))';

const MOBILE_HEALTH_HEIGHT = 'clamp(30px, 7.5vw, 46px)';
/** Souls frame height at mobile scale — derived from width 20vw × (302/688) aspect. */
const MOBILE_SOULS_HEIGHT = 'clamp(40px, 8.8vw, 62px)';

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

/**
 * Returns the shared top-right mission-text column on mobile, creating it on first call.
 * On desktop returns the host unchanged so callers can always do `parent.appendChild(el)`.
 */
export function getMobileMissionColumn(host: HTMLElement): HTMLElement {
  if (!isMobileDevice()) return host;
  let col = host.querySelector<HTMLElement>(`#${MOBILE_MISSION_COL_ID}`);
  if (!col) {
    col = document.createElement('div');
    col.id = MOBILE_MISSION_COL_ID;
    host.appendChild(col);
  }
  return col;
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
      width: clamp(110px, 26vw, 180px) !important;
      height: auto !important;
      aspect-ratio: 862 / 235;
    }

    /* Top-right stack: souls frame first, then all objective text underneath. */
    .grim-mobile .grim-hud-souls {
      top: ${TOP_SAFE} !important;
      right: ${RIGHT_SAFE} !important;
      bottom: auto !important;
      left: auto !important;
      width: clamp(90px, 20vw, 140px) !important;
      height: auto !important;
      aspect-ratio: 688 / 302;
    }
    .grim-mobile .grim-hud-souls [data-grim-soul-count] {
      right: 18% !important;
      top: 50% !important;
      font-size: clamp(13px, 3.2vw, 20px) !important;
    }

    /* ── Mission text column: single flex container, no brittle calc chains ── */
    #${MOBILE_MISSION_COL_ID} {
      position: absolute;
      top: calc(${TOP_SAFE} + ${MOBILE_SOULS_HEIGHT} + 5px);
      right: ${RIGHT_SAFE};
      width: clamp(130px, 32vw, 180px);
      max-height: clamp(90px, 22vh, 140px);
      display: flex;
      flex-direction: column;
      gap: 2px;
      z-index: 1005;
      pointer-events: none;
      overflow: hidden;
    }

    /* Stable visual order regardless of DOM insertion order. */
    #${MOBILE_MISSION_COL_ID} .grim-hud-collateral            { order: 1; }
    #${MOBILE_MISSION_COL_ID} .grim-hud-mission-objective:not(.grim-hud-soul-progress) { order: 2; }
    #${MOBILE_MISSION_COL_ID} .grim-hud-soul-progress         { order: 3; }

    /* Each panel: relative flow inside the column, one line per entry. */
    #${MOBILE_MISSION_COL_ID} > * {
      position: relative !important;
      top: auto !important;
      right: auto !important;
      left: auto !important;
      bottom: auto !important;
      max-width: none !important;
      width: 100% !important;
      font-size: clamp(10px, 2.2vw, 12px) !important;
      line-height: 1.3 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      text-align: right !important;
      letter-spacing: 0.04em !important;
    }

    /* Inner text rows (timer / progress lines). */
    #${MOBILE_MISSION_COL_ID} > * > div {
      font-size: clamp(10px, 2.2vw, 12px) !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      margin-top: 1px !important;
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

    .grim-mobile .grim-hud-fist [data-grim-hud-icon] {
      width: clamp(52px, 13vw, 62px) !important;
      height: clamp(52px, 13vw, 62px) !important;
      pointer-events: auto !important;
      touch-action: manipulation;
      cursor: pointer;
    }
    .grim-mobile .grim-hud-grim-grinder [data-grim-hud-icon] {
      width: clamp(40px, 10vw, 48px) !important;
      height: clamp(40px, 10vw, 48px) !important;
    }
    .grim-mobile .grim-hud-grim-grinder [data-grim-hud-progress] {
      width: clamp(48px, 12vw, 56px) !important;
    }
    .grim-mobile .grim-hud-fist [data-grim-hud-key] {
      display: none !important;
    }
    .grim-mobile .grim-hud-grim-grinder [data-grim-hud-key] {
      font-size: clamp(9px, 2.2vw, 11px) !important;
    }
  `;
  host.appendChild(st);
}
