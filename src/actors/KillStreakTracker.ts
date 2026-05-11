import * as ENGINE from '@gnsx/genesys.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';

const KILL_WINDOW_MS           = 2000;  // kills within this real-time window count toward streak
const STREAK_THRESHOLD         = 10;    // kills needed to trigger slow-mo
const SLOMO_VALUE              = 0.12;  // 12% speed - more dramatic bullet time
const SLOMO_DURATION_MS        = 4500;  // 4.5 seconds - longer epic moment
const SHAKE_INTENSITY          = 1.2;   // stronger camera rumble
const SHAKE_DURATION           = 1.0;   // shake lasts full duration
const POST_STREAK_COOLDOWN_MS  = 2000;  // real-time ms before streak can fire again (shorter for more fun)

/** Priority-ordered slomo sources. Higher value = higher priority. */
export const SLOMO_PRIORITY = {
  hitStop: 3,     // brief freeze on weapon hit
  fist: 2,        // cinematic fist attack
  killStreak: 1,  // multi-kill reward
  normal: 0,
} as const;

/** Slomo priority manager - singleton pattern for cross-module access. */
class SlomoManager {
  private _priority: number = SLOMO_PRIORITY.normal;
  /** Stack of active slomo sources for proper restoration. */
  private _stack: Array<{ priority: number; value: number }> = [];

  get priority(): number { return this._priority; }

  setSlomo(world: ENGINE.World, value: number, newPriority: number): boolean {
    if (newPriority <= this._priority) return false;

    // Push current state before upgrading
    this._stack.push({ priority: this._priority, value: (world as unknown as { slomo: number }).slomo });

    (world as unknown as { slomo: number }).slomo = value;
    this._priority = newPriority;
    return true;
  }

  resetIfPriority(world: ENGINE.World, expectedPriority: number): void {
    if (this._priority !== expectedPriority) return;

    // Pop the previous state
    const prev = this._stack.pop();
    if (prev) {
      this._priority = prev.priority;
      (world as unknown as { slomo: number }).slomo = prev.value;
    } else {
      // Nothing to restore to
      this._priority = SLOMO_PRIORITY.normal;
      (world as unknown as { slomo: number }).slomo = 1;
    }
  }

  /**
   * Remove all stack entries for a specific priority and restore to the state
   * before those entries were pushed. This prevents stuck slowmo when higher
   * priority effects fire during a lower priority effect's duration.
   */
  removePriorityAndRestore(world: ENGINE.World, priorityToRemove: number): void {
    // Find the first entry before our priority entries were pushed
    let targetEntry: { priority: number; value: number } | null = null;

    // Work backwards through stack to find state before our entries
    for (let i = this._stack.length - 1; i >= 0; i--) {
      if (this._stack[i]!.priority !== priorityToRemove) {
        // This is the state we want to restore to
        targetEntry = this._stack[i]!;
        break;
      }
    }

    // Remove all entries with the target priority
    this._stack = this._stack.filter(entry => entry.priority !== priorityToRemove);

    // Restore to the found state, or normal if nothing found
    if (targetEntry) {
      this._priority = targetEntry.priority;
      (world as unknown as { slomo: number }).slomo = targetEntry.value;
    } else if (this._priority === priorityToRemove) {
      // Current priority is the one being removed, reset to normal
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

/** Public API for hit stop to request slomo with its priority. */
export function requestHitStopSlomo(world: ENGINE.World): boolean {
  return slomoManager.setSlomo(world, 0.04, SLOMO_PRIORITY.hitStop);
}

/** Call when hit stop ends. */
export function endHitStopSlomo(world: ENGINE.World): void {
  slomoManager.resetIfPriority(world, SLOMO_PRIORITY.hitStop);
}

/**
 * Singleton kill streak tracker.
 * Records zombie deaths and triggers slow-mo + screen flash + camera shake
 * when STREAK_THRESHOLD kills happen within KILL_WINDOW_MS (real time).
 */
class KillStreakTracker {
  private _killTimestampsMs: number[] = [];
  private _isInStreak = false;
  private _restoreTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private _lastStreakEndTimeMs = -POST_STREAK_COOLDOWN_MS; // ready immediately at start

  public recordKill(world: ENGINE.World): void {
    const nowMs = performance.now();

    // Add this kill
    this._killTimestampsMs.push(nowMs);

    // Flush kills outside the real-time window
    const cutoffMs = nowMs - KILL_WINDOW_MS;
    while (this._killTimestampsMs.length > 0 && this._killTimestampsMs[0] < cutoffMs) {
      this._killTimestampsMs.shift();
    }

    // Check if we have enough kills for a streak
    if (this._killTimestampsMs.length >= STREAK_THRESHOLD && !this._isInStreak) {
      // Enforce post-streak cooldown
      if (nowMs - this._lastStreakEndTimeMs >= POST_STREAK_COOLDOWN_MS) {
        this._triggerStreak(world);
      }
    }
  }

  private _triggerStreak(world: ENGINE.World): void {
    this._isInStreak = true;

    // Only trigger if no higher priority slomo is active
    slomoManager.setSlomo(world, SLOMO_VALUE, SLOMO_PRIORITY.killStreak);

    const player = world.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(SHAKE_INTENSITY, SHAKE_DURATION);
      player.triggerFOVPunch(1.0); // Full FOV punch on streak trigger
    }

    // Screen flash - epic kill streak flash
    const container = world.gameContainer;
    if (container) {
      const flash = document.createElement('div');
      flash.style.cssText = [
        'position:absolute',
        'inset:0',
        'background:radial-gradient(circle,rgba(255,220,80,0.7) 0%,rgba(255,140,0,0.4) 40%,transparent 75%)',
        'pointer-events:none',
        'opacity:1',
        'z-index:200',
      ].join(';');
      container.appendChild(flash);

      const startTime = performance.now();
      const animate = (): void => {
        const t = Math.min((performance.now() - startTime) / 1200, 1);
        // Hold full brightness briefly then ease out
        const opacity = t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.85);
        flash.style.opacity = String(opacity);
        if (t < 1) requestAnimationFrame(animate);
        else flash.remove();
      };
      requestAnimationFrame(animate);
    }

    // Clear any pending restore
    if (this._restoreTimeoutId !== null) {
      globalThis.clearTimeout(this._restoreTimeoutId);
    }

    // Clear kills immediately so we need fresh 5 for next streak
    this._killTimestampsMs.length = 0;

    this._restoreTimeoutId = globalThis.setTimeout(() => {
      // Use removePriorityAndRestore to properly clean up even if higher
      // priority effects fired during the streak (prevents stuck slowmo)
      slomoManager.removePriorityAndRestore(world, SLOMO_PRIORITY.killStreak);
      this._isInStreak = false;
      this._restoreTimeoutId = null;
      this._lastStreakEndTimeMs = performance.now();
    }, SLOMO_DURATION_MS);
  }

  public reset(): void {
    if (this._restoreTimeoutId !== null) {
      globalThis.clearTimeout(this._restoreTimeoutId);
      this._restoreTimeoutId = null;
    }
    this._killTimestampsMs.length = 0;
    this._isInStreak = false;
  }
}

export const killStreakTracker = new KillStreakTracker();
