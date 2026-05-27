import {
  formatMissionGoalPreview,
  getMissionPoolById,
  type MissionPoolDef,
} from '../data/mission-pools.js';
import type { MissionConfig } from '../data/mission-types.js';
import { createReapAndSaveMissionConfig } from '../data/mission-types.js';
import type { RiskLevel } from '../data/risk-levels.js';

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

/**
 * Roll souls/innocent targets for the chosen risk tier.
 * Called when the player confirms START on the map briefing.
 */
export function rollMissionConfig(pool: MissionPoolDef, riskLevel: RiskLevel): MissionConfig {
  const range = pool.riskRanges[riskLevel];
  return createReapAndSaveMissionConfig({
    soulsRequired: randomIntInclusive(range.soulsRequired[0], range.soulsRequired[1]),
    innocentsToSave: randomIntInclusive(range.innocentsToSave[0], range.innocentsToSave[1]),
    riskLevel,
  });
}

export function rollMissionConfigForPoolId(
  poolId: string,
  riskLevel: RiskLevel,
): MissionConfig | undefined {
  const pool = getMissionPoolById(poolId);
  if (!pool) {
    return undefined;
  }
  return rollMissionConfig(pool, riskLevel);
}

export function getMissionGoalPreview(poolId: string, riskLevel: RiskLevel): string | undefined {
  const pool = getMissionPoolById(poolId);
  if (!pool) {
    return undefined;
  }
  return formatMissionGoalPreview(pool, riskLevel);
}
