/**
 * ShopItemIconsHUDUI — every SHOP tab item icon mounted EXACTLY like BoneShardIconTestHUDUI / FistAbilityHUDUI.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { getItemById } from '../data/items.js';
import { SHOP_ITEMS } from '../data/shop-items.js';

/** Hardcoded @project paths — same as BoneShardIconTestHUDUI. */
const SHOP_ITEM_ICON_URLS: Record<string, string> = {
  bone_shard: '@project/assets/UI/Boneshard.png',
  cursed_vial: '@project/assets/UI/cursedvial.png',
  soul_crystal: '@project/assets/UI/soulcrystal.png',
  grim_ember: '@project/assets/UI/grimember.png',
  void_relic: '@project/assets/UI/voidrelic.png',
  brute_core: '@project/assets/UI/brutecore.png',
};

const SHOP_ITEM_KEY_HINTS: Record<string, string> = {
  bone_shard: 'BONE',
  cursed_vial: 'CURS',
  soul_crystal: 'SOUL',
  grim_ember: 'EMBR',
  void_relic: 'VOID',
  brute_core: 'BRUT',
};

/** Match HealthBarUI / FistAbilityHUDUI placement. */
const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const ICON_SIZE = 52;
const GAP_ABOVE_HEALTH = 10;
const GAP_BESIDE_FIST = 12;
const FIST_LEFT = 36;
const ROW_START_LEFT = FIST_LEFT + ICON_SIZE + GAP_BESIDE_FIST;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

type ShopIconSlot = {
  itemId: string;
  container: HTMLDivElement;
  iconEl: HTMLImageElement;
};

export class ShopItemIconsHUDUI {
  private static readonly instances = new Map<ENGINE.World, ShopItemIconsHUDUI>();

  private readonly _world: ENGINE.World;
  private readonly _slots: ShopIconSlot[] = [];
  private readonly _urls = new Map<string, string>();
  private _initPromise: Promise<void> | null = null;

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static async getInstance(world: ENGINE.World | null): Promise<ShopItemIconsHUDUI | null> {
    if (!world) {
      return null;
    }

    let inst = ShopItemIconsHUDUI.instances.get(world);
    if (!inst) {
      inst = new ShopItemIconsHUDUI(world);
      ShopItemIconsHUDUI.instances.set(world, inst);
      inst._initPromise = inst._initializeAsync();
    }

    if (inst._initPromise) {
      await inst._initPromise;
    }
    return inst;
  }

  public static getUrl(world: ENGINE.World, itemId: string): string {
    return ShopItemIconsHUDUI.instances.get(world)?._urls.get(itemId) ?? '';
  }

  private async _initializeAsync(): Promise<void> {
    const gc = (this._world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH;

    for (let i = 0; i < SHOP_ITEMS.length; i++) {
      const shopEntry = SHOP_ITEMS[i];
      const itemId = shopEntry.itemId;
      const iconUrl = SHOP_ITEM_ICON_URLS[itemId];
      if (!iconUrl) {
        continue;
      }

      const itemDef = getItemById(itemId);
      const left = ROW_START_LEFT + i * (ICON_SIZE + GAP_BESIDE_FIST);

      const container = document.createElement('div');
      container.setAttribute('data-grim-shop-item-icon', itemId);
      container.style.cssText = `
        position: absolute;
        bottom: ${bottom}px;
        left: ${left}px;
        display: none;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        pointer-events: none;
        user-select: none;
        z-index: 1002;
        opacity: 0;
        will-change: opacity, filter;
      `;

      const keyHint = document.createElement('span');
      keyHint.textContent = SHOP_ITEM_KEY_HINTS[itemId] ?? itemId.slice(0, 4).toUpperCase();
      keyHint.style.cssText = `
        font-family: Montserrat, sans-serif;
        font-weight: 800;
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0.06em;
        color: rgba(220, 210, 200, 0.95);
        text-shadow:
          0 0 6px rgba(0, 0, 0, 0.9),
          0 1px 2px rgba(0, 0, 0, 0.85);
      `;

      const iconWrap = document.createElement('div');
      iconWrap.style.cssText = `
        position: relative;
        width: ${ICON_SIZE}px;
        height: ${ICON_SIZE}px;
      `;

      const iconEl = document.createElement('img');
      iconEl.alt = itemDef?.name ?? itemId;
      iconEl.style.cssText = `
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
        transition: filter 0.15s ease, opacity 0.15s ease;
        filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
      `;

      iconWrap.append(iconEl);
      container.append(keyHint, iconWrap);
      gc.appendChild(container);

      this._slots.push({ itemId, container, iconEl });

      const resolved = await ENGINE.resolveAssetPathsInText(iconUrl);
      iconEl.src = resolved;
      this._urls.set(itemId, resolved);

      container.style.display = 'flex';
      requestAnimationFrame(() => {
        container.style.transition = 'opacity 0.3s ease';
        container.style.opacity = '0';
      });
    }
  }

  public destroy(): void {
    for (const slot of this._slots) {
      slot.container.remove();
    }
    this._slots.length = 0;
    this._urls.clear();
    this._initPromise = null;
    ShopItemIconsHUDUI.instances.delete(this._world);
  }
}
