import * as ENGINE from '@gnsx/genesys.js';

import { BackgroundMusicActor } from '../actors/BackgroundMusicActor.js';
import { GrimGrinderModeActor } from '../actors/GrimGrinderModeActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { MapMusicActor } from '../actors/MapMusicActor.js';
import { PostmanBossMusicActor } from '../actors/PostmanBossMusicActor.js';
import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';
import { killStreakTracker, slomoManager } from '../actors/KillStreakTracker.js';
import { comboMeterTracker } from '../actors/ComboMeterTracker.js';
import type { MissionConfig } from '../data/mission-types.js';
import type { MissionDef } from '../data/missions.js';
import { missionRunner } from '../mission/MissionRunner.js';
import { MapUI } from '../ui/MapUI.js';
import { ItemCollectedToastUI } from '../ui/ItemCollectedToastUI.js';
import { MissionResultUI } from '../ui/MissionResultUI.js';
import { MissionRewardsUI } from '../ui/MissionRewardsUI.js';
import { UpgradeShopUI } from '../ui/UpgradeShopUI.js';
import { TutSoulUI } from '../ui/TutSoulUI.js';
import { beginMissionFromMap } from './begin-mission-from-map.js';
import { flushGameplayInput } from './flush-gameplay-input.js';
import { clearMissionPause, setGameplayUnlocked } from './game-pause.js';
import { PauseMenuUI } from '../ui/PauseMenuUI.js';
import {
  ensureGrimIntroBlackCover,
  hideGameplayPresentation,
} from './presentation-mode.js';
import { resetMissionWorld } from './reset-mission-world.js';

/** Shared cleanup after a mission ends (win or fail). */
export function cleanupAfterMission(world: ENGINE.World): void {
  GrimGrinderModeActor.forceStop(world);

  PauseMenuUI.close(world);

  // Lift the fail-screen freeze (pauseGame sets slomo=0) FIRST. The character body is
  // KinematicVelocityBased and the move component runs with sendPosition=false, so the
  // ONLY way to relocate Grim is the engine teleport — which moves the body via a one-step
  // velocity and therefore needs physics to actually step. Unpausing here guarantees the
  // teleport queued below in resetMissionWorld commits while the map fades in.
  clearMissionPause(world);
  setGameplayUnlocked(false);
  flushGameplayInput(world);

  slomoManager.forceReset(world);
  killStreakTracker.reset();
  comboMeterTracker.reset();
  MissionResultUI.close();
  MissionRewardsUI.close();
  ItemCollectedToastUI.hideForWorld(world);
  UpgradeShopUI.close(world);
  TutSoulUI.close();

  // Stop mission logic before touching the live world so horde / mission tick cannot run.
  missionRunner.stop(world);

  for (const actor of world.getRootNodes()) {
    if (actor instanceof BackgroundMusicActor) {
      actor.stop();
    }
  }
  PostmanBossMusicActor.stopAll(world);

  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.endKillStreakOrbit();
    pawn.endSlomoEffect();
  }

  // Move Grim back to PlayerStart and restore his health NOW, while physics is live, then
  // reset the placed enemies. This is the proven path: relocate + heal + reset the level.
  resetMissionWorld(
    world,
    { restorePlacedEnemies: true, resetPlayer: true },
    'after-mission-cleanup',
  );

  for (const actor of world.getRootNodes()) {
    if (actor instanceof ZombieHordeManager) {
      actor.resetForMainMenu();
      break;
    }
  }

  hideGameplayPresentation(world);
}

/** Return to the Burdenville map to pick another mission. */
export function returnToMap(world: ENGINE.World): void {
  cleanupAfterMission(world);
  ensureGrimIntroBlackCover(world);

  MapUI.open(world, (mission: MissionDef, config: MissionConfig) => {
    beginMissionFromMap(world, mission, config);
  });
  MapMusicActor.ensurePlaying(world);
}
