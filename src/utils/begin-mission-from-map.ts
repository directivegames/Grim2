import * as ENGINE from '@gnsx/genesys.js';

import { BackgroundMusicActor } from '../actors/BackgroundMusicActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import type { MissionConfig } from '../data/mission-types.js';
import type { MissionDef } from '../data/missions.js';
import { missionRunner } from '../mission/MissionRunner.js';
import { ReadyToReapUI } from '../ui/ReadyToReapUI.js';
import { TutSoulUI } from '../ui/TutSoulUI.js';
import { getGameAudioManager } from './game-audio.js';
import { resumeGame, setGameplayUnlocked } from './game-pause.js';
import { removeAllBlockingOverlays } from './screen-transition.js';
import { shouldShowTutSoul } from './tut-progress.js';

/**
 * Map START → live mission: optional Tut Soul → Ready To Reap → gameplay.
 */
export function beginMissionFromMap(
  world: ENGINE.World,
  mission: MissionDef,
  config: MissionConfig,
): void {
  const pawn = world.getFirstPlayerPawn();
  if (pawn) {
    pawn.setHiddenInGame(false);
  }

  setGameplayUnlocked(false);
  try {
    world.inputManager.setInputEnabled(false);
  } catch {
    /* */
  }

  getGameAudioManager(world).play('letsReap', 1.0, true);
  missionRunner.start(world, mission, config);

  const finishMissionIntro = (): void => {
    removeAllBlockingOverlays(world);
    setGameplayUnlocked(true);
    BackgroundMusicActor.ensurePlaying(world);
    resumeGame(world);
    if (pawn instanceof IsometricPlayerPawn) {
      pawn.applyGrimVaultStats();
    }
  };

  const playReadyToReap = (): void => {
    void ReadyToReapUI.play(world, finishMissionIntro, { startGameplayMusic: false });
  };

  if (shouldShowTutSoul()) {
    void TutSoulUI.show(world, playReadyToReap, { resumeOnClose: false });
  } else {
    playReadyToReap();
  }
}
