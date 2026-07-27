import * as ENGINE from '@gnsx/genesys.js';

const SCREEN_FADE_ATTR = 'data-screen-fade';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getGameContainer(world: ENGINE.World): HTMLElement | null {
  return (world as GameContainerWorld).gameContainer ?? null;
}

/**
 * Create (or return the existing) full-screen black overlay element.
 * Re-uses the same element across calls — does not stack overlays.
 */
export function createScreenFade(
  container: HTMLElement,
  zIndex = 10100,
): HTMLDivElement {
  let el = container.querySelector(`[${SCREEN_FADE_ATTR}]`) as HTMLDivElement | null;
  if (el) {
    return el;
  }
  el = document.createElement('div');
  el.setAttribute(SCREEN_FADE_ATTR, '');
  el.style.cssText = `
    position: absolute;
    inset: 0;
    z-index: ${zIndex};
    background: #000000;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.28s ease;
  `;
  container.appendChild(el);
  return el;
}

/** Fade the screen to black over durationMs milliseconds. Resolves when complete. */
export function fadeInScreen(
  container: HTMLElement,
  durationMs = 280,
  zIndex = 10100,
): Promise<void> {
  const el = createScreenFade(container, zIndex);
  el.style.transition = `opacity ${durationMs}ms ease`;
  el.style.pointerEvents = 'auto';
  void el.offsetWidth; // force reflow so transition fires from opacity 0
  el.style.opacity = '1';
  return delay(durationMs);
}

/** Fade the screen back in over durationMs milliseconds, then remove the overlay. */
export function fadeOutScreen(container: HTMLElement, durationMs = 400): Promise<void> {
  const el = container.querySelector(`[${SCREEN_FADE_ATTR}]`) as HTMLDivElement | null;
  if (!el) {
    return delay(0);
  }
  el.style.transition = `opacity ${durationMs}ms ease`;
  el.style.opacity = '0';
  return delay(durationMs).then(() => {
    el.remove();
  });
}

/** Fade an element in by animating its opacity from 0 to 1. Fire-and-forget. */
export function fadeInElement(el: HTMLElement, durationMs = 450): void {
  el.style.opacity = '0';
  el.style.transition = `opacity ${durationMs}ms ease`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
  });
}

/** Fade an element out by animating its opacity to 0. Resolves when complete. */
export function fadeOutElement(el: HTMLElement, durationMs = 500): Promise<void> {
  el.style.transition = `opacity ${durationMs}ms ease`;
  el.style.opacity = '0';
  return delay(durationMs);
}

/**
 * Fade to black, run an async action (scene swap, teleport, asset load), then fade back in.
 *
 * If world has no gameContainer, the action still runs (fades are silently skipped).
 */
export async function fadeToBlackThen(
  world: ENGINE.World,
  action: () => void | Promise<void>,
  fadeInMs = 260,
  holdMs = 80,
): Promise<void> {
  const gc = getGameContainer(world);
  if (!gc) {
    await action();
    return;
  }
  await fadeInScreen(gc, fadeInMs);
  await delay(holdMs);
  await action();
  await fadeOutScreen(gc, 320);
}
