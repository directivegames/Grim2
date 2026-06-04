/**
 * ItemCollectedToastUI — brief “{name} collected” toast above the soul counter.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { getItemById, itemIconProjectPath, type ItemRarity } from '../data/items.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { resolveProjectAssetUrl } from '../utils/resolve-project-asset.js';
import { injectBreeSerifFont } from './uiTypography.js';

/** Match SoulCounterUI placement (desktop). */
const SOULS_BG_HEIGHT = 302;
const UI_SCALE = 0.35;
const SOUL_COUNTER_BOTTOM = 20;
const SOUL_COUNTER_RIGHT = 20;
const GAP_ABOVE_SOUL_COUNTER = 10;

const TOAST_BOTTOM =
  SOUL_COUNTER_BOTTOM + SOULS_BG_HEIGHT * UI_SCALE + GAP_ABOVE_SOUL_COUNTER;
const TOAST_WIDTH = 688 * UI_SCALE;

const DISPLAY_MS = 2800;
const FADE_MS = 400;

const RARITY_ACCENT: Record<ItemRarity, string> = {
  common: 'rgba(180, 190, 200, 0.55)',
  uncommon: 'rgba(120, 200, 140, 0.65)',
  rare: 'rgba(100, 180, 255, 0.7)',
  legendary: 'rgba(255, 190, 90, 0.85)',
};

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class ItemCollectedToastUI {
  private static readonly instances = new Map<ENGINE.World, ItemCollectedToastUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _hideTimer = 0;
  private _iconUrlCache = new Map<string, string>();
  private _mobile = false;

  public static async notify(world: ENGINE.World, itemId: string): Promise<void> {
    const ui = await ItemCollectedToastUI.getInstance(world);
    await ui.show(itemId);
  }

  public static hideForWorld(world: ENGINE.World): void {
    ItemCollectedToastUI.instances.get(world)?.hide();
  }

  public static async getInstance(world: ENGINE.World): Promise<ItemCollectedToastUI> {
    let inst = ItemCollectedToastUI.instances.get(world);
    if (!inst) {
      inst = new ItemCollectedToastUI(world);
      ItemCollectedToastUI.instances.set(world, inst);
      inst._buildDom();
      await injectBreeSerifFont();
    }
    return inst;
  }

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  private _gameContainer(): HTMLElement | null {
    if (!this._world) return null;
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private _buildDom(): void {
    const gc = this._gameContainer();
    if (!gc || this._container) return;

    this._mobile = isMobileDevice();
    const mobile = this._mobile;
    // Mobile: centre at bottom of screen, 50% of desktop width.
    const positionCss = mobile
      ? `bottom: max(24px, env(safe-area-inset-bottom, 0px) + 24px);
         left: 50%;
         right: auto;
         transform: translateX(-50%) translateY(8px);
         width: clamp(140px, 38vw, 200px);`
      : `bottom: ${TOAST_BOTTOM}px;
         right: ${SOUL_COUNTER_RIGHT}px;
         left: auto;
         width: ${TOAST_WIDTH}px;`;

    this._container = document.createElement('div');
    this._container.setAttribute('data-item-collected-toast', '');
    this._container.style.cssText = `
      position: absolute;
      ${positionCss}
      z-index: 1001;
      pointer-events: none;
      user-select: none;
      display: none;
      opacity: 0;
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
    `;
    gc.appendChild(this._container);
  }

  public async show(itemId: string): Promise<void> {
    if (!this._container) return;

    const def = getItemById(itemId);
    if (!def) return;

    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = 0;
    }

    let iconUrl = this._iconUrlCache.get(itemId);
    if (!iconUrl) {
      iconUrl = await resolveProjectAssetUrl(itemIconProjectPath(def.iconFile));
      if (iconUrl) {
        this._iconUrlCache.set(itemId, iconUrl);
      }
    }

    this._container.replaceChildren();
    this._container.appendChild(this._buildToastRow(def.name, def.rarity, iconUrl ?? ''));

    const xShift = this._mobile ? 'translateX(-50%) ' : '';
    this._container.style.display = 'flex';
    this._container.style.opacity = '0';
    this._container.style.transform = `${xShift}translateY(8px)`;

    requestAnimationFrame(() => {
      if (!this._container) return;
      this._container.style.opacity = '1';
      this._container.style.transform = `${xShift}translateY(0)`;
    });

    this._hideTimer = globalThis.setTimeout(() => this._fadeOut(), DISPLAY_MS) as unknown as number;
  }

  public hide(): void {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = 0;
    }
    if (!this._container) return;
    this._container.style.display = 'none';
    this._container.style.opacity = '0';
    this._container.replaceChildren();
  }

  public destroy(): void {
    this.hide();
    this._container?.remove();
    this._container = null;
    if (this._world) {
      ItemCollectedToastUI.instances.delete(this._world);
    }
  }

  private _fadeOut(): void {
    this._hideTimer = 0;
    if (!this._container) return;
    const xShift = this._mobile ? 'translateX(-50%) ' : '';
    this._container.style.opacity = '0';
    this._container.style.transform = `${xShift}translateY(-6px)`;
    globalThis.setTimeout(() => {
      if (this._container) {
        this._container.style.display = 'none';
        this._container.replaceChildren();
      }
    }, FADE_MS);
  }

  private _buildToastRow(name: string, rarity: ItemRarity, iconUrl: string): HTMLDivElement {
    const row = document.createElement('div');
    const pad = this._mobile ? '3px 8px' : '6px 12px';
    const gap = this._mobile ? '6px' : '10px';
    row.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: ${gap};
      padding: ${pad};
      border-radius: 6px;
      background: rgba(8, 10, 14, 0.88);
      border: 1px solid ${RARITY_ACCENT[rarity]};
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    `;

    const text = document.createElement('div');
    const fontSize = this._mobile ? 'clamp(9px, 2.4vw, 11px)' : 'clamp(11px, 1.6vw, 13px)';
    text.style.cssText = `
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-size: ${fontSize};
      font-weight: 700;
      letter-spacing: 0.04em;
      color: rgba(230, 236, 244, 0.98);
      text-align: right;
      line-height: 1.25;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    `;
    text.textContent = `${name} collected`;

    row.append(text);

    if (iconUrl) {
      const imgSize = this._mobile ? 18 : 32;
      const img = document.createElement('img');
      img.src = iconUrl;
      img.alt = name;
      img.style.cssText = `width: ${imgSize}px; height: ${imgSize}px; object-fit: contain; flex-shrink: 0;`;
      row.appendChild(img);
    }

    return row;
  }
}
