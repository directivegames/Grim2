import { getMissionPoolById } from '../data/mission-pools.js';
import type { MissionConfig, MissionTypeId } from '../data/mission-types.js';
import {
  createBossFightMissionConfig,
  createCauseDamageMissionConfig,
  createChainReapMissionConfig,
  createReapAndSaveMissionConfig,
  createReapBeforeCollateralMissionConfig,
  createReapMissionConfig,
  createSoulSaverMissionConfig,
  createSpeedReapMissionConfig,
  createSurviveMissionConfig,
  getMissionTypeDisplayName,
  SUBURBS_TUTORIAL_MISSION_CONFIG,
} from '../data/mission-types.js';
import type { RiskLevel } from '../data/risk-levels.js';
import { RISK_LEVELS } from '../data/risk-levels.js';
import { grimVault } from './GrimVault.js';

export type MissionBoard = Partial<Record<RiskLevel, MissionConfig>>;

const ALL_RISK_MISSION_TYPES: readonly MissionTypeId[] = [
  'reap-and-save',
  'survive',
  'reap',
  'soul-saver',
  'cause-damage',
  'reap-before-collateral',
  'speed-reap',
  'chain-reap',
] as const;

const RISK_2_PLUS_MISSION_TYPES: readonly MissionTypeId[] = [
  ...ALL_RISK_MISSION_TYPES,
  'boss-fight',
] as const;

function randomIntInclusive(min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

/** Interpolate a [min,max] pair from risk 1 → risk 5. */
function rangeForRisk(
  risk: RiskLevel,
  at1: readonly [number, number],
  at5: readonly [number, number],
): readonly [number, number] {
  if (risk <= 1) {
    return at1;
  }
  if (risk >= 5) {
    return at5;
  }
  const t = (risk - 1) / 4;
  const min = Math.round(at1[0] + (at5[0] - at1[0]) * t);
  const max = Math.round(at1[1] + (at5[1] - at1[1]) * t);
  return [Math.min(min, max), Math.max(min, max)] as const;
}

function rollInScaledRange(
  risk: RiskLevel,
  at1: readonly [number, number],
  at5: readonly [number, number],
): number {
  const [min, max] = rangeForRisk(risk, at1, at5);
  return randomIntInclusive(min, max);
}

function pickRandomMissionType(risk: RiskLevel): MissionTypeId {
  const pool = risk >= 2 ? RISK_2_PLUS_MISSION_TYPES : ALL_RISK_MISSION_TYPES;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? 'reap';
}

function rollReapAndSave(risk: RiskLevel): MissionConfig {
  const pool = getMissionPoolById('suburbs');
  if (pool?.type === 'reap-and-save') {
    const range = pool.riskRanges[risk];
    return createReapAndSaveMissionConfig({
      soulsRequired: randomIntInclusive(range.soulsRequired[0], range.soulsRequired[1]),
      innocentsToSave: randomIntInclusive(range.innocentsToSave[0], range.innocentsToSave[1]),
      riskLevel: risk,
    });
  }
  return createReapAndSaveMissionConfig({
    soulsRequired: rollInScaledRange(risk, [180, 220], [580, 680]),
    innocentsToSave: rollInScaledRange(risk, [4, 5], [10, 12]),
    riskLevel: risk,
  });
}

export function rollMissionConfigForType(
  type: MissionTypeId,
  risk: RiskLevel,
): MissionConfig {
  switch (type) {
    case 'reap-and-save':
      return rollReapAndSave(risk);
    case 'survive':
      return createSurviveMissionConfig(
        rollInScaledRange(risk, [120, 180], [360, 480]),
        risk,
      );
    case 'reap':
      return createReapMissionConfig(
        rollInScaledRange(risk, [120, 180], [900, 1200]),
        risk,
      );
    case 'soul-saver':
      return createSoulSaverMissionConfig(
        rollInScaledRange(risk, [8, 12], [18, 28]),
        risk,
      );
    case 'cause-damage':
      return createCauseDamageMissionConfig(
        rollInScaledRange(risk, [6000, 9000], [28000, 42000]),
        risk,
      );
    case 'reap-before-collateral':
      return createReapBeforeCollateralMissionConfig(
        rollInScaledRange(risk, [100, 160], [800, 1100]),
        risk,
      );
    case 'speed-reap':
      return createSpeedReapMissionConfig(
        rollInScaledRange(risk, [100, 140], [700, 900]),
        rollInScaledRange(risk, [240, 300], [300, 360]),
        risk,
      );
    case 'chain-reap':
      return createChainReapMissionConfig(
        rollInScaledRange(risk, [20, 28], [70, 95]),
        rollInScaledRange(risk, [240, 300], [240, 300]),
        0,
        risk,
      );
    case 'boss-fight':
      return createBossFightMissionConfig(risk);
    default:
      return createReapMissionConfig(500, risk);
  }
}

export function rollRandomMissionForPool(_poolId: string, risk: RiskLevel): MissionConfig {
  const type = pickRandomMissionType(risk);
  return rollMissionConfigForType(type, risk);
}

/** Roll one mission per unlocked risk tier (fresh each map visit). */
export function rollMissionBoard(poolId: string): MissionBoard {
  if (!grimVault.isTutorialCompleted()) {
    return { 1: SUBURBS_TUTORIAL_MISSION_CONFIG };
  }

  const unlocked = grimVault.getUnlockedRiskLevel();
  const board: MissionBoard = {};
  for (const risk of RISK_LEVELS) {
    if (risk <= unlocked) {
      board[risk] = rollRandomMissionForPool(poolId, risk);
    }
  }
  return board;
}

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m <= 0) {
    return `${s}s`;
  }
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Exact briefing line for a rolled mission (no ranges). */
export function formatMissionConfigBriefing(config: MissionConfig): string {
  const typeName = getMissionTypeDisplayName(config.type);

  switch (config.type) {
    case 'reap-and-save':
      return `GOALS: Reap ${config.soulsRequired} souls · Save ${config.innocentsToSave} innocents
WHAT: Kill enemies to collect souls, and reach innocents before their timers expire.
MODIFIERS: (coming soon)`;
    case 'survive':
      return `GOALS: Survive ${formatDuration(config.durationSec)}
WHAT: Stay alive until the timer runs out.
MODIFIERS: (coming soon)`;
    case 'reap':
      return `GOALS: Reap ${config.soulsRequired} souls
WHAT: Kill enemies until you hit the soul target.
MODIFIERS: (coming soon)`;
    case 'soul-saver':
      return `GOALS: Save ${config.soulsToSave} innocents
WHAT: Find and save innocents before they die.
MODIFIERS: (coming soon)`;
    case 'cause-damage':
      return `GOALS: Deal ${config.damageRequired.toLocaleString()} damage
WHAT: Hit enemies fast—finish before collateral reaches 100%.
MODIFIERS: (coming soon)`;
    case 'reap-before-collateral':
      return `GOALS: Reap ${config.soulsRequired} souls
WHAT: Kill enemies until you hit the target—before collateral reaches 100%.
MODIFIERS: (coming soon)`;
    case 'speed-reap':
      return `GOALS: Reap ${config.soulsRequired} souls in ${formatDuration(config.timeLimitSec)}
WHAT: Kill enemies quickly—beat the timer.
MODIFIERS: (coming soon)`;
    case 'chain-reap': {
      const mins = Math.floor(config.timeLimitSec / 60);
      const secs = config.timeLimitSec % 60;
      const timeStr = mins > 0 ? (secs > 0 ? `${mins}m ${secs}s` : `${mins}m`) : `${secs}s`;
      return `GOALS: ${config.killsRequired} combo kills (combo 10+)
WHAT: Build combo to 10+ — then kills count. Drop the combo and progress pauses until you rebuild. Finish before collateral hits 100% (${timeStr} limit once chain is live).
MODIFIERS: (coming soon)`;
    }
    case 'boss-fight':
      return `GOALS: Defeat the Postman
WHAT: Dodge demonletters and bring him down.
MODIFIERS: (coming soon)`;
    default:
      return typeName;
  }
}
