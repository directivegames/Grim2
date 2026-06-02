/**
 * Keeps the 3D gameplay view hidden during title / map / mission-intro UI.
 * Does not change mission rules — only pawn visibility and HUD presentation.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ensureGrimIntroBlackCover } from '../actors/GrimIntroActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { HealthBarUI } from '../ui/HealthBarUI.js';
import { fadeOutIntroBlackCover } from './screen-transition.js';

export { ensureGrimIntroBlackCover };

/** Hide Grim and pre-mission HUD while menus, map, or intro overlays are up. */
export function hideGameplayPresentation(world: ENGINE.World): void {
  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.setHiddenInGame(true);
  }
  void HealthBarUI.getInstance(world).then((ui) => ui.hide());
}

/**
 * Fade out menu/map black cover, show Grim at spawn for Ready To Reap.
 * Health bar stays hidden until gameplay unlock.
 */
export async function prepareReadyToReapPresentation(world: ENGINE.World): Promise<void> {
  await fadeOutIntroBlackCover(world, 380);

  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.prepareForMissionStart('before-rtr');
  }
  void HealthBarUI.getInstance(world).then((ui) => ui.hide());
}

/** Show Grim and health bar when live mission control begins. */
export function showGameplayPresentation(world: ENGINE.World): void {
  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.setHiddenInGame(false);
  }
  void HealthBarUI.getInstance(world).then((ui) => ui.show());
}
