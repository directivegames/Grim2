/**
 * UpgradeShopUI — Grim's upgrade shop on the Burdenville map.
 * Tabs: UPGRADES (stats), SKILLS, SHOP (materials).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { getItemById } from '../data/items.js';
import { SHOP_ITEMS, type ShopItemDef } from '../data/shop-items.js';
import {
  GRIM_STAT_UPGRADES,
  SKILL_UPGRADES,
  type GrimStatUpgradeDef,
  type ItemCost,
  type SkillUpgradeDef,
} from '../data/upgrades.js';
import { GRIM_GRINDER_SKILL_ID } from '../data/grim-grinder-config.js';
import { grimVault } from '../game/GrimVault.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { withMenuSelectSound } from '../utils/menu-audio.js';
import { injectBreeSerifFont } from './uiTypography.js';
import { ShopItemIconsHUDUI } from './ShopItemIconsHUDUI.js';
import { GrimGrinderHUDUI } from './GrimGrinderHUDUI.js';
import {
  formatStatBonusPerLevel,
  skillCurrentDescription,
  skillLevelPips,
} from './upgrade-shop-format.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { ensureMobileMenuStyles } from './mobile-menus-layout.js';
import { MobileCombatChromeUI } from './MobileCombatChromeUI.js';

const BG_URL = '@project/assets/UI/Shopbackground.webp';
const UPGRADE_WINDOW_URL = '@project/assets/UI/Upgradewindow.webp';
const SHOP_WINDOW_URL = '@project/assets/UI/shopwindow.webp';
const BTN_URL = '@project/assets/UI/menuelement.webp';
const SHOP_OVERLAY_ATTR = 'data-grim-upgrade-shop';

const ACTION_BTN_WIDTH = '152px';
const ACTION_BTN_ASPECT = 3.4;
const CLOSE_BTN_WIDTH = 'min(220px, 56%)';
const SHOP_TOAST_ATTR = 'data-grim-shop-toast';
const SOULS_COUNTER_ATTR = 'data-grim-shop-souls-counter';
const SHOP_SOULS_SHAKE_CLASS = 'grim-shop-souls-shake';
const SHOP_ITEM_ICON_SIZE = 52;
const COST_CHIP_ICON_SIZE = 24;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };
type ShopTab = 'upgrades' | 'skills' | 'shop';

/** Same asset resolution as FistAbilityHUDUI / MapUI. */
async function resolveAssetUrl(projectPath: string): Promise<string> {
  const direct = (await ENGINE.resolveAssetPathsInText(projectPath)).trim();
  if (direct && !direct.includes('@project')) {
    return direct;
  }

  const resolved = await ENGINE.resolveAssetPathsInText(`url("${projectPath}")`);
  const match = resolved.match(/url\(["']([^"']+)["']\)/);
  const url = (match?.[1] ?? '').trim();
  return url.includes('@project') ? '' : url;
}

function preloadImage(url: string, timeoutMs = 800): Promise<boolean> {
  if (!url) {
    return Promise.resolve(false);
  }
  if (typeof Image === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const t = window.setTimeout(() => finish(false), timeoutMs);
    img.onload = () => {
      window.clearTimeout(t);
      finish(true);
    };
    img.onerror = () => {
      window.clearTimeout(t);
      finish(false);
    };
    img.src = url;
  });
}

export class UpgradeShopUI {
  private static readonly byWorld = new Map<ENGINE.World, UpgradeShopUI>();

  private readonly _world: ENGINE.World;
  private _overlay: HTMLDivElement | null = null;
  private _windowFrame: HTMLDivElement | null = null;
  private _listHost: HTMLDivElement | null = null;
  private _soulsEl: HTMLSpanElement | null = null;
  private _soulsWrap: HTMLDivElement | null = null;
  private _mounting = false;
  private _tab: ShopTab = 'upgrades';
  private _bgUrl = '';
  private _upgradeWindowUrl = '';
  private _shopWindowUrl = '';
  private _btnUrl = '';

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static open(world: ENGINE.World): void {
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    let inst = UpgradeShopUI.byWorld.get(world);
    if (inst?._overlay || inst?._mounting) {
      if (inst._overlay) {
        inst._refresh();
      }
      return;
    }

    if (!inst) {
      inst = new UpgradeShopUI(world);
      UpgradeShopUI.byWorld.set(world, inst);
    }
    void inst._mount();
  }

  public static isOpen(world: ENGINE.World): boolean {
    return Boolean(UpgradeShopUI.byWorld.get(world)?._overlay);
  }

  public static close(world: ENGINE.World): void {
    UpgradeShopUI.byWorld.get(world)?._destroy();
  }

  private async _mount(): Promise<void> {
    if (this._overlay || this._mounting) {
      return;
    }
    this._mounting = true;
    try {
      await this._mountInner();
    } finally {
      this._mounting = false;
    }
  }

  private async _mountInner(): Promise<void> {
    const gc = (this._world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    await injectBreeSerifFont();
    [this._bgUrl, this._upgradeWindowUrl, this._shopWindowUrl, this._btnUrl] = await Promise.all([
      resolveAssetUrl(BG_URL),
      resolveAssetUrl(UPGRADE_WINDOW_URL),
      resolveAssetUrl(SHOP_WINDOW_URL),
      resolveAssetUrl(BTN_URL),
    ]);

    await ShopItemIconsHUDUI.getInstance(this._world);

    const backdrop = document.createElement('div');
    backdrop.setAttribute(SHOP_OVERLAY_ATTR, '');
    if (isMobileDevice()) {
      backdrop.classList.add('grim-shop-mobile');
    }
    // Keep hidden until icons are warmed in cache (prevents broken-image flash).
    backdrop.style.opacity = '0';
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10080;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      pointer-events: auto;
      overflow: hidden;
      ${this._bgUrl
        ? `background: url("${this._bgUrl}") center / cover no-repeat;`
        : 'background: rgba(5, 5, 10, 0.95);'}
    `;

    const vignette = document.createElement('div');
    vignette.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
      pointer-events: none;
    `;
    backdrop.appendChild(vignette);

    const soulsWrap = document.createElement('div');
    soulsWrap.setAttribute(SOULS_COUNTER_ATTR, '');
    this._soulsWrap = soulsWrap;
    soulsWrap.style.cssText = `
      position: absolute;
      top: clamp(12px, 2vh, 24px);
      right: clamp(16px, 3vw, 32px);
      z-index: 3;
      padding: 8px 16px;
      background: rgba(8, 10, 14, 0.82);
      border: 1px solid rgba(160, 120, 255, 0.45);
      border-radius: 6px;
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(16px, 2.5vw, 22px);
      color: #e8d4ff;
      letter-spacing: 0.06em;
      text-shadow: 0 0 12px rgba(160, 80, 255, 0.5);
    `;
    soulsWrap.textContent = 'Souls: ';
    this._soulsEl = document.createElement('span');
    this._soulsEl.style.color = '#fff';
    soulsWrap.appendChild(this._soulsEl);

    const tabRow = document.createElement('div');
    tabRow.style.cssText = `
      position: relative;
      z-index: 3;
      display: flex;
      gap: 10px;
      margin-bottom: clamp(8px, 1.5vh, 16px);
      flex-wrap: wrap;
      justify-content: center;
    `;
    tabRow.append(
      this._createTabButton('UPGRADES', 'upgrades'),
      this._createTabButton('SKILLS', 'skills'),
      this._createTabButton('SHOP', 'shop'),
    );

    this._windowFrame = document.createElement('div');
    this._windowFrame.style.cssText = `
      position: relative;
      z-index: 2;
      width: min(520px, 92vw);
      aspect-ratio: 520 / 620;
      max-height: min(72vh, 620px);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    `;

    this._listHost = document.createElement('div');
    this._listHost.setAttribute('data-grim-shop-list', '');
    this._listHost.style.cssText = `
      position: absolute;
      left: 10%;
      right: 10%;
      top: 22%;
      bottom: 14%;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 2px;
      box-sizing: border-box;
    `;
    this._windowFrame.appendChild(this._listHost);

    const closeBtn = this._createActionButton('CLOSE', true, () => {
      this._destroy();
    }, undefined, true);
    closeBtn.classList.add('grim-shop-close');
    closeBtn.style.cssText += `
      position: relative;
      z-index: 3;
      margin: clamp(8px, 1vh, 14px) auto 0;
      align-self: center;
    `;

    const stack = document.createElement('div');
    stack.style.cssText = `
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-width: min(560px, 96vw);
      padding: clamp(24px, 4vh, 40px) 12px;
      box-sizing: border-box;
    `;
    stack.append(tabRow, this._windowFrame, closeBtn);

    backdrop.append(soulsWrap, stack);
    gc.appendChild(backdrop);
    this._overlay = backdrop;
    UpgradeShopUI._injectSoulsShakeStyles(gc);
    ensureMobileMenuStyles(gc);

    this._applyWindowFrame();
    this._refresh();

    MobileCombatChromeUI.attach(this._world)?.refreshVisibility();

    requestAnimationFrame(() => {
      if (!this._overlay) return;
      this._overlay.style.transition = 'opacity 0.18s ease';
      this._overlay.style.opacity = '1';
    });
  }

  private _applyWindowFrame(): void {
    if (!this._windowFrame) {
      return;
    }
    const url =
      this._tab === 'shop' ? this._shopWindowUrl : this._upgradeWindowUrl;
    if (url) {
      this._windowFrame.style.backgroundImage = `url("${url}")`;
      this._windowFrame.style.backgroundSize = '100% 100%';
      this._windowFrame.style.backgroundRepeat = 'no-repeat';
      this._windowFrame.style.backgroundPosition = 'center';
    } else {
      this._windowFrame.style.background = 'rgba(12, 14, 18, 0.92)';
      this._windowFrame.style.border = '2px solid rgba(120, 140, 160, 0.4)';
    }
  }

  private _createTabButton(label: string, tab: ShopTab): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.shopTab = tab;
    btn.style.cssText = `
      padding: 8px 20px;
      font-family: Montserrat, sans-serif;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.14em;
      cursor: pointer;
      border-radius: 4px;
      border: 1px solid rgba(180, 140, 80, 0.5);
      background: rgba(20, 14, 8, 0.85);
      color: rgba(255, 232, 200, 0.95);
    `;
    btn.addEventListener('click', withMenuSelectSound(this._world, () => {
      this._tab = tab;
      this._applyWindowFrame();
      this._refresh();
    }));
    return btn;
  }

  private _refresh(): void {
    if (!this._listHost || !this._soulsEl) {
      return;
    }

    this._soulsEl.textContent = String(grimVault.getSouls());

    const tabButtons = this._overlay?.querySelectorAll<HTMLButtonElement>('button[data-shop-tab]');
    tabButtons?.forEach((btn) => {
      const active = btn.dataset.shopTab === this._tab;
      btn.style.borderColor = active ? 'rgba(255, 200, 120, 0.9)' : 'rgba(180, 140, 80, 0.5)';
      btn.style.boxShadow = active ? '0 0 14px rgba(255, 180, 60, 0.45)' : 'none';
      btn.style.background = active ? 'rgba(40, 28, 12, 0.95)' : 'rgba(20, 14, 8, 0.85)';
    });

    this._listHost.replaceChildren();
    if (this._tab === 'upgrades') {
      for (const def of GRIM_STAT_UPGRADES) {
        this._listHost.appendChild(this._buildStatRow(def));
      }
    } else if (this._tab === 'skills') {
      for (const def of SKILL_UPGRADES) {
        this._listHost.appendChild(this._buildSkillRow(def));
      }
    } else {
      const listed = grimVault.getListedShopItems();
      if (listed.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No shop items available.';
        empty.style.cssText = this._rowHintStyle();
        this._listHost.appendChild(empty);
      }
      for (const entry of listed) {
        this._listHost.appendChild(this._buildShopRow(entry));
      }
    }
  }

  private _rowHintStyle(): string {
    return `
      margin: 8px 4px;
      font-family: Montserrat, sans-serif;
      font-size: 12px;
      color: rgba(200, 210, 220, 0.85);
      text-align: center;
      line-height: 1.4;
    `;
  }

  private _buildStatRow(def: GrimStatUpgradeDef): HTMLDivElement {
    const level = grimVault.getStatLevel(def.id);
    const soulCost = grimVault.getNextStatSoulCost(def.id);
    const items = grimVault.getNextStatItemCosts(def.id);
    const canBuy = grimVault.canAffordStatUpgrade(def.id);

    const row = this._createRowShell();
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = `${def.name} · Lv ${level}`;
    name.style.cssText = this._rowTitleStyle();

    const desc = document.createElement('div');
    const cur = grimVault.computeStats();
    const next = grimVault.computeStatsWithStatLevelOverride(def.id, level + 1);
    const preview = this._formatStatPreview(def, cur[def.statKey], next[def.statKey]);
    desc.textContent = `${def.description}  ${preview}  (${formatStatBonusPerLevel(def)} per level)`;
    desc.style.cssText = this._rowDescStyle();

    const cost = document.createElement('div');
    cost.style.cssText = this._rowCostStyle();
    cost.appendChild(this._buildCostLine(soulCost, items));

    info.append(name, desc, cost);
    const buy = this._createActionButton('BUY', canBuy, () => {
      if (grimVault.purchaseStatUpgrade(def.id)) {
        const pawn = this._world.getFirstPlayerPawn();
        if (pawn instanceof IsometricPlayerPawn) {
          pawn.applyGrimVaultStats();
        }
        this._refresh();
      }
    }, () => this._showPurchaseBlockedFeedback(soulCost, items));
    row.append(info, buy);
    return row;
  }

  private _formatStatPreview(def: GrimStatUpgradeDef, cur: number, next: number): string {
    const clamp = (n: number): number => (Number.isFinite(n) ? n : 0);
    const a = clamp(cur);
    const b = clamp(next);

    switch (def.statKey) {
      case 'maxHealth':
        return `Max HP: ${Math.round(a)} → ${Math.round(b)}`;
      case 'moveSpeed':
        return `Speed: ${a.toFixed(1)} → ${b.toFixed(1)}`;
      case 'attackMult':
        return `Damage: ${a.toFixed(2)}× → ${b.toFixed(2)}×`;
      case 'defence':
      case 'poisonRes':
      case 'possessionRes':
      case 'fearRes':
      case 'critChance':
      case 'luck': {
        const pctA = Math.round(a * 100);
        const pctB = Math.round(b * 100);
        return `${def.statKey}: ${pctA}% → ${pctB}%`;
      }
      case 'soulHeal':
        return `Leech: ${a.toFixed(2)} → ${b.toFixed(2)} HP/kill`;
      default:
        return `${def.statKey}: ${a} → ${b}`;
    }
  }

  private _buildSkillRow(def: SkillUpgradeDef): HTMLDivElement {
    const level = grimVault.getSkillLevel(def.id);
    const atMax = level >= def.maxLevel;
    const locked = def.comingSoon;

    const row = this._createRowShell();
    row.style.opacity = locked ? '0.55' : '1';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = locked
      ? `${def.name} · COMING SOON`
      : `${def.name} · ${skillLevelPips(level, def.maxLevel)}`;
    name.style.cssText = this._rowTitleStyle();

    const desc = document.createElement('div');
    desc.textContent = locked
      ? def.description
      : skillCurrentDescription(def, level);
    desc.style.cssText = this._rowDescStyle();

    const cost = document.createElement('div');
    cost.style.cssText = this._rowCostStyle();
    if (locked) {
      cost.textContent = 'Gameplay unlock coming soon.';
    } else if (atMax) {
      cost.textContent = 'MAX LEVEL';
    } else {
      const soulCost = grimVault.getNextSkillSoulCost(def.id);
      const items = grimVault.getNextSkillItemCosts(def.id);
      cost.appendChild(this._buildCostLine(soulCost, items));
    }

    info.append(name, desc, cost);

    const canBuy = !locked && !atMax && grimVault.canAffordSkillUpgrade(def.id);
    const soulCost = grimVault.getNextSkillSoulCost(def.id);
    const items = grimVault.getNextSkillItemCosts(def.id);
    const buy = this._createActionButton(
      locked ? 'LOCKED' : atMax ? 'MAX' : 'UPGRADE',
      canBuy,
      () => {
        const wasGrimGrinderUnlocked = grimVault.hasGrimGrinderUnlocked();
        if (grimVault.purchaseSkillUpgrade(def.id)) {
          if (def.id === GRIM_GRINDER_SKILL_ID && !wasGrimGrinderUnlocked) {
            this._showTransformUnlockPopup();
            void GrimGrinderHUDUI.getInstance(this._world);
          }
          this._refresh();
        }
      },
      () => this._showPurchaseBlockedFeedback(soulCost, items),
    );
    if (locked || atMax) {
      buy.style.opacity = '0.45';
      buy.style.pointerEvents = 'none';
    }

    row.append(info, buy);
    return row;
  }

  private _buildShopRow(entry: ShopItemDef): HTMLDivElement {
    const item = getItemById(entry.itemId);
    const name = item?.name ?? entry.itemId;
    const owned = grimVault.getItemQty(entry.itemId);
    const price = grimVault.getShopSoulPrice(entry.itemId);
    const canBuy = grimVault.canPurchaseShopItem(entry.itemId);
    const bought = grimVault.getShopPurchaseCount(entry.itemId);

    const row = this._createRowShell();
    const info = document.createElement('div');
    info.style.display = 'flex';
    info.style.gap = '10px';
    info.style.alignItems = 'flex-start';

    info.appendChild(this._createItemIcon(entry.itemId, SHOP_ITEM_ICON_SIZE, name));

    const textCol = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = name;
    title.style.cssText = this._rowTitleStyle();

    const desc = document.createElement('div');
    desc.textContent = item?.description ?? '';
    desc.style.cssText = this._rowDescStyle();

    const meta = document.createElement('div');
    meta.style.cssText = this._rowCostStyle();
    meta.textContent = `Owned: ${owned} · Bought: ${bought} · ${price} souls`;

    textCol.append(title, desc, meta);
    info.appendChild(textCol);

    const buy = this._createActionButton('BUY', canBuy, () => {
      if (grimVault.purchaseShopItem(entry.itemId)) {
        this._refresh();
      }
    }, () => {
      if (grimVault.getSouls() < price) {
        this._feedbackNotEnoughSouls();
      }
    });
    row.append(info, buy);
    return row;
  }

  private _createRowShell(): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'grim-shop-row';
    row.style.cssText = `
      display: grid;
      grid-template-columns: 1fr minmax(${ACTION_BTN_WIDTH}, 42%);
      gap: 12px 14px;
      align-items: center;
      padding: 10px 12px;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(80, 70, 60, 0.5);
      border-radius: 4px;
    `;
    return row;
  }

  private _rowTitleStyle(): string {
    return `
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 12px;
      letter-spacing: 0.05em;
      color: rgba(240, 235, 220, 0.98);
    `;
  }

  private _rowDescStyle(): string {
    return `
      margin-top: 3px;
      font-family: Montserrat, sans-serif;
      font-size: 10px;
      color: rgba(180, 175, 165, 0.9);
      line-height: 1.35;
    `;
  }

  private _rowCostStyle(): string {
    return `
      margin-top: 5px;
      font-family: Montserrat, sans-serif;
      font-size: 10px;
      color: rgba(200, 180, 255, 0.9);
    `;
  }

  private _buildCostLine(soulCost: number, items: readonly ItemCost[]): HTMLDivElement {
    const wrap = document.createElement('div');
    const souls = document.createElement('span');
    souls.textContent = `${soulCost} souls`;
    wrap.appendChild(souls);
    if (items.length > 0) {
      wrap.appendChild(this._buildItemChips(items));
    }
    return wrap;
  }

  private _createItemIcon(itemId: string, sizePx: number, alt = ''): HTMLDivElement {
    const item = getItemById(itemId);
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width: ${sizePx}px;
      height: ${sizePx}px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      background: rgba(0, 0, 0, 0.35);
      overflow: hidden;
    `;

    const img = document.createElement('img');
    img.alt = alt || item?.name || itemId;
    img.style.cssText =
      'width: 100%; height: 100%; object-fit: contain; display: block;';
    const url = ShopItemIconsHUDUI.getUrl(this._world, itemId);
    if (url) {
      img.src = url;
    }
    wrap.appendChild(img);
    return wrap;
  }

  private _buildItemChips(items: readonly ItemCost[]): HTMLDivElement {
    const chips = document.createElement('div');
    chips.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;';

    const entries: { itemId: string; qty: number }[] = [];
    for (const cost of items) {
      if (cost.oneOf?.length) {
        for (const opt of cost.oneOf) {
          entries.push(opt);
        }
      } else {
        entries.push({ itemId: cost.itemId, qty: cost.qty });
      }
    }

    for (const entry of entries) {
      const have = grimVault.getItemQty(entry.itemId);
      const chip = document.createElement('span');
      chip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 7px 3px 4px;
        border-radius: 4px;
        font-size: 10px;
        font-family: Montserrat, sans-serif;
        background: rgba(0, 0, 0, 0.4);
        border: 1px solid ${have >= entry.qty ? 'rgba(80, 200, 120, 0.5)' : 'rgba(200, 80, 80, 0.45)'};
      `;
      chip.appendChild(this._createItemIcon(entry.itemId, COST_CHIP_ICON_SIZE));
      chip.append(`${have}/${entry.qty}`);
      chips.appendChild(chip);
    }
    return chips;
  }

  private _feedbackNotEnoughSouls(): void {
    this._shakeSoulsCounter();
    this._showToast('Not enough souls — earn souls by reaping enemies!');
  }

  private _shakeSoulsCounter(): void {
    const wrap = this._soulsWrap;
    if (!wrap) {
      return;
    }
    wrap.classList.remove(SHOP_SOULS_SHAKE_CLASS);
    void wrap.offsetWidth;
    wrap.classList.add(SHOP_SOULS_SHAKE_CLASS);
    wrap.style.borderColor = 'rgba(255, 90, 90, 0.9)';
    wrap.style.boxShadow = '0 0 18px rgba(255, 60, 60, 0.55)';
    const clearHighlight = (): void => {
      wrap.classList.remove(SHOP_SOULS_SHAKE_CLASS);
      wrap.style.borderColor = 'rgba(160, 120, 255, 0.45)';
      wrap.style.boxShadow = '';
    };
    wrap.addEventListener('animationend', clearHighlight, { once: true });
    window.setTimeout(clearHighlight, 520);
  }

  private static _injectSoulsShakeStyles(container: HTMLElement): void {
    const id = 'grim-shop-souls-shake-styles';
    if (container.querySelector(`#${id}`)) {
      return;
    }
    const st = document.createElement('style');
    st.id = id;
    st.textContent = `
      @keyframes grim-shop-souls-shake {
        0%, 100% { transform: translateX(0); }
        12% { transform: translateX(-10px); }
        24% { transform: translateX(10px); }
        36% { transform: translateX(-8px); }
        48% { transform: translateX(8px); }
        60% { transform: translateX(-5px); }
        72% { transform: translateX(5px); }
        84% { transform: translateX(-2px); }
      }
      [${SOULS_COUNTER_ATTR}].${SHOP_SOULS_SHAKE_CLASS} {
        animation: grim-shop-souls-shake 0.45s ease-in-out;
        color: #ffb8b8 !important;
      }
      [${SOULS_COUNTER_ATTR}].${SHOP_SOULS_SHAKE_CLASS} span {
        color: #ff6b6b !important;
        text-shadow: 0 0 14px rgba(255, 80, 80, 0.85);
      }
    `;
    container.appendChild(st);
  }

  private _showPurchaseBlockedFeedback(soulCost: number, items: readonly ItemCost[]): void {
    if (grimVault.getSouls() < soulCost) {
      this._feedbackNotEnoughSouls();
      return;
    }
    if (items.length > 0 && !grimVault.hasItems(items)) {
      this._showToast('Missing required materials for this upgrade.');
      return;
    }
    this._showToast('Cannot purchase this upgrade right now.');
  }

  private _showToast(message: string): void {
    if (!this._overlay) {
      return;
    }
    this._overlay.querySelector(`[${SHOP_TOAST_ATTR}]`)?.remove();

    const toast = document.createElement('div');
    toast.setAttribute(SHOP_TOAST_ATTR, '');
    toast.textContent = message;
    toast.style.cssText = `
      position: absolute;
      left: 50%;
      bottom: clamp(72px, 12vh, 120px);
      transform: translateX(-50%);
      z-index: 12;
      max-width: min(420px, 90vw);
      padding: 12px 20px;
      font-family: Montserrat, sans-serif;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
      text-align: center;
      color: rgba(255, 232, 200, 0.98);
      background: rgba(12, 8, 4, 0.92);
      border: 1px solid rgba(255, 180, 80, 0.55);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
    `;
    this._overlay.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });
    window.setTimeout(() => {
      toast.style.opacity = '0';
      window.setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  private _showTransformUnlockPopup(): void {
    const gc = (this._world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10090;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.55);
      padding: 24px;
      box-sizing: border-box;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      max-width: min(440px, 92vw);
      padding: 24px 28px;
      text-align: center;
      font-family: Montserrat, sans-serif;
      background: rgba(8, 12, 18, 0.95);
      border: 2px solid rgba(0, 220, 255, 0.5);
      border-radius: 8px;
      box-shadow: 0 0 28px rgba(0, 200, 255, 0.35);
    `;

    const title = document.createElement('div');
    title.textContent = 'TRANSFORM UNLOCKED';
    title.style.cssText = `
      font-weight: 800;
      font-size: clamp(14px, 2.5vw, 18px);
      letter-spacing: 0.14em;
      color: rgba(160, 245, 255, 0.98);
      text-shadow: 0 0 16px rgba(0, 220, 255, 0.45);
    `;

    const body = document.createElement('p');
    body.textContent =
      'Reap enough souls during a mission to activate transform, then press F.';
    body.style.cssText = `
      margin: 14px 0 0;
      font-size: 13px;
      line-height: 1.5;
      color: rgba(200, 220, 235, 0.92);
    `;

    panel.append(title, body);
    backdrop.appendChild(panel);

    const dismiss = (): void => {
      backdrop.remove();
    };
    backdrop.addEventListener('click', dismiss);
    panel.addEventListener('click', (e) => e.stopPropagation());

    gc.appendChild(backdrop);
    window.setTimeout(dismiss, 4500);
  }

  private _createActionButton(
    label: string,
    enabled: boolean,
    onClick: () => void,
    onDisabledClick?: () => void,
    wide = false,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'grim-shop-action';
    wrap.style.cssText = `
      width: ${wide ? CLOSE_BTN_WIDTH : '100%'};
      max-width: ${wide ? 'none' : ACTION_BTN_WIDTH};
      aspect-ratio: ${ACTION_BTN_ASPECT} / 1;
      box-sizing: border-box;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: ${enabled ? 'pointer' : 'not-allowed'};
      opacity: ${enabled ? '1' : '0.45'};
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: clamp(10px, 1.6vw, 12px);
      letter-spacing: 0.12em;
      color: rgba(255, 240, 210, 0.95);
      white-space: nowrap;
      transition: transform 0.15s ease, filter 0.15s ease;
    `;
    if (this._btnUrl) {
      wrap.style.backgroundImage = `url("${this._btnUrl}")`;
      wrap.style.backgroundSize = '100% auto';
      wrap.style.backgroundRepeat = 'no-repeat';
      wrap.style.backgroundPosition = 'center';
    } else {
      wrap.style.border = '1px solid rgba(180, 140, 80, 0.55)';
      wrap.style.borderRadius = '4px';
    }
    wrap.textContent = label;
    if (enabled) {
      wrap.addEventListener('click', withMenuSelectSound(this._world, onClick));
      wrap.addEventListener('mouseenter', () => {
        wrap.style.transform = 'scale(1.04)';
        wrap.style.filter = 'brightness(1.1)';
      });
      wrap.addEventListener('mouseleave', () => {
        wrap.style.transform = 'scale(1)';
        wrap.style.filter = 'brightness(1)';
      });
    } else if (onDisabledClick) {
      wrap.style.pointerEvents = 'auto';
      wrap.addEventListener('click', withMenuSelectSound(this._world, onDisabledClick));
    }
    return wrap;
  }

  private _collectItemIds(cost: ItemCost, ids: Set<string>): void {
    if (cost.oneOf?.length) {
      for (const opt of cost.oneOf) {
        ids.add(opt.itemId);
      }
    } else {
      ids.add(cost.itemId);
    }
  }

  private _destroy(): void {
    this._overlay?.remove();
    this._overlay = null;
    this._windowFrame = null;
    this._listHost = null;
    this._soulsEl = null;
    this._soulsWrap = null;
    UpgradeShopUI.byWorld.delete(this._world);
    MobileCombatChromeUI.attach(this._world)?.refreshVisibility();
  }
}
