import type { RiskLevel } from '../data/risk-levels.js';

/** Computed Grim stats after base values + purchased upgrades. */
export interface GrimStats {
  maxHealth: number;
  /** Damage multiplier (1 = base weapon damage). */
  attackMult: number;
  /** Fractional damage reduction (0–1). */
  defence: number;
  moveSpeed: number;
  poisonRes: number;
  possessionRes: number;
  fearRes: number;
  critChance: number;
  /** Bonus to item drop roll weight (0–1 per level stacks additively in compute). */
  luck: number;
  /** HP restored per enemy kill (base + Soul Leech upgrade). */
  soulHeal: number;
}

export const BASE_GRIM_STATS: GrimStats = {
  maxHealth: 100,
  attackMult: 1,
  defence: 0,
  moveSpeed: 5,
  poisonRes: 0,
  possessionRes: 0,
  fearRes: 0,
  critChance: 0,
  luck: 0,
  /** Fractional HP per kill — applied via accumulator in {@link applySoulHealOnPickup}. */
  soulHeal: 0.2,
};

export interface PlayerProfile {
  souls: number;
  /** Purchased stat upgrade levels (0 = none bought yet). */
  statLevels: Partial<Record<string, number>>;
  skillLevels: Partial<Record<string, number>>;
  /** itemId → quantity owned. */
  inventory: Partial<Record<string, number>>;
  /** Items the player has found at least once (unlocks shop listing). */
  discoveredItems: string[];
  /** Lifetime shop purchases per item (for escalating prices). */
  shopPurchaseCounts: Partial<Record<string, number>>;
  /** Highest risk tier the player may select on the map (1–5). */
  unlockedRiskLevel: RiskLevel;
  /** First suburbs tutorial mission completed successfully. */
  tutorialCompleted: boolean;
  /** Unlocked after one successful Risk 5 mission. */
  risk5PlusUnlocked: boolean;
  /** Completed Risk 5+ runs (shown as +N in UI). */
  risk5PlusCompletions: number;
}

export const PROFILE_STORAGE_KEY = 'grim2-player-profile';

export const PROFILE_VERSION = 3;
