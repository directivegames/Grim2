/**
 * Award one soul to the player (enemy death) — HUD counter, mission progress, optional heal.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { missionTracksSoulReap } from '../data/mission-types.js';
import { grimVault } from '../game/GrimVault.js';
import { missionState } from '../mission/MissionState.js';
import { SoulCounterUI } from '../ui/SoulCounterUI.js';

/** Credit a soul as soon as the enemy dies (not after ragdoll settles). */
export function awardSoulFromEnemyKill(world: ENGINE.World): void {
  const player = world.getFirstPlayerPawn();
  if (player instanceof IsometricPlayerPawn) {
    applySoulHealOnPickup(player);
    player.onEnemyKillForGrimGrinder();
  }

  if (missionState.isActive && missionState.config) {
    missionState.onEnemyReaped();
  }

  const config = missionState.config;
  if (missionState.isActive && config && missionTracksSoulReap(config)) {
    if (player instanceof IsometricPlayerPawn) {
      player.soulsCollected++;
    }
    void SoulCounterUI.getInstance(world).then((ui) => ui.increment());
  }
}

/** Heal Grim when a soul is awarded (base 0.2 HP/kill; Soul Leech adds slowly). */
export function applySoulHealOnPickup(player: IsometricPlayerPawn): void {
  const perKill = grimVault.computeStats().soulHeal;
  if (perKill <= 0) {
    return;
  }

  player.addSoulHealCredit(perKill);
}
