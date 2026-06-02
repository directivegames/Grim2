import * as ENGINE from '@gnsx/genesys.js';

import { BackgroundMusicActor } from '../actors/BackgroundMusicActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { PostmanBossMusicActor } from '../actors/PostmanBossMusicActor.js';
import { isBossFightMission, type MissionConfig } from '../data/mission-types.js';
import type { MissionDef } from '../data/missions.js';
import { missionRunner } from '../mission/MissionRunner.js';
import { ReadyToReapUI } from '../ui/ReadyToReapUI.js';
import { TutSoulUI } from '../ui/TutSoulUI.js';
import { getGameAudioManager } from './game-audio.js';
import { clearMissionPause, resumeGame, setGameplayUnlocked } from './game-pause.js';
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
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.setHiddenInGame(false);
  }

  clearMissionPause(world);
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

    if (pawn instanceof IsometricPlayerPawn) {
      // Full reset (health, visibility, spawn, physics sync) right before gameplay unlock.
      pawn.prepareForMissionStart('finish-intro');
    }

    setGameplayUnlocked(true);

    const bg = world.getActors().find(a => a instanceof BackgroundMusicActor);
    if (bg instanceof BackgroundMusicActor) {
      bg.stop();
    }

    if (isBossFightMission(config)) {
      missionRunner.revealBossFight(world);
      PostmanBossMusicActor.ensurePlaying(world);
    } else {
      BackgroundMusicActor.ensurePlaying(world);
    }

    resumeGame(world);
    const w = world as unknown as { slomo?: number };
    if (typeof w.slomo === 'number' && w.slomo <= 0) {
      w.slomo = 1;
    }
    try {
      world.inputManager.setInputEnabled(true);
    } catch {
      /* */
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
