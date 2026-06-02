import type { RiskLevel } from './risk-levels.js';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** Horde registry id — used with `dropFromEnemyIds`. */
export const ENEMY_TYPE_ZOMBIE = 'zombie';

/** Horde registry id for the Demonbox suicide-bomber enemy. */
export const ENEMY_TYPE_DEMONBOX = 'demonbox';

/** One collectible item — edit this file to add or tune drops. */
export interface ItemDef {
  id: string;
  name: string;
  description: string;
  /** Filename under `assets/UI/` (must match file on disk). */
  iconFile: string;
  rarity: ItemRarity;
  /** Relative drop weight; higher = more common within eligible pool. */
  dropWeight: number;
  /** Minimum mission risk level before this item can drop. */
  minRiskLevel: RiskLevel;
  /**
   * If set, this item only drops from these enemy types (see HordeEnemyRegistry ids).
   * Omitted = general pool (any kill can roll it).
   */
  dropFromEnemyIds?: readonly string[];
}

export const ITEMS: readonly ItemDef[] = [
  {
    id: 'bone_shard',
    name: 'Bone Shard',
    description: 'Splintered remains. Common reagent for Grim\'s upgrades.',
    iconFile: 'Boneshard.webp',
    rarity: 'common',
    dropWeight: 60,
    minRiskLevel: 1,
  },
  {
    id: 'cursed_vial',
    name: 'Cursed Vial',
    description: 'Murky essence bottled from the restless dead.',
    iconFile: 'cursedvial.webp',
    rarity: 'uncommon',
    dropWeight: 30,
    minRiskLevel: 2,
  },
  {
    id: 'soul_crystal',
    name: 'Soul Crystal',
    description: 'Condensed soul-light. Rare and potent.',
    iconFile: 'soulcrystal.webp',
    rarity: 'rare',
    dropWeight: 8,
    minRiskLevel: 3,
  },
  {
    id: 'grim_ember',
    name: 'Grim Ember',
    description: 'A spark from the underworld. Legendary crafting fuel.',
    iconFile: 'grimember.webp',
    rarity: 'legendary',
    dropWeight: 2,
    minRiskLevel: 4,
  },
  {
    id: 'void_relic',
    name: 'Void Relic',
    description: 'A fragment from beyond the veil. Only the highest-risk reaps yield these.',
    iconFile: 'voidrelic.webp',
    rarity: 'legendary',
    dropWeight: 1,
    minRiskLevel: 5,
  },
  {
    id: 'brute_core',
    name: 'Brute Core',
    description: 'Dense core from a fallen giant. Optional shortcut for elite skill upgrades.',
    iconFile: 'brutecore.webp',
    rarity: 'rare',
    dropWeight: 12,
    minRiskLevel: 2,
    dropFromEnemyIds: ['big_undead'],
  },
] as const;

export function getItemById(id: string): ItemDef | undefined {
  return ITEMS.find((item) => item.id === id);
}

/** Items that can drop from routine enemy kills (not exclusive to one enemy type). */
export function getGeneralDropPool(riskLevel: RiskLevel): ItemDef[] {
  return ITEMS.filter(
    (item) =>
      !item.dropFromEnemyIds?.length &&
      item.minRiskLevel <= riskLevel,
  );
}

/** Items exclusive to a specific enemy type at the current risk tier. */
export function getExclusiveDropPool(
  enemyTypeId: string,
  riskLevel: RiskLevel,
): ItemDef[] {
  return ITEMS.filter(
    (item) =>
      item.dropFromEnemyIds?.includes(enemyTypeId) &&
      item.minRiskLevel <= riskLevel,
  );
}

/** Resolved asset path for UI (same folder as fistofa.png, HealthBG.png, map icons). */
export function itemIconProjectPath(iconFile: string): string {
  return `@project/assets/UI/${iconFile}`;
}
