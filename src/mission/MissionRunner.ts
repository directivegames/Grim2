import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { PostmanBossActor } from '../actors/PostmanBossActor.js';
import { PostmanBossMusicActor } from '../actors/PostmanBossMusicActor.js';
import { BackgroundMusicActor } from '../actors/BackgroundMusicActor.js';
import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';
import { CollateralDamageUI } from '../ui/CollateralDamageUI.js';
import { CollateralWarningUI } from '../ui/CollateralWarningUI.js';
import { BossHealthBarUI } from '../ui/BossHealthBarUI.js';
import { DamageProgressUI } from '../ui/DamageProgressUI.js';
import { InnocentFeedbackUI } from '../ui/InnocentFeedbackUI.js';
import { InnocentHelpMeUI } from '../ui/InnocentHelpMeUI.js';
import { InnocentIndicatorUI } from '../ui/InnocentIndicatorUI.js';
import { InnocentSaveProgressUI } from '../ui/InnocentSaveProgressUI.js';
import { MissionResultUI } from '../ui/MissionResultUI.js';
import { SoulProgressUI } from '../ui/SoulProgressUI.js';
import { SurviveTimerUI } from '../ui/SurviveTimerUI.js';
import type { MissionDef } from '../data/missions.js';
import { getMissionGameplayConfig } from '../data/missions.js';
import type { BossFightMissionConfig, MissionConfig } from '../data/mission-types.js';
import {
  isBossFightMission,
  isChainReapMission,
  isReapAndSaveMission,
  isSoulSaverMission,
  missionTracksChainKills,
  missionUsesAggressiveSpawn,
  missionUsesCollateral,
  missionUsesInnocents,
  missionTracksSoulReap,
} from '../data/mission-types.js';
import { ENEMY_DAMAGE_GLOBAL_MULT } from '../data/combat-balance.js';
import { getRiskLevelConfig, type RiskLevel } from '../data/risk-levels.js';
import { computeRisk5PlusScaling } from '../game/risk5-plus.js';
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
import { ItemCollectedToastUI } from '../ui/ItemCollectedToastUI.js';
import { SoulCounterUI } from '../ui/SoulCounterUI.js';
import { missionState } from './MissionState.js';
import {
  clearPlayerSpawnAnchor,
  setPlayerSpawnAnchor,
} from './spawn-exclusion.js';
import { isPaused } from '../utils/game-pause.js';
import { resetMissionWorld } from '../utils/reset-mission-world.js';

class MissionRunnerImpl {
  private _running = false;
  private _runId = 0;
  private _world: ENGINE.World | null = null;
  private readonly _innocentHandler = new InnocentHandler();
  private readonly _playerPos = new THREE.Vector3();
  private readonly _innocentSpawnPos = new THREE.Vector3();
  private readonly _innocentWorldPos = new THREE.Vector3();
  private readonly _usedInnocentMarkers = new Set<InnocentSpawnPointActor>();
  private _activeBoss: PostmanBossActor | null = null;

  public get isRunning(): boolean {
    return this._running;
  }

  public get innocentHandler(): InnocentHandler {
    return this._innocentHandler;
  }

  public start(world: ENGINE.World, mission: MissionDef, config?: MissionConfig): void {
    const resolved = config ?? getMissionGameplayConfig(mission);
    if (!resolved) {
      console.warn(`[MissionRunner] No mission config for "${mission.id}" — skipping.`);
      return;
    }

    this.stop(world);
    resetMissionWorld(world, { restorePlacedEnemies: true }, 'mission-start');

    this._world = world;
    this._running = true;

    const playerStart = world.getActors(ENGINE.PlayerStart)[0];
    if (playerStart) {
      playerStart.rootComponent.getWorldPosition(this._playerPos);
      setPlayerSpawnAnchor(this._playerPos);
    } else {
      const pawn = world.getFirstPlayerPawn();
      if (pawn) {
        pawn.rootComponent.getWorldPosition(this._playerPos);
        setPlayerSpawnAnchor(this._playerPos);
      }
    }

    const pawn = world.getFirstPlayerPawn();
    if (pawn instanceof IsometricPlayerPawn) {
      pawn.soulsCollected = 0;
    }

    this._usedInnocentMarkers.clear();
    this._innocentHandler.bind(world);
    this._applyHordeRisk(world, resolved);
    const runId = ++this._runId;
    void this._startMissionWithUi(world, resolved, runId);
  }

  private async _startMissionWithUi(
    world: ENGINE.World,
    config: MissionConfig,
    runId: number,
  ): Promise<void> {
    const [
      collateralUi,
      innocentProgressUi,
      soulProgressUi,
      surviveTimerUi,
      damageProgressUi,
      feedbackUi,
      warningUi,
    ] = await Promise.all([
      CollateralDamageUI.getInstance(world),
      InnocentSaveProgressUI.getInstance(world),
      SoulProgressUI.getInstance(world),
      SurviveTimerUI.getInstance(world),
      DamageProgressUI.getInstance(world),
      InnocentFeedbackUI.getInstance(world),
      CollateralWarningUI.getInstance(world),
    ]);
    if (runId !== this._runId) {
      return;
    }

    const indicatorUi = InnocentIndicatorUI.getInstance(world);
    const helpMeUi = InnocentHelpMeUI.getInstance(world);

    const showCollateral = missionUsesCollateral(config);
    const showInnocents = missionUsesInnocents(config);
    // Top-right HUD guard rail: only one progress widget may occupy the slot.
    // Reap-and-save uses InnocentSaveProgressUI for the main objective, so hide SoulProgressUI.
    const showDamage = config.type === 'cause-damage';
    const showSoulProgress =
      !showInnocents &&
      !showDamage &&
      (missionTracksSoulReap(config) || missionTracksChainKills(config));
    const showSurviveTimer =
      config.type === 'survive' || config.type === 'speed-reap' || config.type === 'chain-reap';
    const showBossFight = isBossFightMission(config);

    const bossHealthUi = showBossFight ? await BossHealthBarUI.getInstance(world) : null;

    if (showCollateral) {
      collateralUi.setPercent(0);
      collateralUi.show();
    } else {
      collateralUi.hide();
    }

    if (showInnocents) {
      innocentProgressUi.show();
      const required = isReapAndSaveMission(config)
        ? config.innocentsToSave
        : isSoulSaverMission(config)
          ? config.soulsToSave
          : 0;
      innocentProgressUi.setProgress(0, required);
    } else {
      innocentProgressUi.hide();
    }

    if (showSoulProgress) {
      soulProgressUi.show();
      if (isChainReapMission(config)) {
        soulProgressUi.setProgress(0, config.killsRequired, 'CHAIN KILLS');
      } else if ('soulsRequired' in config) {
        soulProgressUi.setProgress(0, config.soulsRequired);
      }
    } else {
      soulProgressUi.hide();
    }

    if (showSurviveTimer) {
      surviveTimerUi.show();
      if (config.type === 'survive') {
        surviveTimerUi.setTimer(config.durationSec, config.durationSec, 'SURVIVE');
      } else if (config.type === 'chain-reap') {
        surviveTimerUi.setTimer(config.timeLimitSec, config.timeLimitSec, 'AWAIT FIRST KILL');
      } else {
        surviveTimerUi.setTimer(config.timeLimitSec, config.timeLimitSec, 'TIME LEFT');
      }
    } else {
      surviveTimerUi.hide();
    }

    if (showDamage) {
      damageProgressUi.show();
      damageProgressUi.setProgress(0, config.damageRequired);
    } else {
      damageProgressUi.hide();
    }

    indicatorUi.hide();
    helpMeUi.hide();

    if (showBossFight && bossHealthUi) {
      bossHealthUi.show();
      bossHealthUi.setHealth(1, 1);
    } else {
      BossHealthBarUI.hideForWorld(world);
    }

    if (runId !== this._runId) {
      return;
    }

    missionState.setListeners({
      onRequestInnocentSpawn: () => this._revealInnocent(),
      onInnocentTimerExpired: () => {
        this._innocentHandler.expireFromTimer();
      },
      onInnocentSaveTimerChanged: (remaining, limit) => {
        if (showInnocents) {
          innocentProgressUi.setSaveTimer(remaining, limit);
        }
      },
      onInnocentSaved: () => {
        indicatorUi.hide();
        helpMeUi.hide();
        feedbackUi.showSoulSaved();
      },
      onInnocentKilled: (jumpPercent) => {
        indicatorUi.hide();
        helpMeUi.hide();
        if (jumpPercent > 0) {
          feedbackUi.showSoulWasted(() => warningUi.showCollateralJump(jumpPercent));
        } else {
          feedbackUi.showSoulWasted();
        }
      },
      onCollateralChanged: (percent) => {
        if (showCollateral) {
          collateralUi.setPercent(percent);
        }
      },
      onInnocentProgress: (saved, required) => {
        if (showInnocents) {
          innocentProgressUi.setProgress(saved, required);
        }
      },
      onSoulProgress: (collected, required) => {
        if (showSoulProgress) {
          soulProgressUi.setProgress(collected, required);
        }
      },
      onSurviveTimerChanged: (remaining, total, label) => {
        if (showSurviveTimer) {
          surviveTimerUi.setTimer(remaining, total, label);
        }
      },
      onDamageProgress: (dealt, required) => {
        if (showDamage) {
          damageProgressUi.setProgress(dealt, required);
        }
      },
      onBossHealthChanged: (current, max) => {
        bossHealthUi?.setHealth(current, max);
      },
      onMissionEnded: (result) => {
        collateralUi.hide();
        innocentProgressUi.hide();
        soulProgressUi.hide();
        surviveTimerUi.hide();
        damageProgressUi.hide();
        BossHealthBarUI.hideForWorld(world);
        indicatorUi.hide();
        helpMeUi.hide();
        ItemCollectedToastUI.hideForWorld(world);
        this._teardownBossFight();
        this._innocentHandler.shutdown();
        void MissionResultUI.show(world, result);
      },
    });

    if (runId !== this._runId) {
      return;
    }

    missionState.start(config, world);

    if (showBossFight) {
      this._startBossFight(world, config);
    }

    void SoulCounterUI.getInstance(world).then((ui) => ui.setCount(0));
  }

  public tick(world: ENGINE.World, deltaTime: number): void {
    if (!this._running || world !== this._world) return;
    if (isPaused()) return;

    missionState.tick(deltaTime);
    this._innocentHandler.tick();

    const indicatorUi = InnocentIndicatorUI.getInstance(world);
    const helpMeUi = InnocentHelpMeUI.getInstance(world);

    if (this._innocentHandler.getWorldPosition(this._innocentWorldPos)) {
      indicatorUi.show();
      indicatorUi.updateTarget(this._innocentWorldPos);
      helpMeUi.show();
      helpMeUi.updateTarget(this._innocentWorldPos);
    } else {
      indicatorUi.hide();
      helpMeUi.hide();
    }
  }

  public stop(world?: ENGINE.World | null): void {
    this._runId++;
    const w = world ?? this._world;

    this._innocentHandler.shutdown();

    if (w) {
      this._teardownBossFight();
      this._clearHordeRisk(w);
      BossHealthBarUI.hideForWorld(w);
      CollateralDamageUI.hideForWorld(w);
      InnocentSaveProgressUI.hideForWorld(w);
      SoulProgressUI.hideForWorld(w);
      SurviveTimerUI.hideForWorld(w);
      DamageProgressUI.hideForWorld(w);
      InnocentIndicatorUI.hideForWorld(w);
      InnocentHelpMeUI.hideForWorld(w);
    }

    missionState.reset();
    this._usedInnocentMarkers.clear();
    clearPlayerSpawnAnchor();

    this._running = false;
    this._world = null;
  }

  private _applyHordeRisk(world: ENGINE.World, config: MissionConfig): void {
    const risk = getRiskLevelConfig(config.riskLevel);
    let healthMult = risk.enemyHealthMult;
    let damageMult = risk.enemyDamageMult * ENEMY_DAMAGE_GLOBAL_MULT;
    let waveIntervalMult = 1;

    const plusTier = config.risk5PlusTier ?? 0;
    if (plusTier > 0) {
      const scale = computeRisk5PlusScaling(plusTier - 1);
      healthMult *= scale.healthMult;
      damageMult *= scale.damageMult;
      waveIntervalMult = scale.waveIntervalMult;
    }

    const spawnCap = isBossFightMission(config)
      ? 0
      : config.riskLevel >= 5
        ? Math.min(risk.spawnCap, 100)
        : risk.spawnCap;

    for (const actor of world.getActors()) {
      if (actor instanceof ZombieHordeManager) {
        actor.applyMissionRisk(
          healthMult,
          damageMult,
          risk.eliteSpawnWeight,
          config.riskLevel,
          {
            spawnCap,
            aggressiveSpawn: missionUsesAggressiveSpawn(config),
            waveIntervalMult,
          },
        );
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
      console.warn('[MissionRunner] Could not find innocent spawn position.');
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

  /** Reveal the armed Postman after Ready To Reap / intro (gameplay must be unlocked). */
  public revealBossFight(world?: ENGINE.World | null): void {
    const w = world ?? this._world;
    if (!w) {
      return;
    }

    const boss = this._activeBoss ?? w.getActors().find(a => a instanceof PostmanBossActor);
    if (boss instanceof PostmanBossActor) {
      boss.revealForCombat();
    }
  }

  private _startBossFight(world: ENGINE.World, config: BossFightMissionConfig): void {
    this._teardownBossFight();

    const boss = PostmanBossActor.activateForMission(
      world,
      config.riskLevel,
      () => {
        missionState.onBossDefeated();
      },
      config.risk5PlusTier ?? 0,
    );
    if (!boss) {
      console.warn('[MissionRunner] Failed to activate Postman boss.');
      return;
    }

    boss.onHealthChanged = (current, max) => {
      missionState.onBossHealthChanged(current, max);
    };

    this._activeBoss = boss;
  }

  private _teardownBossFight(): void {
    this._activeBoss?.deactivateBossFight();
    this._activeBoss = null;

    const world = this._world;
    if (world) {
      PostmanBossMusicActor.stopAll(world);
      const bg = world.getActors().find(a => a instanceof BackgroundMusicActor);
      if (bg instanceof BackgroundMusicActor) {
        bg.stop();
      }
    }
  }
}

export const missionRunner = new MissionRunnerImpl();
