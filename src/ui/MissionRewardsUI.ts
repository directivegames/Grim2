/**
 * MissionRewardsUI — post-success loot reveal (items + souls banked).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { getItemById, itemIconProjectPath } from '../data/items.js';
import type { ItemRarity } from '../data/items.js';
import { grimVault } from '../game/GrimVault.js';
import type { MissionSuccessResult } from '../mission/MissionState.js';
import { returnToMap } from '../utils/return-to-map.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';
import { fadeToBlackThen } from '../utils/screen-transition.js';
import { resolveProjectAssetUrl } from '../utils/resolve-project-asset.js';
import { injectBreeSerifFont } from './uiTypography.js';
import { pauseGame } from '../utils/game-pause.js';

const PANEL_URL = '@project/assets/UI/menu element.png';
const FRAME_URL = '@project/assets/UI/optionsbackground.png';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

interface AggregatedDrop {
  itemId: string;
  qty: number;
}

const RARITY_STAGGER_MS: Record<ItemRarity, number> = {
  common: 120,
  uncommon: 160,
  rare: 220,
  legendary: 320,
};

export class MissionRewardsUI {
  private static _overlay: HTMLDivElement | null = null;
  private static _collected = false;

  public static async show(world: ENGINE.World, result: MissionSuccessResult): Promise<void> {
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    MissionRewardsUI.close();
    MissionRewardsUI._collected = false;
    pauseGame(world);
    await injectBreeSerifFont();

    const itemDrops = MissionRewardsUI._aggregateDrops(result.itemDrops);

    const [panelUrl, frameUrl, iconUrls] = await Promise.all([
      MissionRewardsUI._resolveUrl(PANEL_URL),
      MissionRewardsUI._resolveUrl(FRAME_URL),
      MissionRewardsUI._resolveItemIcons(itemDrops),
    ]);

    const backdrop = document.createElement('div');
    backdrop.setAttribute('data-mission-rewards', '');
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10250;
      background: rgba(0, 0, 0, 0.82);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: relative;
      width: min(560px, 94vw);
      max-height: 90vh;
      overflow-y: auto;
      padding: 44px 32px 32px;
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

    const title = document.createElement('h1');
    title.textContent = 'REWARDS';
    title.style.cssText = `
      margin: 0 0 6px;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(26px, 4.5vw, 38px);
      font-weight: 900;
      letter-spacing: 0.1em;
      color: #ffe082;
      text-shadow: 0 0 18px rgba(255, 200, 80, 0.65);
    `;

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Your reap yields the following.';
    subtitle.style.cssText = `
      margin: 0 0 20px;
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-size: clamp(12px, 1.8vw, 15px);
      color: rgba(200, 210, 220, 0.9);
      text-align: center;
    `;

    const grid = document.createElement('div');
    grid.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      justify-content: center;
      width: 100%;
      min-height: 80px;
      margin-bottom: 20px;
    `;

    if (itemDrops.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No items this run — keep reaping.';
      empty.style.cssText = `
        font-family: Montserrat, sans-serif;
        font-size: 14px;
        color: rgba(160, 170, 180, 0.85);
        text-align: center;
      `;
      grid.appendChild(empty);
    } else {
      let delayMs = 0;
      for (const drop of itemDrops) {
        const def = getItemById(drop.itemId);
        const rarity = def?.rarity ?? 'common';
        delayMs += RARITY_STAGGER_MS[rarity];
        const card = MissionRewardsUI._createItemCard(
          drop,
          def?.name ?? drop.itemId,
          rarity,
          iconUrls.get(drop.itemId) ?? '',
        );
        card.style.animationDelay = `${delayMs}ms`;
        grid.appendChild(card);
      }
    }

    const soulsChip = document.createElement('div');
    soulsChip.style.cssText = `
      margin-bottom: 22px;
      padding: 10px 20px;
      border-radius: 6px;
      border: 1px solid rgba(255, 220, 120, 0.45);
      background: rgba(20, 16, 8, 0.65);
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(18px, 3vw, 24px);
      color: #ffe8b0;
      letter-spacing: 0.06em;
    `;
    const soulsTarget = result.soulsCollected;
    soulsChip.textContent = `+0 souls`;
    MissionRewardsUI._animateCount(soulsChip, soulsTarget, 900, 'souls');

    const btn = document.createElement('div');
    btn.textContent = 'COLLECT & RETURN TO MAP';
    btn.style.cssText = `
      position: relative;
      width: min(340px, 88%);
      aspect-ratio: 3.4 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(14px, 2.2vw, 18px);
      font-weight: 900;
      letter-spacing: 0.06em;
      color: #ffe8b0;
      text-shadow: 0 2px 6px rgba(0,0,0,0.9);
      transition: transform 0.15s ease, filter 0.15s ease;
    `;
    if (panelUrl) {
      btn.style.backgroundImage = `url("${panelUrl}")`;
      btn.style.backgroundSize = '100% auto';
      btn.style.backgroundRepeat = 'no-repeat';
      btn.style.backgroundPosition = 'center';
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
      if (MissionRewardsUI._collected) {
        return;
      }
      MissionRewardsUI._collected = true;
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.65';
      playMenuSelectSound(world);
      MissionRewardsUI._bankRewards(result, itemDrops);
      void fadeToBlackThen(
        world,
        () => {
          MissionRewardsUI.close();
          returnToMap(world);
        },
        300,
        100,
      );
    });

    MissionRewardsUI._injectStyles(gc);
    panel.append(title, subtitle, grid, soulsChip, btn);
    backdrop.appendChild(panel);
    gc.appendChild(backdrop);
    MissionRewardsUI._overlay = backdrop;
  }

  public static close(): void {
    MissionRewardsUI._overlay?.remove();
    MissionRewardsUI._overlay = null;
  }

  private static _bankRewards(
    result: MissionSuccessResult,
    drops: readonly AggregatedDrop[],
  ): void {
    grimVault.addSouls(result.soulsCollected);
    for (const drop of drops) {
      grimVault.addItem(drop.itemId, drop.qty);
    }
    if (!grimVault.isTutorialCompleted()) {
      grimVault.markTutorialCompleted();
    }
    // Progression: unlock next tier only when the player completes the highest-unlocked tier.
    // e.g. to unlock Risk 3 you must complete Risk 2 at least once.
    const unlocked = grimVault.getUnlockedRiskLevel();
    if (result.risk5PlusTier === 0 && result.riskLevel === unlocked) {
      grimVault.unlockNextRiskLevel();
    }

    // Risk 5+ unlock: one successful normal Risk 5 run.
    if (result.riskLevel >= 5 && result.risk5PlusTier === 0) {
      grimVault.unlockRisk5Plus();
    }

    if ((result.risk5PlusTier ?? 0) > 0) {
      grimVault.incrementRisk5PlusCompletions();
    }
  }

  private static _aggregateDrops(ids: readonly string[]): AggregatedDrop[] {
    const counts = new Map<string, number>();
    for (const id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()].map(([itemId, qty]) => ({ itemId, qty }));
  }

  private static _createItemCard(
    drop: AggregatedDrop,
    name: string,
    rarity: ItemRarity,
    iconUrl: string,
  ): HTMLDivElement {
    const card = document.createElement('div');
    card.className = `grim-reward-card grim-reward-${rarity}`;
    card.style.cssText = `
      width: 88px;
      padding: 8px 6px 10px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      border-radius: 8px;
      background: rgba(12, 14, 18, 0.85);
      border: 1px solid rgba(120, 140, 160, 0.35);
      opacity: 0;
      transform: translateY(-28px) scale(0.92);
      animation: grim-reward-drop-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    `;

    if (iconUrl) {
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = name;
      img.style.cssText = 'width: 48px; height: 48px; object-fit: contain;';
      card.appendChild(img);
    }

    const label = document.createElement('div');
    label.textContent = name;
    label.style.cssText = `
      font-family: Montserrat, sans-serif;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-align: center;
      color: rgba(220, 228, 236, 0.95);
      line-height: 1.2;
    `;

    const qty = document.createElement('div');
    qty.textContent = drop.qty > 1 ? `×${drop.qty}` : '';
    qty.style.cssText = `
      font-family: Montserrat, sans-serif;
      font-size: 11px;
      color: rgba(160, 245, 255, 0.9);
    `;

    card.append(label, qty);
    return card;
  }

  private static _animateCount(
    el: HTMLElement,
    target: number,
    durationMs: number,
    suffix: string,
  ): void {
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const value = Math.floor(target * t);
      el.textContent = `+${value} ${suffix}`;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = `+${target} ${suffix}`;
      }
    };
    requestAnimationFrame(tick);
  }

  private static async _resolveItemIcons(
    drops: readonly AggregatedDrop[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await Promise.all(
      drops.map(async (drop) => {
        const def = getItemById(drop.itemId);
        if (!def) {
          return;
        }
        const url = await MissionRewardsUI._resolveUrl(itemIconProjectPath(def.iconFile));
        if (url) {
          out.set(drop.itemId, url);
        }
      }),
    );
    return out;
  }

  private static _injectStyles(container: HTMLElement): void {
    const id = 'grim-mission-rewards-styles';
    if (container.querySelector(`#${id}`)) {
      return;
    }
    const st = document.createElement('style');
    st.id = id;
    st.textContent = `
      @keyframes grim-reward-drop-in {
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .grim-reward-uncommon {
        border-color: rgba(120, 200, 255, 0.55);
        box-shadow: 0 0 14px rgba(80, 160, 255, 0.35);
      }
      .grim-reward-rare {
        border-color: rgba(180, 120, 255, 0.65);
        box-shadow: 0 0 20px rgba(160, 80, 255, 0.45);
      }
      .grim-reward-legendary {
        border-color: rgba(255, 200, 80, 0.85);
        box-shadow: 0 0 28px rgba(255, 180, 40, 0.55);
        animation-name: grim-reward-drop-in, grim-reward-legendary-pulse;
        animation-duration: 0.45s, 1.2s;
        animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1), ease-in-out;
        animation-iteration-count: 1, infinite;
        animation-fill-mode: forwards, none;
      }
      @keyframes grim-reward-legendary-pulse {
        0%, 100% { filter: brightness(1); }
        50% { filter: brightness(1.18); }
      }
    `;
    container.appendChild(st);
  }

  private static async _resolveUrl(projectPath: string): Promise<string> {
    return resolveProjectAssetUrl(projectPath);
  }
}
