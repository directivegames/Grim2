import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { NewZombieActor } from '../actors/NewZombieActor.js';
import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';
import { killStreakTracker, slomoManager } from '../actors/KillStreakTracker.js';
import { comboMeterTracker } from '../actors/ComboMeterTracker.js';
import { resumeGame, setGameplayUnlocked } from './game-pause.js';
import { PauseMenuUI } from '../ui/PauseMenuUI.js';
import { StartMenuUI } from '../ui/StartMenuUI.js';

/** Reset gameplay state and return to the start menu. */
export function returnToMainMenu(world: ENGINE.World): void {
  PauseMenuUI.close(world);
  resumeGame(world);
  setGameplayUnlocked(false);

  slomoManager.forceReset(world);
  killStreakTracker.reset();
  comboMeterTracker.reset();

  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.endKillStreakOrbit();
    pawn.endSlomoEffect();
  }

  for (const actor of world.getActors()) {
    if (actor instanceof ZombieHordeManager) {
      actor.resetForMainMenu();
    }
  }

  for (const actor of world.getActors()) {
    if (actor instanceof NewZombieActor) {
      actor.parkForHordeReset();
    }
  }

  StartMenuUI.reopenAfterQuit(world);
}
