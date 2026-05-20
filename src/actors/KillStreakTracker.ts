import * as ENGINE from '@gnsx/genesys.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';

const KILL_WINDOW_SEC = 2.0;
const STREAK_THRESHOLD = 10;
const SLOMO_VALUE = 0.12;
const SLOMO_DURATION_SEC = 4.5;
const SHAKE_INTENSITY = 0.5;
const SHAKE_DURATION = 0.7;
const POST_STREAK_COOLDOWN_SEC = 2.0;

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
 */
class KillStreakTracker {
  private readonly _killTimesSec: number[] = [];
  private _isInStreak = false;
  private _streakElapsedSec = 0;
  private _cooldownElapsedSec = POST_STREAK_COOLDOWN_SEC;
  private _trackedWorld: ENGINE.World | null = null;

  public recordKill(world: ENGINE.World): void {
    this._trackedWorld = world;
    const now = world.getGameTime();
    this._killTimesSec.push(now);

    const cutoff = now - KILL_WINDOW_SEC;
    while (this._killTimesSec.length > 0 && this._killTimesSec[0]! < cutoff) {
      this._killTimesSec.shift();
    }

    if (this._killTimesSec.length >= STREAK_THRESHOLD && !this._isInStreak) {
      if (this._cooldownElapsedSec >= POST_STREAK_COOLDOWN_SEC) {
        this._triggerStreak(world);
      }
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
        this._isInStreak = false;
        this._streakElapsedSec = 0;
        this._cooldownElapsedSec = 0;
      }
      return;
    }

    if (this._cooldownElapsedSec < POST_STREAK_COOLDOWN_SEC) {
      this._cooldownElapsedSec += realDt;
    }
  }

  private _triggerStreak(world: ENGINE.World): void {
    this._isInStreak = true;
    this._streakElapsedSec = 0;

    slomoManager.setSlomo(world, SLOMO_VALUE, SLOMO_PRIORITY.killStreak);

    const player = world.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(SHAKE_INTENSITY, SHAKE_DURATION);
      player.triggerFOVPunch(1.0);
      player.triggerKillStreakPunch();
    }

    this._killTimesSec.length = 0;
  }

  public reset(): void {
    if (this._trackedWorld) {
      slomoManager.removePriorityAndRestore(this._trackedWorld, SLOMO_PRIORITY.killStreak);
    }
    this._killTimesSec.length = 0;
    this._isInStreak = false;
    this._streakElapsedSec = 0;
    this._cooldownElapsedSec = POST_STREAK_COOLDOWN_SEC;
  }
}

export const killStreakTracker = new KillStreakTracker();
