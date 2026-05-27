import {
  getExclusiveDropPool,
  getGeneralDropPool,
  type ItemDef,
} from '../data/items.js';
import type { RiskLevel } from '../data/risk-levels.js';

/** Base chance a routine kill rolls from the general item pool. */
export const BASE_ITEM_DROP_CHANCE = 0.12;

/** Chance an elite kill rolls its exclusive pool (before general pool). */
export const EXCLUSIVE_ITEM_DROP_CHANCE = 0.38;

function pickWeightedItem(items: readonly ItemDef[], luckBonus: number): string {
  let total = 0;
  const weights: number[] = [];
  for (const item of items) {
    const w = item.dropWeight * (1 + luckBonus);
    weights.push(w);
    total += w;
  }

  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) {
      return items[i]!.id;
    }
  }
  return items[items.length - 1]!.id;
}

function rollFromPool(
  pool: readonly ItemDef[],
  chance: number,
  luckBonus: number,
): string | null {
  if (pool.length === 0) {
    return null;
  }
  const luck = Math.max(0, luckBonus);
  const dropChance = Math.min(0.75, chance + luck * 0.5);
  if (Math.random() > dropChance) {
    return null;
  }
  return pickWeightedItem(pool, luck);
}

/**
 * Roll from an enemy-type exclusive pool (e.g. Big Undead → brute core).
 */
export function rollExclusiveItemDrop(
  enemyTypeId: string,
  riskLevel: RiskLevel,
  luckBonus: number,
): string | null {
  const pool = getExclusiveDropPool(enemyTypeId, riskLevel);
  return rollFromPool(pool, EXCLUSIVE_ITEM_DROP_CHANCE, luckBonus);
}

/**
 * Roll from the general pool (any kill). Excludes enemy-exclusive items.
 */
export function rollGeneralItemDrop(
  riskLevel: RiskLevel,
  luckBonus: number,
): string | null {
  const pool = getGeneralDropPool(riskLevel);
  return rollFromPool(pool, BASE_ITEM_DROP_CHANCE, luckBonus);
}

/** @deprecated Use rollGeneralItemDrop or rollExclusiveItemDrop. */
export function rollItemDrop(riskLevel: RiskLevel, luckBonus: number): string | null {
  return rollGeneralItemDrop(riskLevel, luckBonus);
}
