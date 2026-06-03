/**
 * MobileLandscapeOverlayUI — blocks play in portrait on mobile until landscape.
 * Desktop/browser: never mounted.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  applyMobileDeviceClass,
  initMobileDeviceListeners,
  isMobileDevice,
  shouldShowLandscapeOverlay,
} from '../utils/mobile-device.js';

const OVERLAY_ATTR = 'data-grim-mobile-landscape-overlay';

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

export class MobileLandscapeOverlayUI {
  private static overlayByHost = new WeakMap<HTMLElement, HTMLDivElement>();

  /**
   * Call from main() on the game host container before the loop starts.
   */
  public static ensureOnHost(host: HTMLElement): void {
    if (!isMobileDevice()) {
      return;
    }

    applyMobileDeviceClass(host);
    initMobileDeviceListeners(host, () => {
      MobileLandscapeOverlayUI._syncVisibility(host);
    });
    MobileLandscapeOverlayUI._ensureOverlay(host);
    MobileLandscapeOverlayUI._syncVisibility(host);
  }

  /** Prefer gameContainer once the world exists (same pattern as other HUD UIs). */
  public static attach(world: ENGINE.World): void {
    const w = world as GameContainerWorld;
    const host = w.gameContainer;
    if (!host || w.options?.headless || !isMobileDevice()) {
      return;
    }

    applyMobileDeviceClass(host);
    initMobileDeviceListeners(host, () => {
      MobileLandscapeOverlayUI._syncVisibility(host);
    });
    MobileLandscapeOverlayUI._ensureOverlay(host);
    MobileLandscapeOverlayUI._syncVisibility(host);
  }

  private static _ensureOverlay(host: HTMLElement): HTMLDivElement {
    let overlay = MobileLandscapeOverlayUI.overlayByHost.get(host);
    if (overlay?.isConnected) {
      return overlay;
    }

    const existing = host.querySelector<HTMLDivElement>(`[${OVERLAY_ATTR}]`);
    if (existing) {
      MobileLandscapeOverlayUI.overlayByHost.set(host, existing);
      return existing;
    }

    overlay = document.createElement('div');
    overlay.setAttribute(OVERLAY_ATTR, '');
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10150;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: clamp(12px, 3vh, 20px);
      padding: clamp(20px, 5vw, 40px);
      box-sizing: border-box;
      background: rgba(5, 5, 10, 0.94);
      color: rgba(220, 228, 236, 0.98);
      text-align: center;
      user-select: none;
      pointer-events: auto;
    `;

    const icon = document.createElement('div');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↻';
    icon.style.cssText = `
      font-size: clamp(48px, 14vw, 72px);
      line-height: 1;
      color: rgba(160, 245, 255, 0.95);
      text-shadow: 0 0 24px rgba(0, 220, 255, 0.45);
      transform: rotate(90deg);
    `;

    const title = document.createElement('h2');
    title.textContent = 'ROTATE YOUR DEVICE';
    title.style.cssText = `
      margin: 0;
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(1rem, 4.5vw, 1.35rem);
      letter-spacing: 0.18em;
      color: rgba(160, 245, 255, 0.98);
    `;

    const body = document.createElement('p');
    body.textContent = 'Grim plays in landscape. Turn your phone sideways to continue.';
    body.style.cssText = `
      margin: 0;
      max-width: min(360px, 88vw);
      font-family: Montserrat, system-ui, sans-serif;
      font-size: clamp(0.8rem, 3.2vw, 0.95rem);
      line-height: 1.45;
      color: rgba(180, 190, 200, 0.92);
    `;

    overlay.append(icon, title, body);
    host.appendChild(overlay);
    MobileLandscapeOverlayUI.overlayByHost.set(host, overlay);
    return overlay;
  }

  private static _syncVisibility(host: HTMLElement): void {
    const overlay = MobileLandscapeOverlayUI._ensureOverlay(host);
    const show = shouldShowLandscapeOverlay();
    overlay.style.display = show ? 'flex' : 'none';
    overlay.style.pointerEvents = show ? 'auto' : 'none';
  }
}
