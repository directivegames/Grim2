# Shop Price Formula

## Formula

```
price = floor(baseCurrencyPrice × priceMultiplier ^ purchaseCount)
```

`purchaseCount` is the lifetime number of times the player has already purchased this item (starts at 0).

## Example at baseCurrencyPrice = 25, priceMultiplier = 1.12

| Purchase | Price |
|----------|-------|
| 1st      | 25    |
| 2nd      | 28    |
| 3rd      | 31    |
| 5th      | 39    |
| 10th     | 69    |
| 20th     | 192   |
| 50th     | 3,287 |

## Tuning multipliers

- `1.08`–`1.10` — very gentle; bulk buying stays affordable for a long time
- `1.12`–`1.14` — standard; moderate anti-hoard pressure
- `1.16`–`1.18` — firm; rare materials become expensive quickly
- `1.20`+       — aggressive; intended for the rarest crafting ingredients

## Next-price preview in UI

The exported `shopPrice` function is pure — call it directly with any purchase count to preview without mutating state:

```ts
import { shopPrice } from './ItemShop.js';

const def       = MY_SHOP_ITEMS.find((s) => s.itemId === 'health_potion')!;
const count     = shop.getPurchaseCount('health_potion');
const thisPrice = shopPrice(def, count);
const nextPrice = shopPrice(def, count + 1);
```
