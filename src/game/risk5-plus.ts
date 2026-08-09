/** Minimum combo at kill time for Chain Reap counted kills (10x milestone = first counted kill). */
export const CHAIN_REAP_MIN_COMBO = 10;

/** True when a kill at this combo level counts toward chain-reap goal. */
export function chainReapKillCounts(comboAtKill: number): boolean {
  return comboAtKill >= CHAIN_REAP_MIN_COMBO;
}

/**
 * Scale mission difficulty for Risk 5+ endless runs.
 * `tier` = completions already finished; the run you're about to play uses tier + 1 feel.
 */
export function getRisk5PlusRunTier(completions: number): number {
  return Math.max(1, completions + 1);
}

export interface Risk5PlusScaling {
  healthMult: number;
  damageMult: number;
  waveIntervalMult: number;
  goalMult: number;
  timeLimitMult: number;
}

export function computeRisk5PlusScaling(completions: number): Risk5PlusScaling {
  const tier = getRisk5PlusRunTier(completions);
  const t = Math.min(tier, 50);
  return {
    healthMult: 1 + Math.min(t * 0.04, 1.5),
    damageMult: 1 + Math.min(t * 0.03, 1),
    waveIntervalMult: Math.max(0.65, 1 - t * 0.01),
    goalMult: 1 + Math.min(t * 0.06, 2),
    timeLimitMult: Math.max(0.7, 1 - t * 0.008),
  };
}
