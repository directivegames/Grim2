# item-shop

A currency-based shop that sells items with escalating prices. Each purchase makes the next one more expensive. Items are either always listed or hidden until the player first discovers one (discovery gating).

---

## 1. Define shop items

Copy `ItemShop.ts` from this skill's assets.

```ts
import { type ShopItemDef } from './ItemShop.js';

export const MY_SHOP_ITEMS: readonly ShopItemDef[] = [
  {
    itemId: 'health_potion',
    baseCurrencyPrice: 25,
    priceMultiplier: 1.12,
    unlockedByDefault: true,   // always visible
  },
  {
    itemId: 'rare_crystal',
    baseCurrencyPrice: 120,
    priceMultiplier: 1.16,
    // no unlockedByDefault — only shows after the player discovers one
  },
  {
    itemId: 'ancient_relic',
    baseCurrencyPrice: 350,
    priceMultiplier: 1.20,
  },
];
```

Price formula: `floor(baseCurrencyPrice × priceMultiplier^purchaseCount)`.

---

## 2. Set the shop up

At the top of `ItemShop.ts`, adapt these two lines:

```ts
const STORAGE_KEY = 'my-game-item-shop';
const SHOP_ITEMS  = MY_SHOP_ITEMS;
```

Export and initialise:

```ts
export const shop = new ItemShopStore();
shop.init();
```

---

## 3. Award currency

```ts
shop.addCurrency(50);   // after a kill, mission reward, etc.
shop.getCurrency();
```

---

## 4. Unlock items from drops

Call this when the player picks up a new item type for the first time:

```ts
shop.addItem('rare_crystal', 1);    // add to inventory
shop.discoverItem('rare_crystal');  // unlock in shop
```

Items marked `unlockedByDefault: true` never need `discoverItem`.

---

## 5. Render the shop

```ts
for (const def of shop.getListedItems()) {
  const price  = shop.getPrice(def.itemId);
  const canBuy = shop.canPurchase(def.itemId);
  const owned  = shop.getItemQty(def.itemId);
  const count  = shop.getPurchaseCount(def.itemId);  // for "next price" preview
  // render row
}
```

---

## 6. Purchase

```ts
const bought = shop.purchase('health_potion');
if (!bought) {
  // not enough currency or item not discovered
}
```

`purchase` is atomic: deducts currency, adds 1 to inventory, increments purchase count, saves.

---

## 7. Preview next price

```ts
import { shopPrice } from './ItemShop.js';

const def       = MY_SHOP_ITEMS.find((s) => s.itemId === 'health_potion')!;
const thisPrice = shopPrice(def, shop.getPurchaseCount('health_potion'));
const nextPrice = shopPrice(def, shop.getPurchaseCount('health_potion') + 1);
```

---

## Constraints

- One singleton per session. Call `init()` before any reads.
- Item IDs must be unique and stable — renaming resets discovery and purchase history.
- `unlockedByDefault` items are re-injected into `discoveredItems` on every load, so they cannot be accidentally hidden by a corrupted save.
- If using alongside `stat-upgrades` or `skill-upgrades`, merge all three profiles into a single shared `localStorage` key.
