/** Playable risk tiers (1 = easiest, 5 = hardest). */
export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export const RISK_LEVELS: readonly RiskLevel[] = [1, 2, 3, 4, 5] as const;

/** Scaling knobs applied when a mission runs at a given risk level. */
export interface RiskLevelConfig {
  enemyHealthMult: number;
  enemyDamageMult: number;
  /** Seconds to save the active innocent before they die. */
  innocentSaveTimeLimitSec: number;
  /** Extra weight for elite horde spawns (0 = none at risk 1). */
  eliteSpawnWeight: number;
  /** Passive collateral rise per second (0.1 = +1% every 10s). */
  collateralTickPerSecond: number;
  /** Collateral jump when an innocent dies (%). */
  collateralJumpOnInnocentDeath: number;
}

export const RISK_LEVEL_CONFIG: Record<RiskLevel, RiskLevelConfig> = {
  1: {
    enemyHealthMult: 1.0,
    enemyDamageMult: 1.0,
    innocentSaveTimeLimitSec: 90,
    eliteSpawnWeight: 0,
    collateralTickPerSecond: 0.1,
    collateralJumpOnInnocentDeath: 20,
  },
  2: {
    enemyHealthMult: 1.25,
    enemyDamageMult: 1.15,
    innocentSaveTimeLimitSec: 70,
    eliteSpawnWeight: 2,
    collateralTickPerSecond: 0.12,
    collateralJumpOnInnocentDeath: 20,
  },
  3: {
    enemyHealthMult: 1.5,
    enemyDamageMult: 1.3,
    innocentSaveTimeLimitSec: 50,
    eliteSpawnWeight: 4,
    collateralTickPerSecond: 0.15,
    collateralJumpOnInnocentDeath: 22,
  },
  4: {
    enemyHealthMult: 2.0,
    enemyDamageMult: 1.5,
    innocentSaveTimeLimitSec: 35,
    eliteSpawnWeight: 6,
    collateralTickPerSecond: 0.18,
    collateralJumpOnInnocentDeath: 25,
  },
  5: {
    enemyHealthMult: 2.5,
    enemyDamageMult: 2.0,
    innocentSaveTimeLimitSec: 20,
    eliteSpawnWeight: 10,
    collateralTickPerSecond: 0.22,
    collateralJumpOnInnocentDeath: 25,
  },
};

export function getRiskLevelConfig(level: RiskLevel): RiskLevelConfig {
  return RISK_LEVEL_CONFIG[level];
}

export function isRiskLevel(value: number): value is RiskLevel {
  return value >= 1 && value <= 5 && Number.isInteger(value);
}
