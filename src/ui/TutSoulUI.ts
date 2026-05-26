/**
 * TutSoulUI — save-innocents tutorial before gameplay. Shown each mission until save flags exist.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { injectBreeSerifFont } from './uiTypography.js';
import { markTutSoulSeen } from '../utils/tut-progress.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';
import { pauseGame, resumeGame } from '../utils/game-pause.js';

const TUT_IMAGE_URL = '@project/assets/UI/TutSoul.png';
const PANEL_URL = '@project/assets/UI/menu element.png';

export const TUT_SOUL_OVERLAY_ATTR = 'data-tut-soul';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class TutSoulUI {
  private static _overlay: HTMLDivElement | null = null;

  /**
   * Full-screen tutorial; pauses gameplay until the player clicks Close.
   * Calls `onComplete` after the overlay is dismissed.
   */
  public static async show(world: ENGINE.World, onComplete: () => void): Promise<void> {
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc || (world as GameContainerWorld).options?.headless) {
      onComplete();
      return;
    }

    TutSoulUI.close();
    pauseGame(world);
    await injectBreeSerifFont();

    const [imageUrl, panelUrl] = await Promise.all([
      ENGINE.resolveAssetPathsInText(TUT_IMAGE_URL),
      ENGINE.resolveAssetPathsInText(PANEL_URL),
    ]);

    const backdrop = document.createElement('div');
    backdrop.setAttribute(TUT_SOUL_OVERLAY_ATTR, '');
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10150;
      background: rgba(0, 0, 0, 0.78);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: clamp(12px, 2vh, 24px);
      pointer-events: auto;
      user-select: none;
    `;

    const img = document.createElement('img');
    img.draggable = false;
    img.alt = 'Save innocents tutorial';
    img.src = imageUrl;
    img.style.cssText = `
      max-width: min(92vw, 720px);
      max-height: min(70vh, 520px);
      width: auto;
      height: auto;
      object-fit: contain;
      pointer-events: none;
      filter: drop-shadow(0 8px 32px rgba(0, 0, 0, 0.85));
    `;

    const closeBtn = document.createElement('div');
    closeBtn.textContent = 'CLOSE';
    closeBtn.setAttribute('role', 'button');
    closeBtn.style.cssText = `
      position: relative;
      width: min(280px, 70vw);
      aspect-ratio: 3.4 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(16px, 2.2vw, 22px);
      font-weight: 900;
      letter-spacing: 0.1em;
      color: #ffe8b0;
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
      transition: transform 0.15s ease, filter 0.15s ease;
    `;
    if (panelUrl) {
      closeBtn.style.backgroundImage = `url("${panelUrl}")`;
      closeBtn.style.backgroundSize = '100% auto';
      closeBtn.style.backgroundRepeat = 'no-repeat';
      closeBtn.style.backgroundPosition = 'center';
    } else {
      closeBtn.style.border = '2px solid rgba(255, 200, 120, 0.65)';
      closeBtn.style.borderRadius = '8px';
    }

    const finish = (): void => {
      playMenuSelectSound(world);
      markTutSoulSeen();
      TutSoulUI.close();
      resumeGame(world);
      onComplete();
    };

    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.transform = 'scale(1.04)';
      closeBtn.style.filter = 'brightness(1.12)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.transform = 'scale(1)';
      closeBtn.style.filter = 'brightness(1)';
    });
    closeBtn.addEventListener('click', finish);

    backdrop.append(img, closeBtn);
    gc.appendChild(backdrop);
    TutSoulUI._overlay = backdrop;
  }

  public static close(): void {
    TutSoulUI._overlay?.remove();
    TutSoulUI._overlay = null;
  }

  public static isOpen(): boolean {
    return TutSoulUI._overlay != null;
  }
}
