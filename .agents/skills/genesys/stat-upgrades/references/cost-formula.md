# Stat Upgrade Cost Formula

## Currency cost

```
currencyCost = floor(baseCurrencyCost × costMultiplier ^ currentLevel)
```

At `baseCurrencyCost = 50`, `costMultiplier = 2`:

| Level | Currency cost |
|-------|---------------|
| 0→1   | 50        |
| 1→2   | 100       |
| 2→3   | 200       |
| 3→4   | 400       |
| 4→5   | 800       |

Tune `costMultiplier`:
- `1.5` — gentle slope, players can afford many levels quickly
- `2.0` — standard doubling, each level costs as much as all previous combined
- `3.0` — aggressive, discourages deep investment in any one stat

## Item cost ladder

`itemCostsPerLevel` is indexed by the current level (i.e. the level being purchased from). The last entry repeats for all purchases beyond the array length.

```ts
// Pattern: first two levels free, then escalating material grind
const LADDER = [
  [],                                      // level 0→1: free
  [],                                      // level 1→2: free
  [{ itemId: 'common_mat', qty: 10 }],     // level 2→3
  [{ itemId: 'common_mat', qty: 20 }],     // level 3→4
  [{ itemId: 'rare_mat',   qty:  5 }],     // level 4→5
  [{ itemId: 'rare_mat',   qty: 10 }],     // level 5+ (repeats)
];
```

An empty outer array `[]` means the stat never requires items (currency only).

## oneOf alternatives

A cost line can accept one of several items — useful when you want to accept either a common or a rare material:

```ts
{
  itemId: 'rare_mat',
  qty: 5,
  oneOf: [
    { itemId: 'rare_mat',   qty: 5 },
    { itemId: 'super_rare', qty: 2 },
  ],
}
```

When `oneOf` is present, the primary `itemId`/`qty` are ignored. The first affordable option is consumed.
