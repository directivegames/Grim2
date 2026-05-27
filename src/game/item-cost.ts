import type { ItemCost } from '../data/upgrades.js';

/** True if the player can pay this cost line (supports `oneOf` alternatives). */
export function satisfiesItemCost(
  getQty: (itemId: string) => number,
  cost: ItemCost,
): boolean {
  if (cost.oneOf && cost.oneOf.length > 0) {
    return cost.oneOf.some((opt) => getQty(opt.itemId) >= opt.qty);
  }
  return getQty(cost.itemId) >= cost.qty;
}

/** Spend one cost line; returns false if nothing affordable. */
export function spendItemCost(
  getQty: (itemId: string) => number,
  setQty: (itemId: string, qty: number) => void,
  cost: ItemCost,
): boolean {
  if (cost.oneOf && cost.oneOf.length > 0) {
    const pick = cost.oneOf.find((opt) => getQty(opt.itemId) >= opt.qty);
    if (!pick) {
      return false;
    }
    const remaining = getQty(pick.itemId) - pick.qty;
    if (remaining <= 0) {
      setQty(pick.itemId, 0);
    } else {
      setQty(pick.itemId, remaining);
    }
    return true;
  }

  if (getQty(cost.itemId) < cost.qty) {
    return false;
  }
  const remaining = getQty(cost.itemId) - cost.qty;
  if (remaining <= 0) {
    setQty(cost.itemId, 0);
  } else {
    setQty(cost.itemId, remaining);
  }
  return true;
}
