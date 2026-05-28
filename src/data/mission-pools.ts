import type { MissionTypeId } from './mission-types.js';
import type { RiskLevel } from './risk-levels.js';

/** Min/max goals rolled when a mission starts at a given risk tier. */
export interface ReapAndSaveRiskRange {
  soulsRequired: readonly [min: number, max: number];
  innocentsToSave: readonly [min: number, max: number];
}

export interface MissionPoolDef {
  id: string;
  type: MissionTypeId;
  riskRanges: Record<RiskLevel, ReapAndSaveRiskRange>;
}

export const MISSION_POOLS: readonly MissionPoolDef[] = [
  {
    id: 'suburbs',
    type: 'reap-and-save',
    riskRanges: {
      1: { soulsRequired: [180, 220], innocentsToSave: [4, 5] },
      2: { soulsRequired: [260, 320], innocentsToSave: [5, 7] },
      3: { soulsRequired: [360, 440], innocentsToSave: [6, 8] },
      4: { soulsRequired: [480, 560], innocentsToSave: [8, 10] },
      5: { soulsRequired: [580, 680], innocentsToSave: [10, 12] },
    },
  },
] as const;

export function getMissionPoolById(id: string): MissionPoolDef | undefined {
  return MISSION_POOLS.find((pool) => pool.id === id);
}

/** @deprecated Use formatMissionConfigBriefing from mission-roll.ts */
export function formatMissionGoalPreview(pool: MissionPoolDef, riskLevel: RiskLevel): string {
  const range = pool.riskRanges[riskLevel];
  return `Reap ${range.soulsRequired[0]}–${range.soulsRequired[1]} souls and save ${range.innocentsToSave[0]}–${range.innocentsToSave[1]} innocents (rolled per run).`;
}
