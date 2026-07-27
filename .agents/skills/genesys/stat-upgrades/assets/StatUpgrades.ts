/**
 * StatUpgrades.ts
 *
 * Infinite-level character stat upgrades with exponential currency cost,
 * item cost ladders, localStorage persistence, and optional diminishing returns.
 *
 * Usage: adapt the three config constants below, then export `statStore`.
 * Zero dependencies outside this file.
 */

// ─── Adapt these three lines ─────────────────────────────────────────────────

const STORAGE_KEY = 'my-game-stat-upgrades';

/** Base stat values before any upgrades are applied. */
const BASE_STATS: MyStats = {
  maxHealth: 100,
  attackMult: 1,
  defence: 0,
  moveSpeed: 5,
};

/** Replace with your own upgrade definitions. */
const STAT_UPGRADES: readonly StatUpgradeDef<keyof MyStats>[] = [];

// ─── Stats type — replace with your game's stats ─────────────────────────────

export interface MyStats {
  maxHealth: number;
  attackMult: number;
  defence: number;
  moveSpeed: number;
}

// ─── Item cost ────────────────────────────────────────────────────────────────

/**
 * One cost line in a purchase.
 * When `oneOf` is present, the primary `itemId`/`qty` are ignored.
 * The player may pay with any one option listed in `oneOf`.
 */
export interface ItemCost {
  itemId: string;
  qty: number;
  oneOf?: readonly { itemId: string; qty: number }[];
}

function satisfiesItemCost(getQty: (id: string) => number, cost: ItemCost): boolean {
  if (cost.oneOf && cost.oneOf.length > 0) {
    return cost.oneOf.some((o) => getQty(o.itemId) >= o.qty);
  }
  return getQty(cost.itemId) >= cost.qty;
}

function spendItemCost(
  getQty: (id: string) => number,
  setQty: (id: string, qty: number) => void,
  cost: ItemCost,
): boolean {
  if (cost.oneOf && cost.oneOf.length > 0) {
    const pick = cost.oneOf.find((o) => getQty(o.itemId) >= o.qty);
    if (!pick) return false;
    setQty(pick.itemId, Math.max(0, getQty(pick.itemId) - pick.qty));
    return true;
  }
  if (getQty(cost.itemId) < cost.qty) return false;
  setQty(cost.itemId, Math.max(0, getQty(cost.itemId) - cost.qty));
  return true;
}

// ─── Stat upgrade definition ──────────────────────────────────────────────────

export interface StatUpgradeDef<TStatKey extends string = string> {
  id: string;
  name: string;
  description: string;
  baseCurrencyCost: number;
  /** Currency cost multiplier per level purchased. 2 = doubles each step. */
  costMultiplier: number;
  /**
   * Item costs per purchase (index 0 = first buy).
   * Last entry repeats for all levels beyond the array length.
   * Use [] for a free level.
   */
  itemCostsPerLevel: readonly (readonly ItemCost[])[];
  statKey: TStatKey;
  /** Added to the stat per level purchased (flat or fractional). */
  statPerLevel: number;
}

export function getNextCurrencyCost<T extends string>(
  def: StatUpgradeDef<T>,
  currentLevel: number,
): number {
  return Math.floor(def.baseCurrencyCost * def.costMultiplier ** currentLevel);
}

export function getNextItemCosts<T extends string>(
  def: StatUpgradeDef<T>,
  currentLevel: number,
): readonly ItemCost[] {
  const ladder = def.itemCostsPerLevel;
  if (ladder.length === 0) return [];
  return ladder[Math.min(currentLevel, ladder.length - 1)] ?? [];
}

// ─── Profile schema ──────────────────────────────────────────────────────────

interface StatProfile {
  currency: number;
  statLevels: Partial<Record<string, number>>;
  inventory: Partial<Record<string, number>>;
}

function defaultProfile(): StatProfile {
  return { currency: 0, statLevels: {}, inventory: {} };
}

function loadProfile(): StatProfile {
  if (typeof localStorage === 'undefined') return defaultProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    const p = JSON.parse(raw) as Partial<StatProfile>;

    const sanitizeLevels = (v: unknown): Partial<Record<string, number>> => {
      if (!v || typeof v !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, val] of Object.entries(v as object)) {
        if (typeof val === 'number' && val >= 0 && Number.isFinite(val)) out[k] = Math.floor(val);
      }
      return out;
    };

    const sanitizeInventory = (v: unknown): Partial<Record<string, number>> => {
      if (!v || typeof v !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, val] of Object.entries(v as object)) {
        if (typeof val === 'number' && val > 0 && Number.isFinite(val)) out[k] = Math.floor(val);
      }
      return out;
    };

    return {
      currency: typeof p.currency === 'number' && p.currency >= 0 && Number.isFinite(p.currency)
        ? Math.floor(p.currency) : 0,
      statLevels: sanitizeLevels(p.statLevels),
      inventory: sanitizeInventory(p.inventory),
    };
  } catch {
    return defaultProfile();
  }
}

function saveProfile(p: StatProfile): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ─── Store ────────────────────────────────────────────────────────────────────

class StatUpgradeStore {
  private _p: StatProfile = defaultProfile();

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

  public hasItems(costs: readonly ItemCost[]): boolean {
    return costs.every((c) => satisfiesItemCost((id) => this.getItemQty(id), c));
  }

  public spendItems(costs: readonly ItemCost[]): boolean {
    if (!this.hasItems(costs)) return false;
    for (const c of costs) {
      spendItemCost(
        (id) => this.getItemQty(id),
        (id, qty) => {
          if (qty <= 0) delete this._p.inventory[id];
          else this._p.inventory[id] = qty;
        },
        c,
      );
    }
    this._save();
    return true;
  }

  // ── Stat upgrades ──────────────────────────────────────────────────────────

  public getLevel(statId: string): number { return this._p.statLevels[statId] ?? 0; }

  public getNextCurrencyCost(statId: string): number {
    const def = this._find(statId);
    return def ? getNextCurrencyCost(def, this.getLevel(statId)) : 0;
  }

  public getNextItemCosts(statId: string): readonly ItemCost[] {
    const def = this._find(statId);
    return def ? getNextItemCosts(def, this.getLevel(statId)) : [];
  }

  public canAfford(statId: string): boolean {
    return this._p.currency >= this.getNextCurrencyCost(statId) && this.hasItems(this.getNextItemCosts(statId));
  }

  public purchase(statId: string): boolean {
    if (!this._find(statId) || !this.canAfford(statId)) return false;
    this._p.currency -= this.getNextCurrencyCost(statId);
    this.spendItems(this.getNextItemCosts(statId));
    this._p.statLevels[statId] = this.getLevel(statId) + 1;
    this._save();
    return true;
  }

  // ── Computed stats ─────────────────────────────────────────────────────────

  public computeStats(): MyStats {
    const stats: MyStats = { ...BASE_STATS };
    for (const def of STAT_UPGRADES) {
      const level = this.getLevel(def.id);
      if (level <= 0) continue;
      (stats as Record<string, number>)[def.statKey] =
        ((stats as Record<string, number>)[def.statKey] ?? 0) + level * def.statPerLevel;
    }
    return this._applyGuardRails(stats);
  }

  /** Temporarily override one stat level to compute a preview (for UI tooltips). */
  public previewStats(statId: string, level: number): MyStats {
    const saved = this._p.statLevels[statId];
    this._p.statLevels[statId] = Math.max(0, Math.floor(level));
    const result = this.computeStats();
    if (saved == null) delete this._p.statLevels[statId];
    else this._p.statLevels[statId] = saved;
    return result;
  }

  // ── Guard rails — add your own caps here ───────────────────────────────────

  private _applyGuardRails(stats: MyStats): MyStats {
    const out: MyStats = { ...stats };
    // Example cap: defence soft-caps at 0.75 with half-cap at raw=0.35
    // out.defence = this._diminish(Math.max(0, out.defence), 0.75, 0.35);
    return out;
  }

  /**
   * Hyperbola: effective = cap × raw / (raw + k)
   * Never reaches cap. At raw = k, effective = cap / 2.
   */
  private _diminish(raw: number, cap: number, k: number): number {
    if (raw <= 0 || !Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(cap, cap * (raw / (raw + k))));
  }

  public reset(): void { this._p = defaultProfile(); this._save(); }

  private _find(statId: string): StatUpgradeDef<keyof MyStats> | undefined {
    return STAT_UPGRADES.find((d) => d.id === statId);
  }

  private _save(): void { saveProfile(this._p); }
}

export const statStore = new StatUpgradeStore();
