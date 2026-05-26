/**
 * Lightweight full-screen fades (CSS only — no render cost).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { GRIM_INTRO_BLACK_COVER_ATTR } from '../actors/GrimIntroActor.js';

const SCREEN_FADE_ATTR = 'data-grim-screen-fade';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getGameContainer(world: ENGINE.World): HTMLElement | null {
  return (world as GameContainerWorld).gameContainer ?? null;
}

/** Full-screen black overlay for cuts between UI flows. */
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
    background: #050508;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.28s ease;
  `;
  container.appendChild(el);
  return el;
}

export function fadeInScreen(
  container: HTMLElement,
  durationMs = 280,
  zIndex = 10100,
): Promise<void> {
  const el = createScreenFade(container, zIndex);
  el.style.transition = `opacity ${durationMs}ms ease`;
  el.style.pointerEvents = 'auto';
  void el.offsetWidth;
  el.style.opacity = '1';
  return delay(durationMs);
}

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

export function fadeInElement(el: HTMLElement, durationMs = 450): void {
  el.style.opacity = '0';
  el.style.transition = `opacity ${durationMs}ms ease`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });
  });
}

export function fadeOutElement(el: HTMLElement, durationMs = 500): Promise<void> {
  el.style.transition = `opacity ${durationMs}ms ease`;
  el.style.opacity = '0';
  return delay(durationMs);
}

/** Fade out Grim intro black cover after map / next UI is ready. */
export async function fadeOutIntroBlackCover(
  world: ENGINE.World,
  durationMs = 520,
): Promise<void> {
  const gc = getGameContainer(world);
  if (!gc) return;
  const cover = gc.querySelector(`[${GRIM_INTRO_BLACK_COVER_ATTR}]`) as HTMLElement | null;
  if (!cover) return;
  await fadeOutElement(cover, durationMs);
  cover.remove();
}

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

/** Remove any full-screen black layers left from UI transitions. */
export function removeAllBlockingOverlays(world: ENGINE.World): void {
  const gc = getGameContainer(world);
  if (!gc) return;
  gc.querySelectorAll(`[${SCREEN_FADE_ATTR}], [${GRIM_INTRO_BLACK_COVER_ATTR}]`).forEach(
    (el) => el.remove(),
  );
}
