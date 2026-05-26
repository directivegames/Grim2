import * as ENGINE from '@gnsx/genesys.js';

import type { MissionConfig } from '../data/mission-types.js';
import { isReapAndSaveMission } from '../data/mission-types.js';

export type MissionFailReason = 'collateral' | 'grim-defeated';

export interface MissionSuccessResult {
  readonly outcome: 'success';
  readonly soulsCollected: number;
  readonly innocentsSaved: number;
  readonly elapsedSec: number;
}

export interface MissionFailedResult {
  readonly outcome: 'failed';
  readonly reason: MissionFailReason;
  readonly soulsCollected: number;
  readonly innocentsSaved: number;
  readonly collateralDamage: number;
  readonly elapsedSec: number;
}

export type MissionEndResult = MissionSuccessResult | MissionFailedResult;

/** Optional hooks for HUD, innocents, and end screens (wired in later steps). */
export interface MissionStateListeners {
  onCollateralChanged?: (percent: number) => void;
  onInnocentProgress?: (saved: number, required: number) => void;
  onSoulProgress?: (collected: number, required: number) => void;
  onInnocentSaveTimerChanged?: (secondsRemaining: number, limitSec: number) => void;
  /** Spawn or reveal the next innocent (one at a time). */
  onRequestInnocentSpawn?: () => void;
  /** Active innocent's save timer hit zero — only death cause. */
  onInnocentTimerExpired?: () => void;
  onInnocentSaved?: () => void;
  onInnocentKilled?: (collateralJumpPercent: number) => void;
  onMissionEnded?: (result: MissionEndResult) => void;
}

/**
 * Live mission progress for the active run (souls, innocents, collateral).
 * Singleton — reset when returning to the main menu.
 */
class MissionStateImpl {
  private _active = false;
  private _ended = false;
  private _config: MissionConfig | null = null;
  private _world: ENGINE.World | null = null;
  private _listeners: MissionStateListeners = {};

  private _soulsCollected = 0;
  private _innocentsSaved = 0;
  private _collateralDamage = 0;
  private _elapsedSec = 0;
  /** Countdown while an innocent is active — expiry is their only death. */
  private _innocentSaveTimerSec = 0;
  private _activeInnocent = false;
  private _innocentSpawnPending = false;
  private _spawnRetryDelaySec = 0;

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
    this._notifyProgress();
    this._requestNextInnocent();
  }

  public reset(): void {
    this._active = false;
    this._ended = false;
    this._config = null;
    this._world = null;
    this._listeners = {};
    this._soulsCollected = 0;
    this._innocentsSaved = 0;
    this._collateralDamage = 0;
    this._elapsedSec = 0;
    this._innocentSaveTimerSec = 0;
    this._activeInnocent = false;
    this._innocentSpawnPending = false;
    this._spawnRetryDelaySec = 0;
  }

  /** Advance passive collateral and innocent save timer. */
  public tick(deltaTime: number): void {
    if (!this.isActive || !this._config) return;

    this._elapsedSec += deltaTime;

    if (isReapAndSaveMission(this._config)) {
      this._collateralDamage = Math.min(
        100,
        this._collateralDamage + this._config.collateralTickPerSecond * deltaTime,
      );
      this._listeners.onCollateralChanged?.(this._collateralDamage);

      if (this._collateralDamage >= 100) {
        this._endFailed('collateral');
        return;
      }

      this._tickInnocentSaveTimer(deltaTime);
      this._tickInnocentSpawnRetry(deltaTime);
    }
  }

  public onSoulCollected(): void {
    if (!this.isActive || !this._config) return;

    this._soulsCollected++;
    this._notifyProgress();
    this._checkWin();
  }

  /** Called when the runner finishes spawning an innocent. */
  public onInnocentSpawned(): void {
    if (!this.isActive || !this._config || !isReapAndSaveMission(this._config)) return;

    this._innocentSpawnPending = false;
    this._activeInnocent = true;
    this._innocentSaveTimerSec = this._config.innocentSaveTimeLimitSec;
    this._listeners.onInnocentSaveTimerChanged?.(
      this._innocentSaveTimerSec,
      this._config.innocentSaveTimeLimitSec,
    );
  }

  /** Called when a spawn attempt fails — retry shortly. */
  public onInnocentSpawnFailed(): void {
    this._innocentSpawnPending = false;
    this._spawnRetryDelaySec = 0.5;
  }

  public onInnocentSaved(): void {
    if (!this.isActive || !this._config || !isReapAndSaveMission(this._config)) return;

    this._activeInnocent = false;
    this._innocentSaveTimerSec = 0;
    this._innocentsSaved++;
    this._listeners.onInnocentSaved?.();
    this._notifyProgress();
    this._listeners.onInnocentSaveTimerChanged?.(0, this._config.innocentSaveTimeLimitSec);
    this._checkWin();
    this._requestNextInnocent();
  }

  public onInnocentKilled(): void {
    if (!this.isActive || !this._config || !isReapAndSaveMission(this._config)) return;

    this._activeInnocent = false;
    this._innocentSaveTimerSec = 0;
    const jump = this._config.collateralJumpOnInnocentDeath;
    this._collateralDamage = Math.min(100, this._collateralDamage + jump);
    this._listeners.onCollateralChanged?.(this._collateralDamage);
    this._listeners.onInnocentKilled?.(jump);
    this._listeners.onInnocentSaveTimerChanged?.(0, this._config.innocentSaveTimeLimitSec);
    this._requestNextInnocent();

    if (this._collateralDamage >= 100) {
      this._endFailed('collateral');
    }
  }

  public onGrimDied(): void {
    if (!this.isActive) return;
    this._endFailed('grim-defeated');
  }

  private _tickInnocentSaveTimer(deltaTime: number): void {
    if (!this._config || !this._activeInnocent) return;

    this._innocentSaveTimerSec = Math.max(0, this._innocentSaveTimerSec - deltaTime);
    this._listeners.onInnocentSaveTimerChanged?.(
      this._innocentSaveTimerSec,
      this._config.innocentSaveTimeLimitSec,
    );

    if (this._innocentSaveTimerSec <= 0) {
      this._activeInnocent = false;
      this._listeners.onInnocentTimerExpired?.();
    }
  }

  /** Retry spawn only after a failed placement (not on timer death — that uses onInnocentKilled). */
  private _tickInnocentSpawnRetry(deltaTime: number): void {
    if (!this._config || this._spawnRetryDelaySec <= 0) return;
    if (this._activeInnocent || this._innocentSpawnPending) return;
    if (this._innocentsSaved >= this._config.innocentsToSave) return;

    this._spawnRetryDelaySec -= deltaTime;
    if (this._spawnRetryDelaySec <= 0) {
      this._tryRequestInnocentSpawn();
    }
  }

  private _requestNextInnocent(): void {
    if (!this._config || !isReapAndSaveMission(this._config)) return;
    if (this._innocentsSaved >= this._config.innocentsToSave) return;
    this._spawnRetryDelaySec = 0;
    this._tryRequestInnocentSpawn();
  }

  private _tryRequestInnocentSpawn(): void {
    if (!this._config || !isReapAndSaveMission(this._config)) return;
    if (
      this._activeInnocent ||
      this._innocentSpawnPending ||
      this._innocentsSaved >= this._config.innocentsToSave
    ) {
      return;
    }

    this._innocentSpawnPending = true;
    this._listeners.onRequestInnocentSpawn?.();
  }

  private _notifyProgress(): void {
    if (!this._config || !isReapAndSaveMission(this._config)) return;
    this._listeners.onSoulProgress?.(
      this._soulsCollected,
      this._config.soulsRequired,
    );
    this._listeners.onInnocentProgress?.(
      this._innocentsSaved,
      this._config.innocentsToSave,
    );
  }

  private _checkWin(): void {
    if (!this._config || !isReapAndSaveMission(this._config)) return;

    const soulsMet = this._soulsCollected >= this._config.soulsRequired;
    const innocentsMet = this._innocentsSaved >= this._config.innocentsToSave;
    if (!soulsMet || !innocentsMet) return;

    this._endSuccess();
  }

  private _endSuccess(): void {
    if (this._ended) return;
    this._ended = true;
    this._active = false;

    const result: MissionSuccessResult = {
      outcome: 'success',
      soulsCollected: this._soulsCollected,
      innocentsSaved: this._innocentsSaved,
      elapsedSec: this._elapsedSec,
    };
    this._listeners.onMissionEnded?.(result);
  }

  private _endFailed(reason: MissionFailReason): void {
    if (this._ended) return;
    this._ended = true;
    this._active = false;

    const result: MissionFailedResult = {
      outcome: 'failed',
      reason,
      soulsCollected: this._soulsCollected,
      innocentsSaved: this._innocentsSaved,
      collateralDamage: this._collateralDamage,
      elapsedSec: this._elapsedSec,
    };
    this._listeners.onMissionEnded?.(result);
  }
}

export const missionState = new MissionStateImpl();
