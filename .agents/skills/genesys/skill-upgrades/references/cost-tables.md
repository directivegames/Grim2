# Skill Upgrade Cost Tables

## Level numbering

Level 1 is always the first usable state. By default a skill starts at level 0 (not purchased). List it in `DEFAULT_LEVELS` to grant level 1 for free on a fresh save.

`levelCosts[0]` is always the cost to move from the default start level to `defaultLevel + 1`.

If `DEFAULT_LEVELS.fireBlast = 1`:
- `levelCosts[0]` is the cost to reach level 2
- `levelCosts[1]` is the cost to reach level 3

If `DEFAULT_LEVELS.fireBlast` is not set (starts at 0):
- `levelCosts[0]` is the cost to reach level 1
- `levelCosts[1]` is the cost to reach level 2

## Explicit tables vs formula

Skill upgrades use explicit tables rather than a formula because each level meaningfully changes how the ability plays. The designer controls exactly how hard each step is rather than inheriting a curve. Use this for abilities where you want to deliberately pace specific milestones.

For pure stat bonuses with no qualitative level difference, use `stat-upgrades` instead.

## oneOf item alternatives

A single cost line can accept one of several items:

```ts
{
  currency: 900,
  items: [
    {
      itemId: 'rare_crystal',
      qty: 5,
      oneOf: [
        { itemId: 'rare_crystal', qty: 5 },
        { itemId: 'ancient_gem',  qty: 2 },
      ],
    },
  ],
}
```

When `oneOf` is present, the primary `itemId`/`qty` on the outer object are ignored. The first affordable option is consumed.

## comingSoon

Set `comingSoon: true` and provide empty `levelCosts: []` to show a skill slot in the UI without enabling it:

```ts
{
  id: 'deathStep',
  name: 'Death Step',
  comingSoon: true,
  maxLevel: 1,
  levelDescriptions: ['Locked'],
  levelCosts: [],
}
```

`canAfford`, `getNextCurrencyCost`, and `getNextItemCosts` all return falsy values for `comingSoon` skills.
