import type { RiskLevel } from '../data/risk-levels.js';
import { RISK_LEVELS } from '../data/risk-levels.js';
import {
  getShopItemByItemId,
  getShopSoulPrice,
  SHOP_ITEMS,
  type ShopItemDef,
} from '../data/shop-items.js';
import {
  getSkillUpgradeById,
  getStatItemCostsForLevel,
  getStatSoulCostForLevel,
  getStatUpgradeById,
  GRIM_STAT_UPGRADES,
  type ItemCost,
} from '../data/upgrades.js';
import { satisfiesItemCost, spendItemCost } from './item-cost.js';
import {
  BASE_GRIM_STATS,
  type GrimStats,
  type PlayerProfile,
} from './player-profile-types.js';
import { defaultProfile, loadProfile, saveProfile } from './PlayerProfile.js';

const DEFAULT_SKILL_LEVEL: Partial<Record<string, number>> = {
  fistOfAnnoyance: 1,
  soulThrow: 1,
};

/**
 * Persistent player progression (souls, upgrades, items, risk unlocks).
 * All gameplay reads/writes go through this singleton.
 */
class GrimVaultImpl {
  private _profile: PlayerProfile = defaultProfile();

  public init(): void {
    this._profile = loadProfile();
  }

  public get profile(): Readonly<PlayerProfile> {
    return this._profile;
  }

  public reload(): void {
    this._profile = loadProfile();
  }

  // ── Souls ─────────────────────────────────────────────────────────────────

  public getSouls(): number {
    return this._profile.souls;
  }

  public addSouls(amount: number): void {
    if (amount <= 0 || !Number.isFinite(amount)) {
      return;
    }
    this._profile.souls += Math.floor(amount);
    this._persist();
  }

  public spendSouls(amount: number): boolean {
    const cost = Math.floor(amount);
    if (cost <= 0 || this._profile.souls < cost) {
      return false;
    }
    this._profile.souls -= cost;
    this._persist();
    return true;
  }

  // ── Risk progression ──────────────────────────────────────────────────────

  public getUnlockedRiskLevel(): RiskLevel {
    return this._profile.unlockedRiskLevel;
  }

  /** Unlock the next risk tier after a successful mission (caps at 5). */
  public unlockNextRiskLevel(): void {
    const current = this._profile.unlockedRiskLevel;
    const idx = RISK_LEVELS.indexOf(current);
    if (idx < 0 || idx >= RISK_LEVELS.length - 1) {
      return;
    }
    this._profile.unlockedRiskLevel = RISK_LEVELS[idx + 1]!;
    this._persist();
  }

  public canSelectRiskLevel(level: RiskLevel): boolean {
    return level >= 1 && level <= this._profile.unlockedRiskLevel;
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  public getItemQty(itemId: string): number {
    return this._profile.inventory[itemId] ?? 0;
  }

  public addItem(itemId: string, qty: number): void {
    const n = Math.floor(qty);
    if (n <= 0) {
      return;
    }
    this.discoverItem(itemId);
    this._profile.inventory[itemId] = this.getItemQty(itemId) + n;
    this._persist();
  }

  // ── Item discovery & shop ─────────────────────────────────────────────────

  public discoverItem(itemId: string): void {
    if (!itemId) {
      return;
    }
    if (!this._profile.discoveredItems.includes(itemId)) {
      this._profile.discoveredItems.push(itemId);
      this._persist();
    }
  }

  public isItemDiscovered(itemId: string): boolean {
    const shopEntry = getShopItemByItemId(itemId);
    if (shopEntry?.unlockedByDefault) {
      return true;
    }
    return this._profile.discoveredItems.includes(itemId);
  }

  public getShopPurchaseCount(itemId: string): number {
    return this._profile.shopPurchaseCounts[itemId] ?? 0;
  }

  public getListedShopItems(): ShopItemDef[] {
    return SHOP_ITEMS.filter(
      (entry) => entry.unlockedByDefault || this._profile.discoveredItems.includes(entry.itemId),
    );
  }

  public getShopSoulPrice(itemId: string): number {
    const def = getShopItemByItemId(itemId);
    if (!def) {
      return 0;
    }
    return getShopSoulPrice(def, this.getShopPurchaseCount(itemId));
  }

  public canPurchaseShopItem(itemId: string): boolean {
    if (!this.isItemDiscovered(itemId) || !getShopItemByItemId(itemId)) {
      return false;
    }
    return this._profile.souls >= this.getShopSoulPrice(itemId);
  }

  public purchaseShopItem(itemId: string): boolean {
    const def = getShopItemByItemId(itemId);
    if (!def || !this.canPurchaseShopItem(itemId)) {
      return false;
    }
    const price = this.getShopSoulPrice(itemId);
    this._profile.souls -= price;
    this.addItem(itemId, 1);
    const count = this.getShopPurchaseCount(itemId);
    this._profile.shopPurchaseCounts[itemId] = count + 1;
    this._persist();
    return true;
  }

  public hasItems(costs: readonly ItemCost[]): boolean {
    return costs.every((c) => satisfiesItemCost((id) => this.getItemQty(id), c));
  }

  public spendItems(costs: readonly ItemCost[]): boolean {
    if (!this.hasItems(costs)) {
      return false;
    }
    for (const c of costs) {
      spendItemCost(
        (id) => this.getItemQty(id),
        (id, qty) => {
          if (qty <= 0) {
            delete this._profile.inventory[id];
          } else {
            this._profile.inventory[id] = qty;
          }
        },
        c,
      );
    }
    this._persist();
    return true;
  }

  // ── Stat upgrades (infinite) ──────────────────────────────────────────────

  public getStatLevel(statId: string): number {
    return this._profile.statLevels[statId] ?? 0;
  }

  public getNextStatSoulCost(statId: string): number {
    const def = getStatUpgradeById(statId);
    if (!def) {
      return 0;
    }
    return getStatSoulCostForLevel(def, this.getStatLevel(statId));
  }

  public getNextStatItemCosts(statId: string): readonly ItemCost[] {
    const def = getStatUpgradeById(statId);
    if (!def) {
      return [];
    }
    return getStatItemCostsForLevel(def, this.getStatLevel(statId));
  }

  public canAffordStatUpgrade(statId: string): boolean {
    const soulCost = this.getNextStatSoulCost(statId);
    const items = this.getNextStatItemCosts(statId);
    return this._profile.souls >= soulCost && this.hasItems(items);
  }

  public purchaseStatUpgrade(statId: string): boolean {
    if (!getStatUpgradeById(statId) || !this.canAffordStatUpgrade(statId)) {
      return false;
    }
    const soulCost = this.getNextStatSoulCost(statId);
    const items = this.getNextStatItemCosts(statId);
    this._profile.souls -= soulCost;
    this.spendItems(items);
    this._profile.statLevels[statId] = this.getStatLevel(statId) + 1;
    this._persist();
    return true;
  }

  // ── Skill upgrades (capped) ─────────────────────────────────────────────────

  public getSkillLevel(skillId: string): number {
    const stored = this._profile.skillLevels[skillId];
    if (stored != null) {
      return stored;
    }
    return DEFAULT_SKILL_LEVEL[skillId] ?? 0;
  }

  /** Index into levelCosts for upgrading from the current level to the next. */
  private _skillUpgradeCostIndex(skillId: string, currentLevel: number): number {
    const baseLevel = DEFAULT_SKILL_LEVEL[skillId] ?? 0;
    return currentLevel - baseLevel;
  }

  public getNextSkillSoulCost(skillId: string): number {
    const def = getSkillUpgradeById(skillId);
    if (!def || def.comingSoon) {
      return 0;
    }
    const level = this.getSkillLevel(skillId);
    if (level >= def.maxLevel) {
      return 0;
    }
    const cost = def.levelCosts[this._skillUpgradeCostIndex(skillId, level)];
    return cost?.souls ?? 0;
  }

  public getNextSkillItemCosts(skillId: string): readonly ItemCost[] {
    const def = getSkillUpgradeById(skillId);
    if (!def || def.comingSoon) {
      return [];
    }
    const level = this.getSkillLevel(skillId);
    if (level >= def.maxLevel) {
      return [];
    }
    return def.levelCosts[this._skillUpgradeCostIndex(skillId, level)]?.items ?? [];
  }

  public canAffordSkillUpgrade(skillId: string): boolean {
    const def = getSkillUpgradeById(skillId);
    if (!def || def.comingSoon) {
      return false;
    }
    const level = this.getSkillLevel(skillId);
    if (level >= def.maxLevel) {
      return false;
    }
    const soulCost = this.getNextSkillSoulCost(skillId);
    const items = this.getNextSkillItemCosts(skillId);
    return this._profile.souls >= soulCost && this.hasItems(items);
  }

  public purchaseSkillUpgrade(skillId: string): boolean {
    if (!this.canAffordSkillUpgrade(skillId)) {
      return false;
    }
    const soulCost = this.getNextSkillSoulCost(skillId);
    const items = this.getNextSkillItemCosts(skillId);
    this._profile.souls -= soulCost;
    this.spendItems(items);
    this._profile.skillLevels[skillId] = this.getSkillLevel(skillId) + 1;
    this._persist();
    return true;
  }

  // ── Computed stats ────────────────────────────────────────────────────────

  public computeStats(): GrimStats {
    const stats: GrimStats = { ...BASE_GRIM_STATS };

    for (const def of GRIM_STAT_UPGRADES) {
      const level = this.getStatLevel(def.id);
      if (level <= 0) {
        continue;
      }
      const bonus = level * def.statPerLevel;
      const key = def.statKey;
      stats[key] = stats[key] + bonus;
    }

    return stats;
  }

  /** Reset profile (debug / template testing). */
  public resetProfile(): void {
    this._profile = defaultProfile();
    this._persist();
  }

  private _persist(): void {
    saveProfile(this._profile);
  }
}

export const grimVault = new GrimVaultImpl();
grimVault.init();
