/**
 * MissionResultUI — win / fail overlay with stats; success continues to rewards.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { MissionEndResult } from '../mission/MissionState.js';
import { grimVault } from '../game/GrimVault.js';
import { injectBreeSerifFont } from './uiTypography.js';
import { pauseGame } from '../utils/game-pause.js';
import { returnToMap } from '../utils/return-to-map.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';
import { fadeToBlackThen } from '../utils/screen-transition.js';
import { MissionRewardsUI } from './MissionRewardsUI.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { ensureMobileMenuStyles } from './mobile-menus-layout.js';

const PANEL_URL = '@project/assets/UI/menuelement.webp';
const FRAME_URL = '@project/assets/UI/optionsbackground.webp';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

function formatElapsed(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function failReasonText(
  reason: 'collateral' | 'grim-defeated' | 'time-expired' | 'combo-lost',
): string {
  switch (reason) {
    case 'grim-defeated':
      return 'Grim was defeated';
    case 'time-expired':
      return 'Time ran out';
    case 'combo-lost':
      return 'Combo chain broken';
    default:
      return 'Collateral damage too high';
  }
}

export class MissionResultUI {
  private static _overlay: HTMLDivElement | null = null;

  public static async show(world: ENGINE.World, result: MissionEndResult): Promise<void> {
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) return;

    MissionResultUI.close();
    pauseGame(world);
    await injectBreeSerifFont();

    const won = result.outcome === 'success';
    let soulsBanked = 0;
    if (!won) {
      soulsBanked = result.soulsCollected;
      if (soulsBanked > 0) {
        grimVault.addSouls(soulsBanked);
      }
    }

    const [panelUrl, frameUrl] = await Promise.all([
      MissionResultUI._resolveUrl(PANEL_URL),
      MissionResultUI._resolveUrl(FRAME_URL),
    ]);

    ensureMobileMenuStyles(gc);
    const mobile = isMobileDevice();

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
      padding: clamp(12px, 3vh, 28px) clamp(10px, 3vw, 24px);
      box-sizing: border-box;
      overflow: ${mobile ? 'hidden' : 'visible'};
    `;

    const panel = document.createElement('div');
    panel.className = mobile ? 'grim-mission-result-panel' : '';
    panel.style.cssText = `
      position: relative;
      width: ${mobile ? 'min(420px, 88vw)' : 'min(520px, 92vw)'};
      max-height: ${mobile ? 'min(88vh, 520px)' : 'none'};
      min-height: ${mobile ? '0' : '320px'};
      padding: ${mobile
        ? 'clamp(28px, 4vh, 36px) clamp(36px, 7vw, 48px) clamp(44px, 5.5vh, 56px)'
        : '48px 36px 36px'};
      display: flex;
      flex-direction: column;
      align-items: center;
      box-sizing: border-box;
      overflow: hidden;
    `;
    if (frameUrl) {
      panel.style.backgroundImage = `url("${frameUrl}")`;
      panel.style.backgroundSize = '100% 100%';
      panel.style.backgroundRepeat = 'no-repeat';
    }

    const title = document.createElement('h1');
    title.textContent = won ? 'REAP SUCCESSFUL' : 'REAP FAILED';
    title.style.cssText = `
      margin: 0 0 ${mobile ? '4px' : '8px'};
      font-family: 'BreeSerif', Georgia, serif;
      font-size: ${mobile ? 'clamp(20px, 5.5vw, 28px)' : 'clamp(28px, 5vw, 42px)'};
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: ${won ? '#FFE082' : '#ff3a3a'};
      text-shadow: 0 0 20px ${won ? 'rgba(255, 200, 80, 0.7)' : 'rgba(255, 40, 40, 0.8)'};
      text-align: center;
    `;

    const subtitle = document.createElement('p');
    subtitle.style.cssText = `
      margin: 0 0 ${mobile ? '12px' : '20px'};
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-size: ${mobile ? 'clamp(11px, 2.4vw, 13px)' : 'clamp(13px, 2vw, 16px)'};
      line-height: 1.35;
      color: rgba(200, 210, 220, 0.95);
      text-align: center;
    `;
    subtitle.textContent = won
      ? 'The reaping is complete.'
      : `${failReasonText(result.reason)} — souls recovered, items forfeited.`;

    const stats = document.createElement('div');
    stats.style.cssText = `
      width: 100%;
      margin-bottom: ${mobile ? '14px' : '24px'};
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-size: ${mobile ? 'clamp(10px, 2.2vw, 12px)' : 'clamp(12px, 1.8vw, 15px)'};
      color: rgba(180, 190, 200, 0.95);
      line-height: 1.5;
      text-align: center;
    `;
    const lines = [
      `Souls from kills: ${result.soulsCollected}`,
      `Innocents saved: ${result.innocentsSaved}`,
      `Time: ${formatElapsed(result.elapsedSec)}`,
    ];
    if (!won) {
      lines.push(`Collateral: ${Math.round(result.collateralDamage)}%`);
      lines.push(
        soulsBanked > 0
          ? `Souls recovered to vault: ${soulsBanked}`
          : 'Souls recovered to vault: 0',
      );
      if (result.itemsLost > 0) {
        lines.push(`Items lost due to defeat: ${result.itemsLost}`);
      } else {
        lines.push('Items from this run were lost due to defeat.');
      }
    }
    stats.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');

    const btn = document.createElement('div');
    btn.textContent = won ? 'NEXT →' : 'RETURN TO MAP';
    btn.style.cssText = `
      position: relative;
      width: ${mobile ? 'min(200px, 62%)' : 'min(300px, 80%)'};
      aspect-ratio: 3.4 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: ${mobile ? 'clamp(13px, 2.8vw, 16px)' : 'clamp(16px, 2.5vw, 22px)'};
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
      if (won) {
        MissionResultUI.close();
        void MissionRewardsUI.show(world, result);
        return;
      }
      void fadeToBlackThen(
        world,
        () => {
          MissionResultUI.close();
          returnToMap(world);
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
