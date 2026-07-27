# stat-upgrades

Infinite-level character stat upgrades. Each upgrade maps to one numeric stat key. Currency cost scales exponentially per level; item costs follow a ladder array. Optional diminishing-returns cap prevents any stat reaching an invulnerable end-state.

---

## 1. Define your stats type

```ts
export interface MyStats {
  maxHealth: number;
  attackMult: number;
  defence: number;
  moveSpeed: number;
}

export const BASE_STATS: MyStats = {
  maxHealth: 100,
  attackMult: 1,
  defence: 0,
  moveSpeed: 5,
};
```

---

## 2. Define upgrade entries

Copy `StatUpgrades.ts` from this skill's assets. Each entry maps to one key in your stats type.

```ts
import { type StatUpgradeDef } from './StatUpgrades.js';

export const MY_STAT_UPGRADES: readonly StatUpgradeDef<keyof MyStats>[] = [
  {
    id: 'health',
    name: 'Vitality',
    description: 'Increases maximum health (+10 per level).',
    baseCurrencyCost: 50,
    costMultiplier: 2,
    itemCostsPerLevel: [
      [],
      [],
      [{ itemId: 'iron_ore', qty: 15 }],
      [{ itemId: 'iron_ore', qty: 30 }],
    ],
    statKey: 'maxHealth',
    statPerLevel: 10,
  },
  {
    id: 'attack',
    name: 'Strike',
    description: 'Increases damage dealt (+5% per level).',
    baseCurrencyCost: 75,
    costMultiplier: 2,
    itemCostsPerLevel: [[], []],
    statKey: 'attackMult',
    statPerLevel: 0.05,
  },
];
```

Currency cost formula: `floor(baseCurrencyCost × costMultiplier^currentLevel)`.
Item ladder: the last entry repeats for all levels beyond the array length. Use `[]` for a free level.

---

## 3. Create the store

At the top of `StatUpgrades.ts`, adapt these three lines:

```ts
const STORAGE_KEY = 'my-game-stat-upgrades';
const BASE_STATS: MyStats = { /* your base values */ };
const STAT_UPGRADES = MY_STAT_UPGRADES;
```

Export and initialise the singleton:

```ts
export const statStore = new StatUpgradeStore();
statStore.init();
```

Call `init()` once at startup before any reads.

---

## 4. Award currency and items

```ts
statStore.addCurrency(50);        // after a kill, mission reward, etc.
statStore.addItem('iron_ore', 3);
```

---

## 5. Purchase an upgrade (in UI)

```ts
const currencyCost = statStore.getNextCurrencyCost('health');
const items        = statStore.getNextItemCosts('health');
const canBuy       = statStore.canAfford('health');

if (canBuy) {
  statStore.purchase('health');
}
```

---

## 6. Apply stats to a player actor

```ts
const stats = statStore.computeStats();
player.maxHealth = stats.maxHealth;
player.attackMult = stats.attackMult;
player.moveSpeed  = stats.moveSpeed;
```

Call `computeStats()` once after purchase, or on session start, and cache the result.

---

## 7. Preview next-level gain (for UI tooltip)

```ts
const now  = statStore.computeStats();
const next = statStore.previewStats('defence', statStore.getLevel('defence') + 1);
const gain = next.defence - now.defence;
```

Use this when showing a "current → next" breakdown. Diminishing returns means the gain is non-linear and must be computed, not calculated as `statPerLevel` directly.

---

## 8. Add a diminishing returns cap (optional)

Edit `_applyGuardRails` inside `StatUpgrades.ts`:

```ts
// Hyperbola: effective = cap × raw / (raw + k)
// At raw = k, effective = cap / 2. Never reaches cap.
out.defence = this._diminish(Math.max(0, out.defence), 0.75, 0.35);
```

See `references/diminishing-returns.md` for tuning guidance.

---

## Constraints

- One singleton per session. Call `init()` before any reads.
- Upgrade IDs must be unique and stable — renaming resets all saves for that stat.
- The item ladder repeats its last entry; provide at least one entry or use `[]` for free.
- If using this alongside `skill-upgrades` or `item-shop`, merge all three into a single shared profile rather than three separate localStorage keys. See each skill's `assets/` for the profile schema to merge.
