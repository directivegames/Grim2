/**
 * Mobile device detection and layout classes for Grim.
 * Desktop/browser paths never receive grim-mobile classes or portrait gating.
 */

const MOBILE_CLASS = 'grim-mobile';
const MOBILE_PORTRAIT_CLASS = 'grim-mobile-portrait';

/** Max short-edge px to treat touch devices as phones (avoids large touch laptops). */
const MOBILE_MAX_SHORT_EDGE = 900;

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const touchPoints = navigator.maxTouchPoints ?? 0;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  const phoneViewport = shortEdge <= MOBILE_MAX_SHORT_EDGE;

  // Touch-first UI with a phone-sized viewport.
  if (touchPoints > 0 && coarsePointer && noHover && phoneViewport) {
    return true;
  }

  // Hosted mobile browsers sometimes mis-report hover/pointer; trust UA + touch.
  if (touchPoints > 0 && isMobileUserAgent() && phoneViewport) {
    return true;
  }

  return false;
}

export function isLandscapeViewport(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  if (window.matchMedia('(orientation: landscape)').matches) {
    return true;
  }

  return window.innerWidth > window.innerHeight;
}

/** True when mobile users must rotate before playing. */
export function shouldShowLandscapeOverlay(): boolean {
  return isMobileDevice() && !isLandscapeViewport();
}

export function applyMobileDeviceClass(host: HTMLElement): void {
  if (!isMobileDevice()) {
    host.classList.remove(MOBILE_CLASS);
    host.classList.remove(MOBILE_PORTRAIT_CLASS);
    return;
  }

  host.classList.add(MOBILE_CLASS);
  syncPortraitClass(host);
}

export function syncPortraitClass(host: HTMLElement): void {
  if (!isMobileDevice()) {
    host.classList.remove(MOBILE_PORTRAIT_CLASS);
    return;
  }

  if (shouldShowLandscapeOverlay()) {
    host.classList.add(MOBILE_PORTRAIT_CLASS);
  } else {
    host.classList.remove(MOBILE_PORTRAIT_CLASS);
  }
}

const boundHosts = new WeakSet<HTMLElement>();

/** Listen for resize/orientation and keep mobile classes in sync. */
export function initMobileDeviceListeners(host: HTMLElement, onLayoutChange?: () => void): void {
  if (typeof window === 'undefined' || !isMobileDevice()) {
    return;
  }

  if (boundHosts.has(host)) {
    return;
  }
  boundHosts.add(host);

  const update = (): void => {
    applyMobileDeviceClass(host);
    onLayoutChange?.();
  };

  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('orientationchange', update, { passive: true });

  const orientation = screen.orientation;
  if (orientation) {
    orientation.addEventListener('change', update);
  }

  update();
}
