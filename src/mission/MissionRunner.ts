import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';



import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';

import { CollateralDamageUI } from '../ui/CollateralDamageUI.js';
import { CollateralWarningUI } from '../ui/CollateralWarningUI.js';
import { InnocentFeedbackUI } from '../ui/InnocentFeedbackUI.js';
import { InnocentIndicatorUI } from '../ui/InnocentIndicatorUI.js';
import { InnocentSaveProgressUI } from '../ui/InnocentSaveProgressUI.js';
import { MissionResultUI } from '../ui/MissionResultUI.js';

import type { MissionDef } from '../data/missions.js';

import { getMissionGameplayConfig } from '../data/missions.js';

import type { MissionConfig } from '../data/mission-types.js';

import { getRiskLevelConfig } from '../data/risk-levels.js';

import type { InnocentSpawnPointActor } from '../actors/InnocentSpawnPointActor.js';
import { InnocentHandler } from './InnocentHandler.js';
import {
  applySpawnPointWorldPosition,
  pickInnocentSpawnPosition,
} from './innocent-spawn-position.js';
import {
  getInnocentSpawnPointCount,
  pickInnocentSpawnPoint,
} from './innocent-spawn-points.js';
import { missionState } from './MissionState.js';
import {
  clearPlayerSpawnAnchor,
  setPlayerSpawnAnchor,
} from './spawn-exclusion.js';
import { isPaused } from '../utils/game-pause.js';



/**

 * Starts and ticks the active mission after the map confirms START.

 */

class MissionRunnerImpl {

  private _running = false;

  private _world: ENGINE.World | null = null;

  private readonly _innocentHandler = new InnocentHandler();

  private readonly _playerPos = new THREE.Vector3();
  private readonly _innocentSpawnPos = new THREE.Vector3();
  private readonly _innocentWorldPos = new THREE.Vector3();
  private readonly _usedInnocentMarkers = new Set<InnocentSpawnPointActor>();



  public get isRunning(): boolean {

    return this._running;

  }



  public get innocentHandler(): InnocentHandler {

    return this._innocentHandler;

  }



  public start(world: ENGINE.World, mission: MissionDef): void {

    const config = getMissionGameplayConfig(mission);

    if (!config) {

      console.warn(`[MissionRunner] No missionConfig on mission "${mission.id}" — skipping.`);

      return;

    }



    this.stop(world);



    this._world = world;

    this._running = true;



    const pawn = world.getFirstPlayerPawn();
    if (pawn) {
      pawn.rootComponent.getWorldPosition(this._playerPos);
      setPlayerSpawnAnchor(this._playerPos);
    }

    this._usedInnocentMarkers.clear();
    this._innocentHandler.bind(world);

    this._applyHordeRisk(world, config);



    void this._startMissionWithUi(world, config);

  }



  private async _startMissionWithUi(

    world: ENGINE.World,

    config: MissionConfig,

  ): Promise<void> {

    const [collateralUi, innocentProgressUi, feedbackUi, warningUi] = await Promise.all([
      CollateralDamageUI.getInstance(world),
      InnocentSaveProgressUI.getInstance(world),
      InnocentFeedbackUI.getInstance(world),
      CollateralWarningUI.getInstance(world),
    ]);
    const indicatorUi = InnocentIndicatorUI.getInstance(world);

    collateralUi.setPercent(0);
    collateralUi.show();
    innocentProgressUi.show();
    innocentProgressUi.setProgress(0, config.type === 'reap-and-save' ? config.innocentsToSave : 0);
    indicatorUi.hide();

    missionState.setListeners({
      onRequestInnocentSpawn: () => this._revealInnocent(),
      onInnocentTimerExpired: () => {
        this._innocentHandler.expireFromTimer();
      },
      onInnocentSaveTimerChanged: (remaining, limit) => {
        innocentProgressUi.setSaveTimer(remaining, limit);
      },
      onInnocentSaved: () => {
        indicatorUi.hide();
        feedbackUi.showSoulSaved();
      },
      onInnocentKilled: (jumpPercent) => {
        indicatorUi.hide();
        feedbackUi.showSoulWasted(() => warningUi.showCollateralJump(jumpPercent));
      },
      onCollateralChanged: (percent) => collateralUi.setPercent(percent),
      onInnocentProgress: (saved, required) => innocentProgressUi.setProgress(saved, required),

      onMissionEnded: (result) => {
        collateralUi.hide();
        innocentProgressUi.hide();
        indicatorUi.hide();
        this._innocentHandler.shutdown();
        void MissionResultUI.show(world, result);
      },

    });

    missionState.start(config, world);

  }



  public tick(world: ENGINE.World, deltaTime: number): void {

    if (!this._running || world !== this._world) return;

    if (isPaused()) return;

    missionState.tick(deltaTime);

    this._innocentHandler.tick();



    const indicatorUi = InnocentIndicatorUI.getInstance(world);

    if (this._innocentHandler.getWorldPosition(this._innocentWorldPos)) {

      indicatorUi.show();

      indicatorUi.updateTarget(this._innocentWorldPos);

    } else {

      indicatorUi.hide();

    }

  }



  public stop(world?: ENGINE.World | null): void {

    const w = world ?? this._world;



    this._innocentHandler.shutdown();



    if (w) {

      this._clearHordeRisk(w);

      CollateralDamageUI.hideForWorld(w);
      InnocentSaveProgressUI.hideForWorld(w);
      InnocentIndicatorUI.hideForWorld(w);

    }



    missionState.reset();
    this._usedInnocentMarkers.clear();
    clearPlayerSpawnAnchor();

    this._running = false;

    this._world = null;

  }



  private _applyHordeRisk(world: ENGINE.World, config: MissionConfig): void {

    const risk = getRiskLevelConfig(config.riskLevel);

    for (const actor of world.getActors()) {

      if (actor instanceof ZombieHordeManager) {

        actor.applyMissionRisk(risk.enemyHealthMult, risk.enemyDamageMult, risk.eliteSpawnWeight);

        return;

      }

    }

  }



  private _clearHordeRisk(world: ENGINE.World): void {

    for (const actor of world.getActors()) {

      if (actor instanceof ZombieHordeManager) {

        actor.clearMissionRisk();

        return;

      }

    }

  }



  private _revealInnocent(): void {

    const world = this._world;

    if (!world || !missionState.isActive) return;



    if (!this._innocentHandler.hasProp) {

      missionState.onInnocentSpawnFailed();

      return;

    }



    const pos = this._pickSpawnPosition(world);

    if (!pos) {

      console.warn('[MissionRunner] Could not find innocent spawn position (place InnocentSpawnPointActor markers).');

      missionState.onInnocentSpawnFailed();

      return;

    }



    this._innocentHandler.revealAt(world, pos, () => {

      missionState.onInnocentSpawned();

    });

  }



  private _pickSpawnPosition(world: ENGINE.World): THREE.Vector3 | null {
    const player = world.getFirstPlayerPawn();
    if (!player) return null;

    player.rootComponent.getWorldPosition(this._playerPos);

    if (getInnocentSpawnPointCount() > 0) {
      const marker = pickInnocentSpawnPoint(this._usedInnocentMarkers, this._innocentSpawnPos);
      if (marker) {
        this._usedInnocentMarkers.add(marker);
        applySpawnPointWorldPosition(
          world.getNavigationServer(),
          this._innocentSpawnPos,
          this._innocentSpawnPos,
        );
        return this._innocentSpawnPos.clone();
      }
    }

    if (pickInnocentSpawnPosition(world, this._playerPos, this._innocentSpawnPos)) {
      return this._innocentSpawnPos.clone();
    }

    return null;
  }

}



export const missionRunner = new MissionRunnerImpl();

