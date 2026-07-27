/**
 * SkillUpgrades.ts
 *
 * Capped ability upgrades. Each skill has a fixed maxLevel with explicit
 * per-level cost tables. Skills can start at a non-zero default level.
 *
 * Usage: adapt the two config constants below, then export `skillStore`.
 * Zero dependencies outside this file.
 */

// ─── Adapt these two lines ────────────────────────────────────────────────────

const STORAGE_KEY = 'my-game-skill-upgrades';

/** Replace with your own skill definitions. */
const SKILL_UPGRADES: readonly SkillUpgradeDef[] = [];

/**
 * Skills listed here start at the given level on a fresh save (free unlock).
 * Keep in sync with defaultProfile().skillLevels.
 */
const DEFAULT_LEVELS: Partial<Record<string, number>> = {
  // fireBlast: 1,
};

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

// ─── Skill upgrade definition ─────────────────────────────────────────────────

export interface SkillLevelCost {
  currency: number;
  items: readonly ItemCost[];
}

export interface SkillUpgradeDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** Set true to show in UI as locked/coming-soon without enabling purchase. */
  comingSoon: boolean;
  /** One description string per level (index 0 = level 1 description). */
  levelDescriptions: readonly string[];
  /**
   * Index 0 = cost to reach level 2.
   * Length must equal maxLevel - defaultStartLevel.
   */
  levelCosts: readonly SkillLevelCost[];
}

// ─── Profile schema ──────────────────────────────────────────────────────────

interface SkillProfile {
  currency: number;
  skillLevels: Partial<Record<string, number>>;
  inventory: Partial<Record<string, number>>;
}

function defaultProfile(): SkillProfile {
  return {
    currency: 0,
    skillLevels: { ...DEFAULT_LEVELS },
    inventory: {},
  };
}

function loadProfile(): SkillProfile {
  if (typeof localStorage === 'undefined') return defaultProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    const p = JSON.parse(raw) as Partial<SkillProfile>;

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
      skillLevels: {
        ...defaultProfile().skillLevels,
        ...sanitizeLevels(p.skillLevels),
      },
      inventory: sanitizeInventory(p.inventory),
    };
  } catch {
    return defaultProfile();
  }
}

function saveProfile(p: SkillProfile): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

// ─── Store ────────────────────────────────────────────────────────────────────

class SkillUpgradeStore {
  private _p: SkillProfile = defaultProfile();

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

  // ── Skill upgrades ─────────────────────────────────────────────────────────

  public getLevel(skillId: string): number {
    const stored = this._p.skillLevels[skillId];
    return stored ?? DEFAULT_LEVELS[skillId] ?? 0;
  }

  public getMaxLevel(skillId: string): number {
    return this._find(skillId)?.maxLevel ?? 0;
  }

  public isComingSoon(skillId: string): boolean {
    return this._find(skillId)?.comingSoon ?? false;
  }

  public getLevelDescription(skillId: string, level: number): string {
    return this._find(skillId)?.levelDescriptions[level - 1] ?? '';
  }

  public getNextCurrencyCost(skillId: string): number {
    const def = this._find(skillId);
    if (!def || def.comingSoon) return 0;
    const level = this.getLevel(skillId);
    if (level >= def.maxLevel) return 0;
    return def.levelCosts[this._costIndex(skillId, level)]?.currency ?? 0;
  }

  public getNextItemCosts(skillId: string): readonly ItemCost[] {
    const def = this._find(skillId);
    if (!def || def.comingSoon) return [];
    const level = this.getLevel(skillId);
    if (level >= def.maxLevel) return [];
    return def.levelCosts[this._costIndex(skillId, level)]?.items ?? [];
  }

  public canAfford(skillId: string): boolean {
    const def = this._find(skillId);
    if (!def || def.comingSoon || this.getLevel(skillId) >= def.maxLevel) return false;
    return this._p.currency >= this.getNextCurrencyCost(skillId) && this.hasItems(this.getNextItemCosts(skillId));
  }

  public purchase(skillId: string): boolean {
    if (!this.canAfford(skillId)) return false;
    this._p.currency -= this.getNextCurrencyCost(skillId);
    this.spendItems(this.getNextItemCosts(skillId));
    this._p.skillLevels[skillId] = this.getLevel(skillId) + 1;
    this._save();
    return true;
  }

  public reset(): void { this._p = defaultProfile(); this._save(); }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _find(skillId: string): SkillUpgradeDef | undefined {
    return SKILL_UPGRADES.find((d) => d.id === skillId);
  }

  /**
   * levelCosts[0] = cost to move from defaultLevel to defaultLevel+1.
   */
  private _costIndex(skillId: string, currentLevel: number): number {
    return currentLevel - (DEFAULT_LEVELS[skillId] ?? 0);
  }

  private _save(): void { saveProfile(this._p); }
}

export const skillStore = new SkillUpgradeStore();
