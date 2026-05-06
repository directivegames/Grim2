import * as ENGINE from '@gnsx/genesys.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';

const KILL_WINDOW_SEC        = 1.0;   // kills within this window count toward streak
const STREAK_THRESHOLD       = 5;     // kills needed to trigger slow-mo
const SLOMO_VALUE            = 0.35;  // 35% speed during streak
const SLOMO_DURATION         = 0.5;   // how long slow-mo lasts
const SHAKE_INTENSITY        = 0.7;
const SHAKE_DURATION         = 0.6;
const POST_STREAK_COOLDOWN_MS = 7000; // real-time ms before streak can fire again

function setSlomo(world: ENGINE.World, value: number): void {
  (world as unknown as { slomo: number }).slomo = value;
}

/**
 * Singleton kill streak tracker.
 * Records zombie deaths and triggers slow-mo + screen flash + camera shake
 * when STREAK_THRESHOLD kills happen within KILL_WINDOW_SEC.
 */
class KillStreakTracker {
  private _killTimestamps: number[] = [];
  private _isInStreak = false;
  private _restoreTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private _lastStreakEndTime = -POST_STREAK_COOLDOWN_MS; // ready immediately at start

  public recordKill(world: ENGINE.World): void {
    const now = world.getGameTime();

    this._killTimestamps.push(now);

    // Flush kills outside the window
    const cutoff = now - KILL_WINDOW_SEC;
    while (this._killTimestamps.length > 0 && this._killTimestamps[0] < cutoff) {
      this._killTimestamps.shift();
    }

    if (this._killTimestamps.length >= STREAK_THRESHOLD && !this._isInStreak) {
      // Enforce post-streak cooldown using real time
      const nowReal = performance.now();
      if (nowReal - this._lastStreakEndTime >= POST_STREAK_COOLDOWN_MS) {
        this._triggerStreak(world);
      }
    }
  }

  private _triggerStreak(world: ENGINE.World): void {
    this._isInStreak = true;

    setSlomo(world, SLOMO_VALUE);

    const player = world.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(SHAKE_INTENSITY, SHAKE_DURATION);
    }

    // Screen flash
    const container = world.gameContainer;
    if (container) {
      const flash = document.createElement('div');
      flash.style.cssText = [
        'position:absolute',
        'inset:0',
        'background:radial-gradient(circle,rgba(255,180,0,0.45) 0%,transparent 70%)',
        'pointer-events:none',
        'opacity:1',
        'z-index:200',
      ].join(';');
      container.appendChild(flash);

      const startTime = performance.now();
      const animate = (): void => {
        const t = Math.min((performance.now() - startTime) / 600, 1);
        flash.style.opacity = String(1 - t);
        if (t < 1) requestAnimationFrame(animate);
        else flash.remove();
      };
      requestAnimationFrame(animate);
    }

    if (this._restoreTimeoutId !== null) {
      globalThis.clearTimeout(this._restoreTimeoutId);
    }

    this._restoreTimeoutId = globalThis.setTimeout(() => {
      setSlomo(world, 1);
      this._isInStreak = false;
      this._restoreTimeoutId = null;
      this._killTimestamps.length = 0;
      this._lastStreakEndTime = performance.now();
    }, SLOMO_DURATION * 1000);
  }

  public reset(): void {
    if (this._restoreTimeoutId !== null) {
      globalThis.clearTimeout(this._restoreTimeoutId);
      this._restoreTimeoutId = null;
    }
    this._killTimestamps.length = 0;
    this._isInStreak = false;
  }
}

export const killStreakTracker = new KillStreakTracker();
