/**
 * MissionResultUI — win / fail overlay with stats and RETURN TO MAP.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { MissionEndResult } from '../mission/MissionState.js';
import { injectBreeSerifFont } from './uiTypography.js';
import { pauseGame } from '../utils/game-pause.js';
import { returnToMainMenu } from '../utils/return-to-main-menu.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';
import { fadeToBlackThen } from '../utils/screen-transition.js';

const PANEL_URL = '@project/assets/UI/menu element.png';
const FRAME_URL = '@project/assets/UI/optionsbackground.png';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

function formatElapsed(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function failReasonText(reason: 'collateral' | 'grim-defeated'): string {
  if (reason === 'grim-defeated') {
    return 'Grim was defeated';
  }
  return 'Collateral damage too high';
}

export class MissionResultUI {
  private static _overlay: HTMLDivElement | null = null;

  public static async show(world: ENGINE.World, result: MissionEndResult): Promise<void> {
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) return;

    MissionResultUI.close();
    pauseGame(world);
    await injectBreeSerifFont();

    const [panelUrl, frameUrl] = await Promise.all([
      MissionResultUI._resolveUrl(PANEL_URL),
      MissionResultUI._resolveUrl(FRAME_URL),
    ]);

    const backdrop = document.createElement('div');
    backdrop.setAttribute('data-mission-result', '');
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10200;
      background: rgba(0, 0, 0, 0.72);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: relative;
      width: min(520px, 92vw);
      min-height: 320px;
      padding: 48px 36px 36px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-sizing: border-box;
    `;
    if (frameUrl) {
      panel.style.backgroundImage = `url("${frameUrl}")`;
      panel.style.backgroundSize = '100% 100%';
      panel.style.backgroundRepeat = 'no-repeat';
    }

    const won = result.outcome === 'success';
    const title = document.createElement('h1');
    title.textContent = won ? 'REAP SUCCESSFUL' : 'REAP FAILED';
    title.style.cssText = `
      margin: 0 0 8px;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(28px, 5vw, 42px);
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: ${won ? '#FFE082' : '#ff3a3a'};
      text-shadow: 0 0 20px ${won ? 'rgba(255, 200, 80, 0.7)' : 'rgba(255, 40, 40, 0.8)'};
      text-align: center;
    `;

    const subtitle = document.createElement('p');
    subtitle.style.cssText = `
      margin: 0 0 20px;
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-size: clamp(13px, 2vw, 16px);
      color: rgba(200, 210, 220, 0.95);
      text-align: center;
    `;
    subtitle.textContent = won
      ? 'The reaping is complete.'
      : failReasonText(result.reason);

    const stats = document.createElement('div');
    stats.style.cssText = `
      width: 100%;
      margin-bottom: 24px;
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-size: clamp(12px, 1.8vw, 15px);
      color: rgba(180, 190, 200, 0.95);
      line-height: 1.7;
      text-align: center;
    `;
    const lines = [
      `Souls reaped: ${result.soulsCollected}`,
      `Innocents saved: ${result.innocentsSaved}`,
      `Time: ${formatElapsed(result.elapsedSec)}`,
    ];
    if (!won) {
      lines.push(`Collateral: ${Math.round(result.collateralDamage)}%`);
    }
    stats.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');

    const btn = document.createElement('div');
    btn.textContent = 'RETURN TO MAP';
    btn.style.cssText = `
      position: relative;
      width: min(300px, 80%);
      aspect-ratio: 3.4 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(16px, 2.5vw, 22px);
      font-weight: 900;
      letter-spacing: 0.08em;
      color: #ffe8b0;
      text-shadow: 0 2px 6px rgba(0,0,0,0.9);
      transition: transform 0.15s ease, filter 0.15s ease;
    `;
    if (panelUrl) {
      btn.style.backgroundImage = `url("${panelUrl}")`;
      btn.style.backgroundSize = '100% auto';
      btn.style.backgroundRepeat = 'no-repeat';
      btn.style.backgroundPosition = 'center';
    } else {
      btn.style.border = '2px solid rgba(255, 200, 120, 0.6)';
      btn.style.borderRadius = '8px';
    }

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.04)';
      btn.style.filter = 'brightness(1.12)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.filter = 'brightness(1)';
    });
    btn.addEventListener('click', () => {
      playMenuSelectSound(world);
      void fadeToBlackThen(
        world,
        () => {
          MissionResultUI.close();
          returnToMainMenu(world);
        },
        300,
        100,
      );
    });

    panel.append(title, subtitle, stats, btn);
    backdrop.appendChild(panel);
    gc.appendChild(backdrop);
    MissionResultUI._overlay = backdrop;
  }

  public static close(): void {
    MissionResultUI._overlay?.remove();
    MissionResultUI._overlay = null;
  }

  private static async _resolveUrl(projectPath: string): Promise<string> {
    const css = `.bg { background-image: url("${projectPath}"); }`;
    const resolved = await ENGINE.resolveAssetPathsInText(css);
    const match = resolved.match(/url\("([^"]+)"\)/);
    return match?.[1] ?? '';
  }
}
