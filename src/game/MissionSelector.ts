import { getMissionPoolById } from '../data/mission-pools.js';
import type { MissionConfig } from '../data/mission-types.js';
import { createReapAndSaveMissionConfig } from '../data/mission-types.js';
import type { RiskLevel } from '../data/risk-levels.js';
import {
  formatMissionConfigBriefing,
  rollMissionBoard,
  rollRandomMissionForPool,
} from './mission-roll.js';

export {
  formatMissionConfigBriefing,
  rollMissionBoard,
  type MissionBoard,
} from './mission-roll.js';

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

/** Legacy roll for reap-and-save pool only. */
export function rollMissionConfig(poolId: string, riskLevel: RiskLevel): MissionConfig {
  const pool = getMissionPoolById(poolId);
  if (pool?.type === 'reap-and-save') {
    const range = pool.riskRanges[riskLevel];
    return createReapAndSaveMissionConfig({
      soulsRequired: randomIntInclusive(range.soulsRequired[0], range.soulsRequired[1]),
      innocentsToSave: randomIntInclusive(range.innocentsToSave[0], range.innocentsToSave[1]),
      riskLevel,
    });
  }
  return rollRandomMissionForPool(poolId, riskLevel);
}

export function rollMissionConfigForPoolId(
  poolId: string,
  riskLevel: RiskLevel,
): MissionConfig | undefined {
  const board = rollMissionBoard(poolId);
  return board[riskLevel];
}

export function getMissionGoalPreview(
  poolId: string,
  riskLevel: RiskLevel,
): string | undefined {
  const board = rollMissionBoard(poolId);
  const config = board[riskLevel];
  if (!config) {
    return undefined;
  }
  return formatMissionConfigBriefing(config);
}
