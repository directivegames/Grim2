/**
 * Mobile-friendly mission briefing and upgrade shop layout (scoped under .grim-mobile).
 */
import { isMobileDevice } from '../utils/mobile-device.js';

const STYLE_ID = 'grim-mobile-menus-styles';

export function ensureMobileMenuStyles(host: HTMLElement): void {
  if (!isMobileDevice()) {
    return;
  }

  if (host.querySelector(`#${STYLE_ID}`)) {
    return;
  }

  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    .grim-mobile .grim-map-briefing-panel {
      width: min(520px, 94vw) !important;
      max-height: min(88vh, 720px);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: clamp(28px, 4vh, 40px) clamp(18px, 4vw, 28px) clamp(22px, 3vh, 32px) !important;
    }
    .grim-mobile .grim-map-briefing-panel button {
      min-height: 44px;
      min-width: 44px;
      padding: 10px 14px !important;
      font-size: 0.82rem !important;
      touch-action: manipulation;
    }
    .grim-mobile .grim-map-briefing-btn {
      width: min(320px, 88%) !important;
      min-height: 48px !important;
      aspect-ratio: unset !important;
    }
    .grim-mobile .grim-map-briefing-btn span {
      font-size: clamp(0.72rem, 2.8vw, 0.92rem) !important;
    }

    .grim-mobile [data-grim-upgrade-shop] {
      padding: max(12px, env(safe-area-inset-top, 0px)) 8px max(12px, env(safe-area-inset-bottom, 0px));
    }
    .grim-mobile [data-grim-upgrade-shop] button[data-shop-tab] {
      min-height: 44px;
      padding: 10px 18px !important;
      font-size: clamp(11px, 2.8vw, 13px) !important;
      touch-action: manipulation;
    }
    .grim-mobile [data-grim-upgrade-shop] [data-grim-shop-list] {
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
    }
    .grim-mobile [data-grim-upgrade-shop] .grim-shop-row {
      grid-template-columns: 1fr minmax(120px, 38%) !important;
      gap: 10px !important;
      padding: 12px !important;
    }
    .grim-mobile [data-grim-upgrade-shop] .grim-shop-action {
      min-height: 44px !important;
      max-width: none !important;
      width: 100% !important;
      aspect-ratio: unset !important;
      font-size: clamp(11px, 2.6vw, 13px) !important;
      touch-action: manipulation;
    }
    .grim-mobile [data-grim-upgrade-shop] .grim-shop-close {
      min-height: 48px !important;
      width: min(280px, 72vw) !important;
    }
  `;
  host.appendChild(st);
}
