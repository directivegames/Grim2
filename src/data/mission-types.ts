import {
  getRiskLevelConfig,
  type RiskLevel,
} from './risk-levels.js';

/** Mission objective templates — more types can be added later. */
export type MissionTypeId = 'reap-and-save';

/** Runtime rules for a single play session. */
export interface ReapAndSaveMissionConfig {
  readonly type: 'reap-and-save';
  readonly soulsRequired: number;
  readonly innocentsToSave: number;
  /** Seconds to save the active innocent before they die (timer expiry only). */
  readonly innocentSaveTimeLimitSec: number;
  /** Passive collateral rise per second (0.1 = +1% every 10s). */
  readonly collateralTickPerSecond: number;
  /** Collateral jump when an innocent dies (%). */
  readonly collateralJumpOnInnocentDeath: number;
  readonly riskLevel: RiskLevel;
}

export type MissionConfig = ReapAndSaveMissionConfig;

export interface CreateReapAndSaveOptions {
  soulsRequired: number;
  innocentsToSave: number;
  riskLevel: RiskLevel;
  /** Override save time limit; defaults from risk level table. */
  innocentSaveTimeLimitSec?: number;
  /** Override passive collateral tick; defaults from risk level table. */
  collateralTickPerSecond?: number;
  /** Override innocent-death collateral jump; defaults from risk level table. */
  collateralJumpOnInnocentDeath?: number;
}

/** Build a reap-and-save mission config using risk-level defaults for scaling fields. */
export function createReapAndSaveMissionConfig(
  options: CreateReapAndSaveOptions,
): ReapAndSaveMissionConfig {
  const risk = getRiskLevelConfig(options.riskLevel);

  return {
    type: 'reap-and-save',
    soulsRequired: options.soulsRequired,
    innocentsToSave: options.innocentsToSave,
    innocentSaveTimeLimitSec:
      options.innocentSaveTimeLimitSec ?? risk.innocentSaveTimeLimitSec,
    collateralTickPerSecond:
      options.collateralTickPerSecond ?? risk.collateralTickPerSecond,
    collateralJumpOnInnocentDeath:
      options.collateralJumpOnInnocentDeath ?? risk.collateralJumpOnInnocentDeath,
    riskLevel: options.riskLevel,
  };
}

/**
 * Fixed tutorial suburbs run — always risk 1, 300 souls, 6 innocents.
 * Used until random mission pools and Grim upgrades are implemented.
 */
export const SUBURBS_TUTORIAL_MISSION_CONFIG: ReapAndSaveMissionConfig =
  createReapAndSaveMissionConfig({
    soulsRequired: 300,
    innocentsToSave: 6,
    riskLevel: 1,
  });

export function isReapAndSaveMission(
  config: MissionConfig,
): config is ReapAndSaveMissionConfig {
  return config.type === 'reap-and-save';
}
