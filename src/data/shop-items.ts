/** Material purchases in the SHOP tab (souls, escalating price per buy). */
export interface ShopItemDef {
  itemId: string;
  baseSoulPrice: number;
  /** Multiplier applied per previous purchase (lifetime). */
  priceMultiplier: number;
  /** Visible in shop without discovering from a drop. */
  unlockedByDefault?: boolean;
}

export const SHOP_ITEMS: readonly ShopItemDef[] = [
  {
    itemId: 'bone_shard',
    baseSoulPrice: 25,
    priceMultiplier: 1.12,
    unlockedByDefault: true,
  },
  {
    itemId: 'cursed_vial',
    baseSoulPrice: 55,
    priceMultiplier: 1.14,
  },
  {
    itemId: 'soul_crystal',
    baseSoulPrice: 120,
    priceMultiplier: 1.16,
  },
  {
    itemId: 'grim_ember',
    baseSoulPrice: 200,
    priceMultiplier: 1.18,
  },
  {
    itemId: 'void_relic',
    baseSoulPrice: 350,
    priceMultiplier: 1.2,
  },
  {
    itemId: 'brute_core',
    baseSoulPrice: 150,
    priceMultiplier: 1.17,
  },
] as const;

export function getShopItemByItemId(itemId: string): ShopItemDef | undefined {
  return SHOP_ITEMS.find((entry) => entry.itemId === itemId);
}

export function getShopSoulPrice(def: ShopItemDef, purchaseCount: number): number {
  return Math.floor(def.baseSoulPrice * def.priceMultiplier ** Math.max(0, purchaseCount));
}
