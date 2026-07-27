# skill-upgrades

Capped ability upgrades. Each skill has a fixed maximum level. Each level has an explicit cost table (currency + items) rather than a formula. Skills can start unlocked at level 1 for free. A `comingSoon` flag lets you reserve a slot in the UI without making it purchasable.

---

## 1. Define your skills

Copy `SkillUpgrades.ts` from this skill's assets.

```ts
import { type SkillUpgradeDef } from './SkillUpgrades.js';

export const MY_SKILLS: readonly SkillUpgradeDef[] = [
  {
    id: 'fireBlast',
    name: 'Fire Blast',
    description: 'Unleash a burst of flame.',
    maxLevel: 3,
    comingSoon: false,
    levelDescriptions: [
      'One blast per activation.',
      'Two blasts in a spread.',
      'Three blasts and a DoT.',
    ],
    levelCosts: [
      // cost to reach level 2
      { currency: 250, items: [{ itemId: 'iron_ore', qty: 20 }] },
      // cost to reach level 3
      {
        currency: 900,
        items: [
          {
            itemId: 'rare_crystal',
            qty: 5,
            oneOf: [
              { itemId: 'rare_crystal', qty: 5 },
              { itemId: 'ancient_gem', qty: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'deathStep',
    name: 'Death Step',
    description: 'Coming soon.',
    maxLevel: 1,
    comingSoon: true,
    levelDescriptions: ['Locked'],
    levelCosts: [],
  },
];
```

`levelCosts[0]` is the cost to reach level 2 (level 1 is the free default). Length must equal `maxLevel - defaultStartLevel`.

---

## 2. Set the store up

At the top of `SkillUpgrades.ts`, adapt these two lines:

```ts
const STORAGE_KEY = 'my-game-skill-upgrades';
const SKILL_UPGRADES = MY_SKILLS;
```

Give skills a free starting level if they should be unlocked from the start:

```ts
const DEFAULT_LEVELS: Partial<Record<string, number>> = {
  fireBlast: 1,  // level 1 granted for free
};
```

Export and initialise:

```ts
export const skillStore = new SkillUpgradeStore();
skillStore.init();
```

---

## 3. Award currency and items

```ts
skillStore.addCurrency(100);
skillStore.addItem('iron_ore', 5);
```

---

## 4. Purchase a skill level (in UI)

```ts
const level        = skillStore.getLevel('fireBlast');
const maxLevel     = skillStore.getMaxLevel('fireBlast');
const currencyCost = skillStore.getNextCurrencyCost('fireBlast');
const items        = skillStore.getNextItemCosts('fireBlast');
const canBuy   = skillStore.canAfford('fireBlast');

if (canBuy) {
  skillStore.purchase('fireBlast');
}
```

`canAfford` returns false if the skill is at max level or marked `comingSoon`.

---

## 5. Read skill level in gameplay

```ts
const level = skillStore.getLevel('fireBlast');
// 0 = not purchased, 1 = base, 2 = upgraded, 3 = max

switch (level) {
  case 1: fireOneBlast(); break;
  case 2: fireTwoBlasts(); break;
  case 3: fireThreeWithDoT(); break;
}
```

Check level at activation time rather than caching it — debug resets take effect immediately.

---

## 6. Reserve an upcoming skill

```ts
{
  id: 'shadowStep',
  name: 'Shadow Step',
  description: 'Coming soon.',
  maxLevel: 1,
  comingSoon: true,
  levelDescriptions: ['Locked'],
  levelCosts: [],
}
```

`canAfford` and `getNextCurrencyCost` both return 0/false for `comingSoon` skills. Show the slot greyed-out in the UI.

---

## Constraints

- Skill IDs must be unique and stable across saves. Renaming an ID resets that skill for all players.
- `levelCosts.length` must equal `maxLevel - defaultStartLevel`. Too few entries silently return 0-cost for missing levels.
- One singleton per session. Call `init()` once at startup.
- If using alongside `stat-upgrades` or `item-shop`, merge profiles into a single shared key.
