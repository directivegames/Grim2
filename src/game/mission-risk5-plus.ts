import type { MissionConfig } from '../data/mission-types.js';
import {
  isChainReapMission,
  isCauseDamageMission,
  isReapAndSaveMission,
  isReapBeforeCollateralMission,
  isReapMission,
  isSoulSaverMission,
  isSpeedReapMission,
  isSurviveMission,
} from '../data/mission-types.js';

import { computeRisk5PlusScaling, getRisk5PlusRunTier } from './risk5-plus.js';

function withRisk5PlusTier<T extends MissionConfig>(config: T, tier: number): T {
  return { ...config, risk5PlusTier: tier };
}

const MIN_INNOCENT_SAVE_SEC = 20;
const MIN_SPEED_REAP_SEC = 180;
const MIN_CHAIN_REAP_SEC = 180;
const MAX_SURVIVE_SEC = 600;

/** Apply endless 5+ scaling to a rolled mission (goals + timer). */
export function applyRisk5PlusToMission(
  config: MissionConfig,
  completions: number,
): MissionConfig {
  const tier = getRisk5PlusRunTier(completions);
  const scale = computeRisk5PlusScaling(completions);

  if (isSurviveMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        // Don't let survive become a 40-minute grind; pressure scales via enemies instead.
        durationSec: Math.min(
          MAX_SURVIVE_SEC,
          Math.max(60, Math.round(config.durationSec * scale.timeLimitMult)),
        ),
      },
      tier,
    );
  }

  if (isChainReapMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        killsRequired: Math.max(10, Math.round(config.killsRequired * scale.goalMult)),
        // Prevent impossible combos like huge goals inside tiny windows.
        timeLimitSec: Math.max(
          MIN_CHAIN_REAP_SEC,
          Math.round(config.timeLimitSec * scale.timeLimitMult),
        ),
      },
      tier,
    );
  }

  if (isSpeedReapMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        soulsRequired: Math.max(100, Math.round(config.soulsRequired * scale.goalMult)),
        timeLimitSec: Math.max(
          MIN_SPEED_REAP_SEC,
          Math.round(config.timeLimitSec * scale.timeLimitMult),
        ),
      },
      tier,
    );
  }

  if (isReapMission(config) || isReapBeforeCollateralMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        soulsRequired: Math.max(100, Math.round(config.soulsRequired * scale.goalMult)),
      },
      tier,
    );
  }

  if (isReapAndSaveMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        soulsRequired: Math.max(100, Math.round(config.soulsRequired * scale.goalMult)),
        innocentsToSave: Math.max(3, Math.round(config.innocentsToSave * scale.goalMult)),
        innocentSaveTimeLimitSec: Math.max(
          MIN_INNOCENT_SAVE_SEC,
          config.innocentSaveTimeLimitSec,
        ),
      },
      tier,
    );
  }

  if (isSoulSaverMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        soulsToSave: Math.max(5, Math.round(config.soulsToSave * scale.goalMult)),
        innocentSaveTimeLimitSec: Math.max(
          MIN_INNOCENT_SAVE_SEC,
          config.innocentSaveTimeLimitSec,
        ),
      },
      tier,
    );
  }

  if (isCauseDamageMission(config)) {
    return withRisk5PlusTier(
      {
        ...config,
        damageRequired: Math.max(5000, Math.round(config.damageRequired * scale.goalMult)),
      },
      tier,
    );
  }

  return withRisk5PlusTier(config, tier);
}
