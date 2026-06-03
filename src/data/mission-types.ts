import {
  getRiskLevelConfig,
  type RiskLevel,
} from './risk-levels.js';

/** All mission objective templates. */
export type MissionTypeId =
  | 'reap-and-save'
  | 'survive'
  | 'reap'
  | 'soul-saver'
  | 'cause-damage'
  | 'reap-before-collateral'
  | 'speed-reap'
  | 'chain-reap'
  | 'boss-fight';

interface MissionConfigBase {
  readonly riskLevel: RiskLevel;
  /** Risk 5+ endless tier for this run (0 = normal mission). */
  readonly risk5PlusTier?: number;
}

/** Reap souls and save innocents before collateral hits 100%. */
export interface ReapAndSaveMissionConfig extends MissionConfigBase {
  readonly type: 'reap-and-save';
  readonly soulsRequired: number;
  readonly innocentsToSave: number;
  readonly innocentSaveTimeLimitSec: number;
  readonly collateralTickPerSecond: number;
  readonly collateralJumpOnInnocentDeath: number;
}

/** Stay alive until the timer runs out. */
export interface SurviveMissionConfig extends MissionConfigBase {
  readonly type: 'survive';
  readonly durationSec: number;
}

/** Reap a target number of souls. */
export interface ReapMissionConfig extends MissionConfigBase {
  readonly type: 'reap';
  readonly soulsRequired: number;
}

/** Save innocents without being defeated (no collateral meter). */
export interface SoulSaverMissionConfig extends MissionConfigBase {
  readonly type: 'soul-saver';
  readonly soulsToSave: number;
  readonly innocentSaveTimeLimitSec: number;
}

/** Deal damage before collateral reaches 100%. */
export interface CauseDamageMissionConfig extends MissionConfigBase {
  readonly type: 'cause-damage';
  readonly damageRequired: number;
  readonly collateralTickPerSecond: number;
  readonly collateralJumpOnInnocentDeath: number;
}

/** Reap souls before collateral reaches 100%. */
export interface ReapBeforeCollateralMissionConfig extends MissionConfigBase {
  readonly type: 'reap-before-collateral';
  readonly soulsRequired: number;
  readonly collateralTickPerSecond: number;
  readonly collateralJumpOnInnocentDeath: number;
}

/** Reap souls before a hard time limit. */
export interface SpeedReapMissionConfig extends MissionConfigBase {
  readonly type: 'speed-reap';
  readonly soulsRequired: number;
  readonly timeLimitSec: number;
}

/** Reap souls while keeping the combo chain alive. */
export interface ChainReapMissionConfig extends MissionConfigBase {
  readonly type: 'chain-reap';
  /** Kills that count once combo is at least CHAIN_REAP_MIN_COMBO. */
  readonly killsRequired: number;
  /** Countdown starts on first counted kill (combo ≥ threshold). */
  readonly timeLimitSec: number;
  /** Reserved — combo drop pauses counting; no fail on combo loss. */
  readonly comboGracePeriodSec: number;
  readonly collateralTickPerSecond: number;
  readonly collateralJumpOnInnocentDeath: number;
}

/** Solo boss fight — defeat the Postman with no horde spawns. */
export interface BossFightMissionConfig extends MissionConfigBase {
  readonly type: 'boss-fight';
  readonly bossId: 'postman';
}

export type MissionConfig =
  | ReapAndSaveMissionConfig
  | SurviveMissionConfig
  | ReapMissionConfig
  | SoulSaverMissionConfig
  | CauseDamageMissionConfig
  | ReapBeforeCollateralMissionConfig
  | SpeedReapMissionConfig
  | ChainReapMissionConfig
  | BossFightMissionConfig;

export interface CreateReapAndSaveOptions {
  soulsRequired: number;
  innocentsToSave: number;
  riskLevel: RiskLevel;
  innocentSaveTimeLimitSec?: number;
  collateralTickPerSecond?: number;
  collateralJumpOnInnocentDeath?: number;
}

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

export function createSurviveMissionConfig(
  durationSec: number,
  riskLevel: RiskLevel,
): SurviveMissionConfig {
  return { type: 'survive', durationSec, riskLevel };
}

export function createReapMissionConfig(
  soulsRequired: number,
  riskLevel: RiskLevel,
): ReapMissionConfig {
  return { type: 'reap', soulsRequired, riskLevel };
}

export function createSoulSaverMissionConfig(
  soulsToSave: number,
  riskLevel: RiskLevel,
  innocentSaveTimeLimitSec?: number,
): SoulSaverMissionConfig {
  const risk = getRiskLevelConfig(riskLevel);
  return {
    type: 'soul-saver',
    soulsToSave,
    innocentSaveTimeLimitSec:
      innocentSaveTimeLimitSec ?? risk.innocentSaveTimeLimitSec,
    riskLevel,
  };
}

export function createCauseDamageMissionConfig(
  damageRequired: number,
  riskLevel: RiskLevel,
): CauseDamageMissionConfig {
  const risk = getRiskLevelConfig(riskLevel);
  return {
    type: 'cause-damage',
    damageRequired,
    collateralTickPerSecond: risk.collateralTickPerSecond,
    collateralJumpOnInnocentDeath: risk.collateralJumpOnInnocentDeath,
    riskLevel,
  };
}

export function createReapBeforeCollateralMissionConfig(
  soulsRequired: number,
  riskLevel: RiskLevel,
): ReapBeforeCollateralMissionConfig {
  const risk = getRiskLevelConfig(riskLevel);
  return {
    type: 'reap-before-collateral',
    soulsRequired,
    collateralTickPerSecond: risk.collateralTickPerSecond,
    collateralJumpOnInnocentDeath: risk.collateralJumpOnInnocentDeath,
    riskLevel,
  };
}

export function createSpeedReapMissionConfig(
  soulsRequired: number,
  timeLimitSec: number,
  riskLevel: RiskLevel,
): SpeedReapMissionConfig {
  return { type: 'speed-reap', soulsRequired, timeLimitSec, riskLevel };
}

export function createChainReapMissionConfig(
  killsRequired: number,
  timeLimitSec: number,
  comboGracePeriodSec: number,
  riskLevel: RiskLevel,
  risk5PlusTier = 0,
): ChainReapMissionConfig {
  const risk = getRiskLevelConfig(riskLevel);
  return {
    type: 'chain-reap',
    killsRequired,
    timeLimitSec,
    comboGracePeriodSec,
    collateralTickPerSecond: risk.collateralTickPerSecond,
    collateralJumpOnInnocentDeath: risk.collateralJumpOnInnocentDeath,
    riskLevel,
    risk5PlusTier,
  };
}

export function createBossFightMissionConfig(riskLevel: RiskLevel): BossFightMissionConfig {
  return {
    type: 'boss-fight',
    bossId: 'postman',
    riskLevel,
  };
}

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

export function isSurviveMission(config: MissionConfig): config is SurviveMissionConfig {
  return config.type === 'survive';
}

export function isReapMission(config: MissionConfig): config is ReapMissionConfig {
  return config.type === 'reap';
}

export function isSoulSaverMission(config: MissionConfig): config is SoulSaverMissionConfig {
  return config.type === 'soul-saver';
}

export function isCauseDamageMission(
  config: MissionConfig,
): config is CauseDamageMissionConfig {
  return config.type === 'cause-damage';
}

export function isReapBeforeCollateralMission(
  config: MissionConfig,
): config is ReapBeforeCollateralMissionConfig {
  return config.type === 'reap-before-collateral';
}

export function isSpeedReapMission(config: MissionConfig): config is SpeedReapMissionConfig {
  return config.type === 'speed-reap';
}

export function isChainReapMission(config: MissionConfig): config is ChainReapMissionConfig {
  return config.type === 'chain-reap';
}

export function isBossFightMission(config: MissionConfig): config is BossFightMissionConfig {
  return config.type === 'boss-fight';
}

/** Mission uses the collateral damage meter and fail-at-100% rule. */
export function missionUsesCollateral(config: MissionConfig): boolean {
  return (
    isReapAndSaveMission(config) ||
    isCauseDamageMission(config) ||
    isReapBeforeCollateralMission(config) ||
    isChainReapMission(config)
  );
}

/** Mission spawns innocents and tracks soul saves. */
export function missionUsesInnocents(config: MissionConfig): boolean {
  return isReapAndSaveMission(config) || isSoulSaverMission(config);
}

/** Mission tracks souls reaped toward a goal. */
export function missionTracksSoulReap(config: MissionConfig): boolean {
  return (
    isReapAndSaveMission(config) ||
    isReapMission(config) ||
    isReapBeforeCollateralMission(config) ||
    isSpeedReapMission(config)
  );
}

export function missionTracksChainKills(config: MissionConfig): boolean {
  return isChainReapMission(config);
}

/** Horde should spawn faster (chain-reap). */
export function missionUsesAggressiveSpawn(config: MissionConfig): boolean {
  return isChainReapMission(config);
}

export function getMissionTypeDisplayName(type: MissionTypeId): string {
  switch (type) {
    case 'reap-and-save':
      return 'Reap and Save';
    case 'survive':
      return 'Survive';
    case 'reap':
      return 'Reap';
    case 'soul-saver':
      return 'Soul Saver';
    case 'cause-damage':
      return 'Cause Damage';
    case 'reap-before-collateral':
      return 'Reap Before Collateral';
    case 'speed-reap':
      return 'Speed Reap';
    case 'chain-reap':
      return 'Chain Reap';
    case 'boss-fight':
      return 'The Postman Comes';
    default:
      return type;
  }
}
