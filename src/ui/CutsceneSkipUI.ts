/**
 * Shared "Skip cutscene" control for in-game cinematic overlays.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { playMenuSelectSound } from '../utils/menu-audio.js';

export const CUTSCENE_SKIP_ATTR = 'data-grim-cutscene-skip';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

/**
 * Top-right skip button. Returns cleanup (removes the button).
 */
export function mountCutsceneSkipButton(
  world: ENGINE.World,
  onSkip: () => void,
  label = 'SKIP CUTSCENE',
): () => void {
  const gc = (world as GameContainerWorld).gameContainer;
  if (!gc) {
    return () => { /* no-op */ };
  }

  const existing = gc.querySelector(`[${CUTSCENE_SKIP_ATTR}]`);
  existing?.remove();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute(CUTSCENE_SKIP_ATTR, '');
  btn.textContent = label;
  btn.style.cssText = `
    position: absolute;
    top: clamp(16px, 3vh, 28px);
    right: clamp(16px, 3vw, 28px);
    z-index: 10180;
    padding: 10px 18px;
    border: 1px solid rgba(255, 200, 120, 0.55);
    border-radius: 6px;
    background: rgba(12, 10, 8, 0.88);
    color: #ffe8b0;
    font-family: Montserrat, 'Segoe UI', sans-serif;
    font-weight: 700;
    font-size: clamp(11px, 1.6vw, 13px);
    letter-spacing: 0.14em;
    cursor: pointer;
    pointer-events: auto;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    transition: transform 0.15s ease, filter 0.15s ease, background 0.15s ease;
  `;

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'scale(1.04)';
    btn.style.filter = 'brightness(1.12)';
    btn.style.background = 'rgba(24, 18, 12, 0.95)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'scale(1)';
    btn.style.filter = 'none';
    btn.style.background = 'rgba(12, 10, 8, 0.88)';
  });
  btn.addEventListener('click', () => {
    playMenuSelectSound(world);
    onSkip();
  });

  gc.appendChild(btn);

  return () => {
    btn.remove();
  };
}

export function removeCutsceneSkipButton(world: ENGINE.World): void {
  const gc = (world as GameContainerWorld).gameContainer;
  gc?.querySelector(`[${CUTSCENE_SKIP_ATTR}]`)?.remove();
}
