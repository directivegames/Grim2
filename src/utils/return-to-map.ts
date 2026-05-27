import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { MapMusicActor } from '../actors/MapMusicActor.js';
import { NewZombieActor } from '../actors/NewZombieActor.js';
import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';
import { killStreakTracker, slomoManager } from '../actors/KillStreakTracker.js';
import { comboMeterTracker } from '../actors/ComboMeterTracker.js';
import type { MissionConfig } from '../data/mission-types.js';
import type { MissionDef } from '../data/missions.js';
import { missionRunner } from '../mission/MissionRunner.js';
import { MapUI } from '../ui/MapUI.js';
import { MissionResultUI } from '../ui/MissionResultUI.js';
import { MissionRewardsUI } from '../ui/MissionRewardsUI.js';
import { UpgradeShopUI } from '../ui/UpgradeShopUI.js';
import { TutSoulUI } from '../ui/TutSoulUI.js';
import { beginMissionFromMap } from './begin-mission-from-map.js';
import { resumeGame, setGameplayUnlocked } from './game-pause.js';
import { PauseMenuUI } from '../ui/PauseMenuUI.js';
import { removeAllBlockingOverlays } from './screen-transition.js';

/** Shared cleanup after a mission ends (win or fail). */
export function cleanupAfterMission(world: ENGINE.World): void {
  PauseMenuUI.close(world);
  resumeGame(world);
  setGameplayUnlocked(false);

  slomoManager.forceReset(world);
  killStreakTracker.reset();
  comboMeterTracker.reset();
  MissionResultUI.close();
  MissionRewardsUI.close();
  UpgradeShopUI.close(world);
  TutSoulUI.close();
  removeAllBlockingOverlays(world);
  missionRunner.stop(world);

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
}

/** Return to the Burdenville map to pick another mission. */
export function returnToMap(world: ENGINE.World): void {
  cleanupAfterMission(world);

  MapUI.open(world, (mission: MissionDef, config: MissionConfig) => {
    beginMissionFromMap(world, mission, config);
  });
  MapMusicActor.ensurePlaying(world);
}
