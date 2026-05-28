/**
 * Player combat damage / mitigation from Grim vault upgrades.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { DamageHitInfo } from '@gnsx/genesys.js';
import { grimVault } from '../game/GrimVault.js';

/** Base melee / soul-throw blade damage before Strike multiplier. */
export const PLAYER_BASE_WEAPON_DAMAGE = 25;

export function getPlayerAttackMult(): number {
  return grimVault.computeStats().attackMult;
}

export function getPlayerWeaponDamage(): number {
  return Math.max(1, Math.round(PLAYER_BASE_WEAPON_DAMAGE * getPlayerAttackMult()));
}

/** Fractional damage reduction from Grim Guard (0–1, capped). */
export function getPlayerDefence(): number {
  // computeStats() already applies diminishing returns + caps; keep a final hard cap for safety.
  return Math.min(0.75, grimVault.computeStats().defence);
}

export function applyDefenceToIncomingDamage(rawDamage: number): number {
  if (rawDamage <= 0 || !Number.isFinite(rawDamage)) {
    return 0;
  }
  const mitigated = rawDamage * (1 - getPlayerDefence());
  return Math.max(1, Math.round(mitigated));
}

const HOOKED = Symbol('grimDefenceHooked');

/** Apply Grim Guard to all damage taken via CharacterStatsComponent. */
export function hookPlayerDamageMitigation(stats: ENGINE.CharacterStatsComponent): void {
  const tagged = stats as unknown as Record<symbol, boolean>;
  if (tagged[HOOKED]) {
    return;
  }

  const original = stats.takeDamage.bind(stats);
  stats.takeDamage = (amount: number, hitInfo?: DamageHitInfo): number => {
    return original(applyDefenceToIncomingDamage(amount), hitInfo);
  };
  tagged[HOOKED] = true;
}
