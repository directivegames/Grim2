import type { GrimStatUpgradeDef, ItemCost, SkillUpgradeDef } from '../data/upgrades.js';
import { getItemById } from '../data/items.js';

export function formatStatBonusPerLevel(def: GrimStatUpgradeDef): string {
  switch (def.statKey) {
    case 'maxHealth':
      return `+${def.statPerLevel} HP`;
    case 'moveSpeed':
      return `+${def.statPerLevel} speed`;
    case 'attackMult':
    case 'defence':
    case 'poisonRes':
    case 'possessionRes':
    case 'fearRes':
    case 'critChance':
    case 'luck':
      return `+${Math.round(def.statPerLevel * 100)}%`;
    default:
      return `+${def.statPerLevel}`;
  }
}

export function formatItemCost(cost: ItemCost): string {
  if (cost.oneOf && cost.oneOf.length > 0) {
    return cost.oneOf
      .map((opt) => `${opt.qty} ${getItemById(opt.itemId)?.name ?? opt.itemId}`)
      .join(' OR ');
  }
  const name = getItemById(cost.itemId)?.name ?? cost.itemId;
  return `${cost.qty} ${name}`;
}

export function formatItemCosts(costs: readonly ItemCost[]): string {
  if (costs.length === 0) {
    return '—';
  }
  return costs.map(formatItemCost).join(', ');
}

export function skillLevelPips(current: number, max: number): string {
  const filled = '●'.repeat(Math.min(current, max));
  const empty = '○'.repeat(Math.max(0, max - current));
  return filled + empty;
}

export function skillCurrentDescription(def: SkillUpgradeDef, level: number): string {
  const idx = Math.max(0, Math.min(level - 1, def.levelDescriptions.length - 1));
  return def.levelDescriptions[idx] ?? def.description;
}
