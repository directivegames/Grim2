import type { RiskLevel } from './risk-levels.js';

/** Min/max goals rolled when a mission starts at a given risk tier. */
export interface MissionRiskRange {
  soulsRequired: readonly [min: number, max: number];
  innocentsToSave: readonly [min: number, max: number];
}

export interface MissionPoolDef {
  id: string;
  riskRanges: Record<RiskLevel, MissionRiskRange>;
}

export const MISSION_POOLS: readonly MissionPoolDef[] = [
  {
    id: 'suburbs',
    riskRanges: {
      1: { soulsRequired: [280, 320], innocentsToSave: [5, 7] },
      2: { soulsRequired: [320, 380], innocentsToSave: [6, 8] },
      3: { soulsRequired: [380, 450], innocentsToSave: [7, 9] },
      4: { soulsRequired: [450, 520], innocentsToSave: [8, 10] },
      5: { soulsRequired: [520, 600], innocentsToSave: [9, 11] },
    },
  },
] as const;

export function getMissionPoolById(id: string): MissionPoolDef | undefined {
  return MISSION_POOLS.find((pool) => pool.id === id);
}

export function formatMissionGoalPreview(pool: MissionPoolDef, riskLevel: RiskLevel): string {
  const range = pool.riskRanges[riskLevel];
  return `Reap ${range.soulsRequired[0]}–${range.soulsRequired[1]} souls and save ${range.innocentsToSave[0]}–${range.innocentsToSave[1]} innocents (rolled per run).`;
}
