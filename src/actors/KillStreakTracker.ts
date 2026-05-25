import * as ENGINE from '@gnsx/genesys.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';
import { gameSettings } from '../utils/game-settings.js';

const KILL_WINDOW_SEC = 2.0;
/** Kills required per tier; escalates on each trigger, decays one step after inactivity. */
const STREAK_THRESHOLDS = [10, 15, 25, 40] as const;
/** Wall-clock seconds without a trigger before dropping one threshold tier. */
const THRESHOLD_DECAY_SEC = 30;
/** After slow-mo ends, ignore kills until this lockout expires (then counting resumes). */
const POST_STREAK_LOCKOUT_SEC = 10;
const SLOMO_VALUE = 0.12;
const SLOMO_DURATION_SEC = 4.5;
const SHAKE_INTENSITY = 0.5;
const SHAKE_DURATION = 0.7;
/** Chance per kill-streak to play a full 360° orbit around Grim (wall-clock timed). */
const KILLSTREAK_ORBIT_CHANCE = 0.3;

/** Priority-ordered slomo sources. Higher value = higher priority. */
export const SLOMO_PRIORITY = {
  hitStop: 3,
  fist: 2,
  killStreak: 1,
  normal: 0,
} as const;

/** Slomo priority manager - singleton pattern for cross-module access. */
class SlomoManager {
  private _priority: number = SLOMO_PRIORITY.normal;
  private _stack: Array<{ priority: number; value: number }> = [];

  get priority(): number { return this._priority; }

  setSlomo(world: ENGINE.World, value: number, newPriority: number): boolean {
    if (newPriority <= this._priority) return false;

    this._stack.push({ priority: this._priority, value: (world as unknown as { slomo: number }).slomo });

    (world as unknown as { slomo: number }).slomo = value;
    this._priority = newPriority;
    return true;
  }

  resetIfPriority(world: ENGINE.World, expectedPriority: number): void {
    if (this._priority !== expectedPriority) return;

    const prev = this._stack.pop();
    if (prev) {
      this._priority = prev.priority;
      (world as unknown as { slomo: number }).slomo = prev.value;
    } else {
      this._priority = SLOMO_PRIORITY.normal;
      (world as unknown as { slomo: number }).slomo = 1;
    }
  }

  removePriorityAndRestore(world: ENGINE.World, priorityToRemove: number): void {
    let targetEntry: { priority: number; value: number } | null = null;

    for (let i = this._stack.length - 1; i >= 0; i--) {
      if (this._stack[i]!.priority !== priorityToRemove) {
        targetEntry = this._stack[i]!;
        break;
      }
    }

    this._stack = this._stack.filter(entry => entry.priority !== priorityToRemove);

    if (targetEntry) {
      this._priority = targetEntry.priority;
      (world as unknown as { slomo: number }).slomo = targetEntry.value;
    } else if (this._priority === priorityToRemove) {
      this._priority = SLOMO_PRIORITY.normal;
      (world as unknown as { slomo: number }).slomo = 1;
    }
  }

  forceReset(world: ENGINE.World): void {
    this._priority = SLOMO_PRIORITY.normal;
    this._stack = [];
    (world as unknown as { slomo: number }).slomo = 1;
  }
}

export const slomoManager = new SlomoManager();

export function requestHitStopSlomo(world: ENGINE.World): boolean {
  return slomoManager.setSlomo(world, 0.04, SLOMO_PRIORITY.hitStop);
}

export function endHitStopSlomo(world: ENGINE.World): void {
  slomoManager.resetIfPriority(world, SLOMO_PRIORITY.hitStop);
}

/**
 * Kill streak tracker — streak duration uses unscaled (wall-clock) time so slomo ends on schedule.
 * Threshold escalates (10 → 15 → 25 → 40) on each trigger; decays one tier per 30s without a trigger.
 */
class KillStreakTracker {
  private readonly _killTimesSec: number[] = [];
  private _isInStreak = false;
  private _streakElapsedSec = 0;
  private _thresholdIndex = 0;
  private _decayElapsedSec = 0;
  private _lockoutRemainingSec = 0;
  private _trackedWorld: ENGINE.World | null = null;

  private _currentThreshold(): number {
    return STREAK_THRESHOLDS[this._thresholdIndex] ?? STREAK_THRESHOLDS[0]!;
  }

  /** Kills in the current window toward the active threshold. */
  public getKillsInWindow(): number {
    return this._killTimesSec.length;
  }

  /** Kills required to trigger slow-mo at the current tier. */
  public getThresholdRequired(): number {
    return this._currentThreshold();
  }

  public recordKill(world: ENGINE.World): void {
    this._trackedWorld = world;
    if (this._isInStreak || this._lockoutRemainingSec > 0) {
      return;
    }

    const now = world.getGameTime();
    this._killTimesSec.push(now);

    const cutoff = now - KILL_WINDOW_SEC;
    while (this._killTimesSec.length > 0 && this._killTimesSec[0]! < cutoff) {
      this._killTimesSec.shift();
    }

    if (this._killTimesSec.length >= this._currentThreshold() && !this._isInStreak) {
      this._triggerStreak(world);
    }
  }

  /** Call each frame from player tick with scaled deltaTime. */
  public tick(world: ENGINE.World, deltaTime: number): void {
    this._trackedWorld = world;
    const realDt = getUnscaledDeltaTime(world, deltaTime);

    if (this._isInStreak) {
      this._streakElapsedSec += realDt;
      if (this._streakElapsedSec >= SLOMO_DURATION_SEC) {
        slomoManager.removePriorityAndRestore(world, SLOMO_PRIORITY.killStreak);
        this._restoreSlomoAudio(world);
        this._isInStreak = false;
        this._streakElapsedSec = 0;
        this._killTimesSec.length = 0;
        this._lockoutRemainingSec = POST_STREAK_LOCKOUT_SEC;
        const player = world.getFirstPlayerPawn();
        if (player instanceof IsometricPlayerPawn) {
          player.endKillStreakOrbit();
          player.endSlomoEffect();
        }
      }
      return;
    }

    if (this._lockoutRemainingSec > 0) {
      this._lockoutRemainingSec = Math.max(0, this._lockoutRemainingSec - realDt);
    }

    this._decayElapsedSec += realDt;
    if (this._decayElapsedSec >= THRESHOLD_DECAY_SEC && this._thresholdIndex > 0) {
      this._thresholdIndex--;
      this._decayElapsedSec = 0;
    }
  }

  private _restoreSlomoAudio(world: ENGINE.World): void {
    getGameAudioManager(world).syncPlaybackRates(1.0);
  }

  private _triggerStreak(world: ENGINE.World): void {
    this._isInStreak = true;
    this._streakElapsedSec = 0;
    this._decayElapsedSec = 0;

    const maxIndex = STREAK_THRESHOLDS.length - 1;
    if (this._thresholdIndex < maxIndex) {
      this._thresholdIndex++;
    }

    slomoManager.setSlomo(world, SLOMO_VALUE, SLOMO_PRIORITY.killStreak);

    const player = world.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(SHAKE_INTENSITY, SHAKE_DURATION);
      player.triggerFOVPunch(1.0);
      player.triggerKillStreakPunch();
      player.startSlomoEffect();
      if (Math.random() < KILLSTREAK_ORBIT_CHANCE && !gameSettings.disable360Spin) {
        player.startKillStreakOrbit(SLOMO_DURATION_SEC);
      }
    }

    this._killTimesSec.length = 0;
  }

  public reset(): void {
    if (this._trackedWorld) {
      slomoManager.removePriorityAndRestore(this._trackedWorld, SLOMO_PRIORITY.killStreak);
      this._restoreSlomoAudio(this._trackedWorld);
      const player = this._trackedWorld.getFirstPlayerPawn();
      if (player instanceof IsometricPlayerPawn) {
        player.endKillStreakOrbit();
        player.endSlomoEffect();
      }
    }
    this._killTimesSec.length = 0;
    this._isInStreak = false;
    this._streakElapsedSec = 0;
    this._thresholdIndex = 0;
    this._decayElapsedSec = 0;
    this._lockoutRemainingSec = 0;
  }
}

export const killStreakTracker = new KillStreakTracker();
