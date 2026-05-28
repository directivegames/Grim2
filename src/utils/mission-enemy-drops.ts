import { ENEMY_TYPE_ZOMBIE } from '../data/items.js';
import { grimVault } from '../game/GrimVault.js';
import { missionState } from '../mission/MissionState.js';
import { rollExclusiveItemDrop, rollGeneralItemDrop } from './item-drop.js';

/**
 * Roll and queue an item drop when an enemy dies during an active mission.
 * @param enemyTypeId Horde registry id (`big_undead`) or `zombie` for normal kills.
 */
export function tryRollMissionItemDropOnEnemyKill(
  enemyTypeId: string = ENEMY_TYPE_ZOMBIE,
): void {
  if (!missionState.isActive) {
    return;
  }

  const config = missionState.config;
  if (!config) {
    return;
  }

  const luck = grimVault.computeStats().luck;
  const risk = config.riskLevel;

  if (enemyTypeId !== ENEMY_TYPE_ZOMBIE) {
    const exclusive = rollExclusiveItemDrop(enemyTypeId, risk, luck);
    if (exclusive) {
      missionState.addItemDrop(exclusive);
      return;
    }
  }

  const general = rollGeneralItemDrop(risk, luck);
  if (general) {
    missionState.addItemDrop(general);
  }
}
