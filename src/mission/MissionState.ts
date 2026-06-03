import * as ENGINE from '@gnsx/genesys.js';

import type { MissionConfig } from '../data/mission-types.js';
import {
  isBossFightMission,
  isCauseDamageMission,
  isChainReapMission,
  isReapAndSaveMission,
  isReapBeforeCollateralMission,
  isReapMission,
  isSoulSaverMission,
  isSpeedReapMission,
  isSurviveMission,
  missionTracksSoulReap,
  missionUsesCollateral,
  missionUsesInnocents,
} from '../data/mission-types.js';
import { chainReapKillCounts } from '../game/risk5-plus.js';
import { ItemCollectedToastUI } from '../ui/ItemCollectedToastUI.js';
import type { RiskLevel } from '../data/risk-levels.js';

export type MissionFailReason =
  | 'collateral'
  | 'grim-defeated'
  | 'time-expired'
  | 'combo-lost';

export interface MissionSuccessResult {
  readonly outcome: 'success';
  /** Risk tier completed (used for unlock progression). */
  readonly riskLevel: RiskLevel;
  /** Risk 5+ endless tier (0/undefined = normal run). */
  readonly risk5PlusTier?: number;
  /** Every enemy kill this run (banked to the vault on collect). */
  readonly soulsCollected: number;
  readonly innocentsSaved: number;
  readonly elapsedSec: number;
  /** Item drops earned this run (banked on collect). */
  readonly itemDrops: readonly string[];
}

export interface MissionFailedResult {
  readonly outcome: 'failed';
  readonly reason: MissionFailReason;
  readonly riskLevel: RiskLevel;
  readonly risk5PlusTier?: number;
  readonly soulsCollected: number;
  readonly innocentsSaved: number;
  readonly collateralDamage: number;
  readonly elapsedSec: number;
}

export type MissionEndResult = MissionSuccessResult | MissionFailedResult;

export interface MissionStateListeners {
  onCollateralChanged?: (percent: number) => void;
  onInnocentProgress?: (saved: number, required: number) => void;
  onSoulProgress?: (collected: number, required: number) => void;
  onInnocentSaveTimerChanged?: (secondsRemaining: number, limitSec: number) => void;
  onSurviveTimerChanged?: (remainingSec: number, totalSec: number, label: string) => void;
  onDamageProgress?: (dealt: number, required: number) => void;
  onBossHealthChanged?: (current: number, max: number) => void;
  onRequestInnocentSpawn?: () => void;
  onInnocentTimerExpired?: () => void;
  onInnocentSaved?: () => void;
  onInnocentKilled?: (collateralJumpPercent: number) => void;
  onMissionEnded?: (result: MissionEndResult) => void;
}

class MissionStateImpl {
  private _active = false;
  private _ended = false;
  private _config: MissionConfig | null = null;
  private _world: ENGINE.World | null = null;
  private _listeners: MissionStateListeners = {};

  /** Mission goal progress (reap types). */
  private _soulsCollected = 0;
  /** Every enemy kill — used for vault banking and fail 10% retain. */
  private _runSoulsFromKills = 0;
  private _innocentsSaved = 0;
  private _collateralDamage = 0;
  private _damageDealt = 0;
  private _elapsedSec = 0;
  private _surviveRemainingSec = 0;
  private _timeLimitRemainingSec = 0;
  private _comboGraceElapsedSec = 0;

  private _chainTimerActive = false;
  private _chainKillsCounted = 0;
  private _chainTimeRemainingSec = 0;

  private _innocentSaveTimerSec = 0;
  private _activeInnocent = false;
  private _innocentSpawnPending = false;
  private _spawnRetryDelaySec = 0;
  private readonly _pendingItemDrops: string[] = [];

  public get isActive(): boolean {
    return this._active && !this._ended;
  }

  public get config(): MissionConfig | null {
    return this._config;
  }

  public get world(): ENGINE.World | null {
    return this._world;
  }

  public get soulsCollected(): number {
    return this._soulsCollected;
  }

  /** Total souls from enemy kills this run (vault / fail retain). */
  public get runSoulsFromKills(): number {
    return this._runSoulsFromKills;
  }

  public get innocentsSaved(): number {
    return this._innocentsSaved;
  }

  public get collateralDamage(): number {
    return this._collateralDamage;
  }

  public get elapsedSec(): number {
    return this._elapsedSec;
  }

  public get hasActiveInnocent(): boolean {
    return this._activeInnocent;
  }

  public get innocentSaveTimerSec(): number {
    return this._innocentSaveTimerSec;
  }

  public get pendingItemDrops(): readonly string[] {
    return this._pendingItemDrops;
  }

  public addItemDrop(itemId: string): void {
    if (!this.isActive || !itemId) {
      return;
    }
    this._pendingItemDrops.push(itemId);

    const world = this._world;
    if (world) {
      void ItemCollectedToastUI.notify(world, itemId);
    }
  }

  public setListeners(listeners: MissionStateListeners): void {
    this._listeners = listeners;
  }

  public start(config: MissionConfig, world: ENGINE.World): void {
    const listeners = this._listeners;
    this.reset();
    this._listeners = listeners;
    this._active = true;
    this._config = config;
    this._world = world;

    if (isSurviveMission(config)) {
      this._surviveRemainingSec = config.durationSec;
    }
    if (isSpeedReapMission(config)) {
      this._timeLimitRemainingSec = config.timeLimitSec;
    }
    if (isChainReapMission(config)) {
      this._chainTimeRemainingSec = config.timeLimitSec;
    }

    this._notifyProgress();
    if (missionUsesInnocents(config)) {
      this._requestNextInnocent();
    }
  }

  public reset(): void {
    this._active = false;
    this._ended = false;
    this._config = null;
    this._world = null;
    this._listeners = {};
    this._soulsCollected = 0;
    this._runSoulsFromKills = 0;
    this._innocentsSaved = 0;
    this._collateralDamage = 0;
    this._damageDealt = 0;
    this._elapsedSec = 0;
    this._surviveRemainingSec = 0;
    this._timeLimitRemainingSec = 0;
    this._comboGraceElapsedSec = 0;
    this._chainTimerActive = false;
    this._chainKillsCounted = 0;
    this._chainTimeRemainingSec = 0;
    this._innocentSaveTimerSec = 0;
    this._activeInnocent = false;
    this._innocentSpawnPending = false;
    this._spawnRetryDelaySec = 0;
    this._pendingItemDrops.length = 0;
  }

  public tick(deltaTime: number): void {
    if (!this.isActive || !this._config) return;

    this._elapsedSec += deltaTime;
    const config = this._config;

    if (missionUsesCollateral(config)) {
      const tickRate =
        isReapAndSaveMission(config)
          ? config.collateralTickPerSecond
          : isCauseDamageMission(config)
            ? config.collateralTickPerSecond
            : isReapBeforeCollateralMission(config)
              ? config.collateralTickPerSecond
              : isChainReapMission(config)
                ? config.collateralTickPerSecond
                : 0;

      this._collateralDamage = Math.min(100, this._collateralDamage + tickRate * deltaTime);
      this._listeners.onCollateralChanged?.(this._collateralDamage);

      if (this._collateralDamage >= 100) {
        this._endFailed('collateral');
        return;
      }
    }

    if (isSurviveMission(config)) {
      this._surviveRemainingSec = Math.max(0, this._surviveRemainingSec - deltaTime);
      this._listeners.onSurviveTimerChanged?.(
        this._surviveRemainingSec,
        config.durationSec,
        'SURVIVE',
      );
      if (this._surviveRemainingSec <= 0) {
        this._endSuccess();
        return;
      }
    }

    if (isSpeedReapMission(config)) {
      this._timeLimitRemainingSec = Math.max(0, this._timeLimitRemainingSec - deltaTime);
      this._listeners.onSurviveTimerChanged?.(
        this._timeLimitRemainingSec,
        config.timeLimitSec,
        'TIME LEFT',
      );
      if (this._timeLimitRemainingSec <= 0 && this._soulsCollected < config.soulsRequired) {
        this._endFailed('time-expired');
        return;
      }
    }

    if (isChainReapMission(config)) {
      if (this._chainTimerActive) {
        this._chainTimeRemainingSec = Math.max(0, this._chainTimeRemainingSec - deltaTime);
        this._listeners.onSurviveTimerChanged?.(
          this._chainTimeRemainingSec,
          config.timeLimitSec,
          'TIME LEFT',
        );
        if (
          this._chainTimeRemainingSec <= 0 &&
          this._chainKillsCounted < config.killsRequired
        ) {
          this._endFailed('time-expired');
          return;
        }
      }
    }

    if (missionUsesInnocents(config)) {
      this._tickInnocentSaveTimer(deltaTime);
      this._tickInnocentSpawnRetry(deltaTime);
    }
  }

  /** Called when an enemy is killed — credits mission progress and end-of-run rewards. */
  public onEnemyReaped(): void {
    if (!this.isActive || !this._config) return;

    this._runSoulsFromKills++;

    const config = this._config;

    if (missionTracksSoulReap(config)) {
      this._soulsCollected++;
      this._notifyProgress();
      this._checkWin();
    }
  }

  /** @deprecated Use onEnemyReaped — kept for SoulActor pickup if re-enabled. */
  public onSoulCollected(): void {
    this.onEnemyReaped();
  }

  /** Chain Reap: called after each enemy kill (combo checked after increment). */
  public onChainReapEnemyKill(comboAfterKill: number): void {
    if (!this.isActive || !this._config || !isChainReapMission(this._config)) {
      return;
    }

    const config = this._config;

    if (chainReapKillCounts(comboAfterKill)) {
      if (!this._chainTimerActive) {
        this._chainTimerActive = true;
        this._chainTimeRemainingSec = config.timeLimitSec;
        this._listeners.onSurviveTimerChanged?.(
          this._chainTimeRemainingSec,
          config.timeLimitSec,
          'TIME LEFT',
        );
      }
      this._chainKillsCounted++;
      this._notifyProgress();
      this._checkWin();
    }
  }

  public onDamageDealt(amount: number): void {
    if (!this.isActive || !this._config || !isCauseDamageMission(this._config)) return;
    if (amount <= 0 || !Number.isFinite(amount)) return;

    this._damageDealt += Math.floor(amount);
    this._listeners.onDamageProgress?.(this._damageDealt, this._config.damageRequired);
    if (this._damageDealt >= this._config.damageRequired) {
      this._endSuccess();
    }
  }

  public onInnocentSpawned(): void {
    if (!this.isActive || !this._config || !missionUsesInnocents(this._config)) return;

    const saveLimit = this._innocentSaveTimeLimitSec();
    if (saveLimit === null) return;

    this._innocentSpawnPending = false;
    this._activeInnocent = true;
    this._innocentSaveTimerSec = saveLimit;
    this._listeners.onInnocentSaveTimerChanged?.(this._innocentSaveTimerSec, saveLimit);
  }

  public onInnocentSpawnFailed(): void {
    this._innocentSpawnPending = false;
    this._spawnRetryDelaySec = 0.5;
  }

  public onInnocentSaved(): void {
    if (!this.isActive || !this._config || !missionUsesInnocents(this._config)) return;

    const saveLimit = this._innocentSaveTimeLimitSec() ?? 0;

    this._activeInnocent = false;
    this._innocentSaveTimerSec = 0;
    this._innocentsSaved++;
    this._listeners.onInnocentSaved?.();
    this._notifyProgress();
    this._listeners.onInnocentSaveTimerChanged?.(0, saveLimit);
    this._checkWin();
    this._requestNextInnocent();
  }

  public onInnocentKilled(): void {
    if (!this.isActive || !this._config || !missionUsesInnocents(this._config)) return;

    const saveLimit = this._innocentSaveTimeLimitSec() ?? 0;

    this._activeInnocent = false;
    this._innocentSaveTimerSec = 0;

    if (isReapAndSaveMission(this._config)) {
      const jump = this._config.collateralJumpOnInnocentDeath;
      this._collateralDamage = Math.min(100, this._collateralDamage + jump);
      this._listeners.onCollateralChanged?.(this._collateralDamage);
      this._listeners.onInnocentKilled?.(jump);
      if (this._collateralDamage >= 100) {
        this._endFailed('collateral');
        return;
      }
    } else {
      this._listeners.onInnocentKilled?.(0);
    }

    this._listeners.onInnocentSaveTimerChanged?.(0, saveLimit);
    this._requestNextInnocent();
  }

  public onGrimDied(): void {
    if (!this.isActive) return;
    this._endFailed('grim-defeated');
  }

  /** Boss fight HUD — Postman health bar. */
  public onBossHealthChanged(current: number, max: number): void {
    if (!this.isActive || !this._config || !isBossFightMission(this._config)) {
      return;
    }
    this._listeners.onBossHealthChanged?.(current, max);
  }

  /** Postman defeated — mission success with flat soul payout. */
  public onBossDefeated(): void {
    if (!this.isActive || !this._config || !isBossFightMission(this._config)) {
      return;
    }

    const reward = 200 * this._config.riskLevel;
    this._runSoulsFromKills = Math.max(this._runSoulsFromKills, reward);
    this._endSuccess();
  }

  public debugForceSuccess(): void {
    if (!this._active || this._ended || !this._config) {
      return;
    }
    const config = this._config;

    if (isReapAndSaveMission(config)) {
      this._soulsCollected = Math.max(this._soulsCollected, config.soulsRequired);
      this._innocentsSaved = Math.max(this._innocentsSaved, config.innocentsToSave);
    } else if (isChainReapMission(config)) {
      this._chainTimerActive = true;
      this._chainKillsCounted = Math.max(this._chainKillsCounted, config.killsRequired);
    } else if (isReapMission(config) || isReapBeforeCollateralMission(config) || isSpeedReapMission(config)) {
      this._soulsCollected = Math.max(this._soulsCollected, config.soulsRequired);
    } else if (isSoulSaverMission(config)) {
      this._innocentsSaved = Math.max(this._innocentsSaved, config.soulsToSave);
    } else if (isCauseDamageMission(config)) {
      this._damageDealt = Math.max(this._damageDealt, config.damageRequired);
    } else if (isSurviveMission(config)) {
      this._surviveRemainingSec = 0;
    } else if (isBossFightMission(config)) {
      this._runSoulsFromKills = Math.max(this._runSoulsFromKills, 200 * config.riskLevel);
    }

    this._endSuccess();
  }

  private _tickInnocentSaveTimer(deltaTime: number): void {
    if (!this._config || !this._activeInnocent) return;
    const saveLimit = this._innocentSaveTimeLimitSec();
    if (saveLimit === null) return;

    this._innocentSaveTimerSec = Math.max(0, this._innocentSaveTimerSec - deltaTime);
    this._listeners.onInnocentSaveTimerChanged?.(this._innocentSaveTimerSec, saveLimit);

    if (this._innocentSaveTimerSec <= 0) {
      this._activeInnocent = false;
      this._listeners.onInnocentTimerExpired?.();
    }
  }

  private _tickInnocentSpawnRetry(deltaTime: number): void {
    if (!this._config || this._spawnRetryDelaySec <= 0) return;
    if (this._activeInnocent || this._innocentSpawnPending) return;
    const saveTarget = this._innocentSaveTarget();
    if (saveTarget === null || this._innocentsSaved >= saveTarget) return;

    this._spawnRetryDelaySec -= deltaTime;
    if (this._spawnRetryDelaySec <= 0) {
      this._tryRequestInnocentSpawn();
    }
  }

  private _innocentSaveTimeLimitSec(): number | null {
    if (!this._config) return null;
    if (isReapAndSaveMission(this._config)) {
      return this._config.innocentSaveTimeLimitSec;
    }
    if (isSoulSaverMission(this._config)) {
      return this._config.innocentSaveTimeLimitSec;
    }
    return null;
  }

  private _innocentSaveTarget(): number | null {
    if (!this._config) return null;
    if (isReapAndSaveMission(this._config)) {
      return this._config.innocentsToSave;
    }
    if (isSoulSaverMission(this._config)) {
      return this._config.soulsToSave;
    }
    return null;
  }

  private _soulsRequired(): number | null {
    if (!this._config) return null;
    switch (this._config.type) {
      case 'reap-and-save':
      case 'reap':
      case 'reap-before-collateral':
      case 'speed-reap':
        return this._config.soulsRequired;
      case 'chain-reap':
        return null;
      default:
        return null;
    }
  }

  private _requestNextInnocent(): void {
    if (!this._config || !missionUsesInnocents(this._config)) return;
    const target = this._innocentSaveTarget();
    if (target === null || this._innocentsSaved >= target) return;
    this._spawnRetryDelaySec = 0;
    this._tryRequestInnocentSpawn();
  }

  private _tryRequestInnocentSpawn(): void {
    if (!this._config || !missionUsesInnocents(this._config)) return;
    const target = this._innocentSaveTarget();
    if (target === null || this._activeInnocent || this._innocentSpawnPending || this._innocentsSaved >= target) {
      return;
    }

    this._innocentSpawnPending = true;
    this._listeners.onRequestInnocentSpawn?.();
  }

  private _notifyProgress(): void {
    if (!this._config) return;
    const config = this._config;

    const soulsReq = this._soulsRequired();
    if (soulsReq !== null) {
      this._listeners.onSoulProgress?.(this._soulsCollected, soulsReq);
    }

    const innocentTarget = this._innocentSaveTarget();
    if (innocentTarget !== null) {
      this._listeners.onInnocentProgress?.(this._innocentsSaved, innocentTarget);
    }

    if (isCauseDamageMission(config)) {
      this._listeners.onDamageProgress?.(this._damageDealt, config.damageRequired);
    }

    if (isSurviveMission(config)) {
      this._listeners.onSurviveTimerChanged?.(
        this._surviveRemainingSec,
        config.durationSec,
        'SURVIVE',
      );
    }

    if (isSpeedReapMission(config)) {
      this._listeners.onSurviveTimerChanged?.(
        this._timeLimitRemainingSec,
        config.timeLimitSec,
        'TIME LEFT',
      );
    }

    if (isChainReapMission(config)) {
      this._listeners.onSoulProgress?.(
        this._chainKillsCounted,
        config.killsRequired,
      );
      if (this._chainTimerActive) {
        this._listeners.onSurviveTimerChanged?.(
          this._chainTimeRemainingSec,
          config.timeLimitSec,
          'TIME LEFT',
        );
      }
    }
  }

  private _checkWin(): void {
    if (!this._config) return;
    const config = this._config;

    if (isReapAndSaveMission(config)) {
      if (
        this._soulsCollected >= config.soulsRequired &&
        this._innocentsSaved >= config.innocentsToSave
      ) {
        this._endSuccess();
      }
      return;
    }

    if (isReapMission(config) || isReapBeforeCollateralMission(config)) {
      if (this._soulsCollected >= config.soulsRequired) {
        this._endSuccess();
      }
      return;
    }

    if (isChainReapMission(config)) {
      if (this._chainKillsCounted >= config.killsRequired) {
        this._endSuccess();
      }
      return;
    }

    if (isSpeedReapMission(config)) {
      if (this._soulsCollected >= config.soulsRequired) {
        this._endSuccess();
      }
      return;
    }

    if (isSoulSaverMission(config)) {
      if (this._innocentsSaved >= config.soulsToSave) {
        this._endSuccess();
      }
    }
  }

  /** Souls banked to vault on success, or used for 10% retain on fail. */
  private _bankableSouls(): number {
    if (!this._config) return 0;
    if (isSoulSaverMission(this._config)) {
      return this._innocentsSaved;
    }
    return this._runSoulsFromKills;
  }

  private _endSuccess(): void {
    if (this._ended) return;
    this._ended = true;
    this._active = false;

    const cfg = this._config;
    const result: MissionSuccessResult = {
      outcome: 'success',
      riskLevel: cfg?.riskLevel ?? 1,
      risk5PlusTier: cfg?.risk5PlusTier ?? 0,
      soulsCollected: this._bankableSouls(),
      innocentsSaved: this._innocentsSaved,
      elapsedSec: this._elapsedSec,
      itemDrops: [...this._pendingItemDrops],
    };
    this._listeners.onMissionEnded?.(result);
  }

  private _endFailed(reason: MissionFailReason): void {
    if (this._ended) return;
    this._ended = true;
    this._active = false;

    this._pendingItemDrops.length = 0;

    const cfg = this._config;
    const result: MissionFailedResult = {
      outcome: 'failed',
      reason,
      riskLevel: cfg?.riskLevel ?? 1,
      risk5PlusTier: cfg?.risk5PlusTier ?? 0,
      soulsCollected: this._bankableSouls(),
      innocentsSaved: this._innocentsSaved,
      collateralDamage: this._collateralDamage,
      elapsedSec: this._elapsedSec,
    };
    this._listeners.onMissionEnded?.(result);
  }
}

export const missionState = new MissionStateImpl();
