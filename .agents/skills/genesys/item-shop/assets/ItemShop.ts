/**
 * ItemShop.ts
 *
 * Currency-based shop with escalating item prices and discovery gating.
 * Items only appear in the shop after the player picks one up in a run,
 * unless marked unlockedByDefault.
 *
 * Usage: adapt the two config constants below, then export `shop`.
 * Zero dependencies outside this file.
 */

// ─── Adapt these two lines ────────────────────────────────────────────────────

const STORAGE_KEY = 'my-game-item-shop';

/** Replace with your own shop item definitions. */
const SHOP_ITEMS: readonly ShopItemDef[] = [];

// ─── Shop item definition ─────────────────────────────────────────────────────

export interface ShopItemDef {
  itemId: string;
  baseCurrencyPrice: number;
  /** Multiplier applied per lifetime purchase. 1.12 = +12% per buy. */
  priceMultiplier: number;
  /** Always visible without being discovered from a drop. */
  unlockedByDefault?: boolean;
}

/**
 * Current currency price for one unit.
 * `purchaseCount` is the number of times the player has already bought this item.
 */
export function shopPrice(def: ShopItemDef, purchaseCount: number): number {
  return Math.floor(def.baseCurrencyPrice * def.priceMultiplier ** Math.max(0, purchaseCount));
}

// ─── Profile schema ──────────────────────────────────────────────────────────

interface ShopProfile {
  currency: number;
  inventory: Partial<Record<string, number>>;
  discoveredItems: string[];
  shopPurchaseCounts: Partial<Record<string, number>>;
}

function defaultProfile(): ShopProfile {
  return {
    currency: 0,
    inventory: {},
    discoveredItems: SHOP_ITEMS.filter((s) => s.unlockedByDefault).map((s) => s.itemId),
    shopPurchaseCounts: {},
  };
}

function loadProfile(): ShopProfile {
  if (typeof localStorage === 'undefined') return defaultProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    const p = JSON.parse(raw) as Partial<ShopProfile>;

    const sanitizeInventory = (v: unknown): Partial<Record<string, number>> => {
      if (!v || typeof v !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, val] of Object.entries(v as object)) {
        if (typeof val === 'number' && val > 0 && Number.isFinite(val)) out[k] = Math.floor(val);
      }
      return out;
    };

    const sanitizeStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

    const sanitizeCounts = (v: unknown): Partial<Record<string, number>> => {
      if (!v || typeof v !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, val] of Object.entries(v as object)) {
        if (typeof val === 'number' && val >= 0 && Number.isFinite(val)) out[k] = Math.floor(val);
      }
      return out;
    };

    const discovered = sanitizeStringArray(p.discoveredItems);
    // Always include default-unlocked items even if missing from a legacy save.
    for (const def of SHOP_ITEMS) {
      if (def.unlockedByDefault && !discovered.includes(def.itemId)) {
        discovered.push(def.itemId);
      }
    }

    return {
      currency: typeof p.currency === 'number' && p.currency >= 0 && Number.isFinite(p.currency)
        ? Math.floor(p.currency) : 0,
      inventory: sanitizeInventory(p.inventory),
      discoveredItems: discovered,
      shopPurchaseCounts: sanitizeCounts(p.shopPurchaseCounts),
    };
  } catch {
    return defaultProfile();
  }
}

function saveProfile(p: ShopProfile): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ─── Store ────────────────────────────────────────────────────────────────────

class ItemShopStore {
  private _p: ShopProfile = defaultProfile();

  public init(): void { this._p = loadProfile(); }

  // ── Currency ───────────────────────────────────────────────────────────────

  public getCurrency(): number { return this._p.currency; }

  public addCurrency(n: number): void {
    if (n <= 0 || !Number.isFinite(n)) return;
    this._p.currency += Math.floor(n);
    this._save();
  }

  public spendCurrency(n: number): boolean {
    const cost = Math.floor(n);
    if (cost <= 0 || this._p.currency < cost) return false;
    this._p.currency -= cost;
    this._save();
    return true;
  }

  // ── Inventory ──────────────────────────────────────────────────────────────

  public getItemQty(itemId: string): number { return this._p.inventory[itemId] ?? 0; }

  public addItem(itemId: string, qty: number): void {
    const n = Math.floor(qty);
    if (n <= 0) return;
    this._p.inventory[itemId] = this.getItemQty(itemId) + n;
    this._save();
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  public discoverItem(itemId: string): void {
    if (!itemId || this._p.discoveredItems.includes(itemId)) return;
    this._p.discoveredItems.push(itemId);
    this._save();
  }

  public isDiscovered(itemId: string): boolean {
    const def = SHOP_ITEMS.find((s) => s.itemId === itemId);
    if (def?.unlockedByDefault) return true;
    return this._p.discoveredItems.includes(itemId);
  }

  // ── Shop ──────────────────────────────────────────────────────────────────

  public getListedItems(): ShopItemDef[] {
    return SHOP_ITEMS.filter((def) => this.isDiscovered(def.itemId));
  }

  public getPurchaseCount(itemId: string): number {
    return this._p.shopPurchaseCounts[itemId] ?? 0;
  }

  public getPrice(itemId: string): number {
    const def = SHOP_ITEMS.find((s) => s.itemId === itemId);
    return def ? shopPrice(def, this.getPurchaseCount(itemId)) : 0;
  }

  public canPurchase(itemId: string): boolean {
    return this.isDiscovered(itemId) && this._p.currency >= this.getPrice(itemId);
  }

  /**
   * Buy one unit. Deducts currency, adds to inventory, increments purchase count.
   * Returns false if not discovered or insufficient currency.
   */
  public purchase(itemId: string): boolean {
    if (!this.canPurchase(itemId)) return false;
    const price = this.getPrice(itemId);
    this._p.currency -= price;
    this.addItem(itemId, 1);
    this._p.shopPurchaseCounts[itemId] = this.getPurchaseCount(itemId) + 1;
    this._save();
    return true;
  }

  public reset(): void { this._p = defaultProfile(); this._save(); }

  private _save(): void { saveProfile(this._p); }
}

export const shop = new ItemShopStore();
