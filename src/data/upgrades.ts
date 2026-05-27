import type { GrimStats } from '../game/player-profile-types.js';

export type GrimStatKey = keyof GrimStats;

export interface ItemCost {
  itemId: string;
  qty: number;
  /** Any listed option satisfies this cost line (e.g. crystal OR brute core). */
  oneOf?: readonly { itemId: string; qty: number }[];
}

export interface GrimStatUpgradeDef {
  id: string;
  name: string;
  description: string;
  baseSoulCost: number;
  /** Soul cost multiplier per level already purchased (typically 2). */
  costMultiplier: number;
  /**
   * Item costs indexed by the level being purchased (0 = first buy).
   * If the player buys beyond the array length, the last entry repeats.
   */
  itemCostsPerLevel: readonly (readonly ItemCost[])[];
  statKey: GrimStatKey;
  /** Flat HP/speed, or fractional bonus for % stats (e.g. 0.03 = +3%). */
  statPerLevel: number;
}

export interface SkillLevelCost {
  souls: number;
  items: readonly ItemCost[];
}

export interface SkillUpgradeDef {
  id: string;
  name: string;
  description: string;
  maxLevel: number;
  /** Index 0 = cost to reach level 2 (level 1 is free). */
  levelCosts: readonly SkillLevelCost[];
  levelDescriptions: readonly string[];
  comingSoon: boolean;
}

/** Souls-only early levels, then escalating item grind. */
const BONE_SHARD_LADDER: readonly (readonly ItemCost[])[] = [
  [],
  [],
  [{ itemId: 'bone_shard', qty: 15 }],
  [{ itemId: 'bone_shard', qty: 20 }],
  [{ itemId: 'bone_shard', qty: 50 }],
  [{ itemId: 'bone_shard', qty: 100 }],
];

const CURSED_VIAL_LADDER: readonly (readonly ItemCost[])[] = [
  [],
  [],
  [{ itemId: 'cursed_vial', qty: 20 }],
  [{ itemId: 'cursed_vial', qty: 30 }],
  [{ itemId: 'cursed_vial', qty: 50 }],
  [{ itemId: 'cursed_vial', qty: 100 }],
];

const SOUL_CRYSTAL_LADDER: readonly (readonly ItemCost[])[] = [
  [],
  [],
  [{ itemId: 'soul_crystal', qty: 10 }],
  [{ itemId: 'soul_crystal', qty: 15 }],
  [{ itemId: 'soul_crystal', qty: 25 }],
  [{ itemId: 'soul_crystal', qty: 50 }],
];

const GRIM_EMBER_LADDER: readonly (readonly ItemCost[])[] = [
  [],
  [],
  [{ itemId: 'grim_ember', qty: 5 }],
  [{ itemId: 'grim_ember', qty: 8 }],
  [{ itemId: 'grim_ember', qty: 12 }],
  [{ itemId: 'grim_ember', qty: 20 }],
];

export const GRIM_STAT_UPGRADES: readonly GrimStatUpgradeDef[] = [
  {
    id: 'health',
    name: 'Vitality',
    description: 'Increases maximum health.',
    baseSoulCost: 100,
    costMultiplier: 2,
    itemCostsPerLevel: BONE_SHARD_LADDER,
    statKey: 'maxHealth',
    statPerLevel: 25,
  },
  {
    id: 'attack',
    name: 'Strike',
    description: 'Increases damage dealt.',
    baseSoulCost: 150,
    costMultiplier: 2,
    itemCostsPerLevel: BONE_SHARD_LADDER,
    statKey: 'attackMult',
    statPerLevel: 0.05,
  },
  {
    id: 'defence',
    name: 'Grim Guard',
    description: 'Reduces damage taken.',
    baseSoulCost: 120,
    costMultiplier: 2,
    itemCostsPerLevel: CURSED_VIAL_LADDER,
    statKey: 'defence',
    statPerLevel: 0.02,
  },
  {
    id: 'speed',
    name: 'Haste',
    description: 'Increases movement speed.',
    baseSoulCost: 100,
    costMultiplier: 2,
    itemCostsPerLevel: CURSED_VIAL_LADDER,
    statKey: 'moveSpeed',
    statPerLevel: 0.4,
  },
  {
    id: 'poisonRes',
    name: 'Poison Ward',
    description: 'Resistance to poison effects.',
    baseSoulCost: 80,
    costMultiplier: 2,
    itemCostsPerLevel: BONE_SHARD_LADDER,
    statKey: 'poisonRes',
    statPerLevel: 0.03,
  },
  {
    id: 'possessionRes',
    name: 'Possession Ward',
    description: 'Resistance to possession effects.',
    baseSoulCost: 80,
    costMultiplier: 2,
    itemCostsPerLevel: CURSED_VIAL_LADDER,
    statKey: 'possessionRes',
    statPerLevel: 0.03,
  },
  {
    id: 'fearRes',
    name: 'Fear Ward',
    description: 'Resistance to fear effects.',
    baseSoulCost: 80,
    costMultiplier: 2,
    itemCostsPerLevel: SOUL_CRYSTAL_LADDER,
    statKey: 'fearRes',
    statPerLevel: 0.03,
  },
  {
    id: 'critChance',
    name: 'Critical Eye',
    description: 'Chance to land critical hits.',
    baseSoulCost: 200,
    costMultiplier: 2,
    itemCostsPerLevel: SOUL_CRYSTAL_LADDER,
    statKey: 'critChance',
    statPerLevel: 0.03,
  },
  {
    id: 'luck',
    name: 'Fortune',
    description: 'Improves item drop rolls.',
    baseSoulCost: 150,
    costMultiplier: 2,
    itemCostsPerLevel: GRIM_EMBER_LADDER,
    statKey: 'luck',
    statPerLevel: 0.03,
  },
] as const;

export const SKILL_UPGRADES: readonly SkillUpgradeDef[] = [
  {
    id: 'fistOfAnnoyance',
    name: 'Fist of Annoyance',
    description: 'Giant fists slam the battlefield.',
    maxLevel: 3,
    comingSoon: false,
    levelDescriptions: [
      'One fist strikes your target.',
      'Two fists strike separate enemies.',
      'Three fists — maximum annoyance.',
    ],
    levelCosts: [
      {
        souls: 500,
        items: [
          { itemId: 'bone_shard', qty: 20 },
          { itemId: 'cursed_vial', qty: 5 },
        ],
      },
      {
        souls: 1000,
        items: [
          { itemId: 'bone_shard', qty: 50 },
          {
            itemId: 'soul_crystal',
            qty: 10,
            oneOf: [
              { itemId: 'soul_crystal', qty: 10 },
              { itemId: 'brute_core', qty: 5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'soulThrow',
    name: 'Soul Throw',
    description: 'Right-click to throw soul blades at your aim.',
    maxLevel: 3,
    comingSoon: false,
    levelDescriptions: [
      'One blade — out and back.',
      'Three blades in an arc toward your aim.',
      'Three weaker blades; attack freely. 10s cooldown.',
    ],
    levelCosts: [
      {
        souls: 400,
        items: [
          { itemId: 'bone_shard', qty: 15 },
          { itemId: 'cursed_vial', qty: 3 },
        ],
      },
      {
        souls: 900,
        items: [
          { itemId: 'bone_shard', qty: 40 },
          { itemId: 'soul_crystal', qty: 8 },
        ],
      },
      {
        souls: 1500,
        items: [
          { itemId: 'bone_shard', qty: 60 },
          { itemId: 'grim_ember', qty: 5 },
          { itemId: 'void_relic', qty: 2 },
        ],
      },
    ],
  },
  {
    id: 'soulShriek',
    name: 'Soul Shriek',
    description: 'Coming soon.',
    maxLevel: 1,
    comingSoon: true,
    levelDescriptions: ['Locked'],
    levelCosts: [],
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
  {
    id: 'reapersVeil',
    name: "Reaper's Veil",
    description: 'Coming soon.',
    maxLevel: 1,
    comingSoon: true,
    levelDescriptions: ['Locked'],
    levelCosts: [],
  },
] as const;

export function getStatUpgradeById(id: string): GrimStatUpgradeDef | undefined {
  return GRIM_STAT_UPGRADES.find((u) => u.id === id);
}

export function getSkillUpgradeById(id: string): SkillUpgradeDef | undefined {
  return SKILL_UPGRADES.find((u) => u.id === id);
}

/** Item costs for the next stat level purchase (repeats last ladder entry). */
export function getStatItemCostsForLevel(
  def: GrimStatUpgradeDef,
  nextLevelIndex: number,
): readonly ItemCost[] {
  const ladder = def.itemCostsPerLevel;
  if (ladder.length === 0) {
    return [];
  }
  const idx = Math.min(nextLevelIndex, ladder.length - 1);
  return ladder[idx] ?? [];
}

/** Soul cost for the next stat level purchase. */
export function getStatSoulCostForLevel(
  def: GrimStatUpgradeDef,
  currentLevel: number,
): number {
  return Math.floor(def.baseSoulCost * def.costMultiplier ** currentLevel);
}
