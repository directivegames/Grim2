import * as ENGINE from '@gnsx/genesys.js';

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Read current world slomo scale (1 = normal, 0 = paused). */
export function getWorldSlomo(world: ENGINE.World): number {
  const slomo = (world as unknown as { slomo?: number }).slomo ?? 1;
  return slomo > 0 ? slomo : 1;
}

/**
 * Convert a tick deltaTime (scaled by world.slomo) back to real wall-clock seconds.
 *
 * Use for any timer that must expire in real time while slomo is active:
 * UI fades, streak windows, sound durations, post-hit lockouts.
 */
export function getUnscaledDeltaTime(world: ENGINE.World, scaledDeltaTime: number): number {
  return scaledDeltaTime / getWorldSlomo(world);
}

// ── SlomoManager ──────────────────────────────────────────────────────────────

/**
 * Priority-stacked slow-motion manager.
 *
 * Higher-priority sources can override lower-priority ones.
 * When a source ends, the previous slomo value is restored automatically.
 *
 * Define your own priority constants in your project (higher = higher priority):
 *   const SLOMO_PRIORITY = { normal: 0, comboEffect: 1, hitStop: 2, cutscene: 3 } as const;
 */
class SlomoManager {
  private _priority = 0;
  private _stack: Array<{ priority: number; value: number }> = [];

  get priority(): number { return this._priority; }

  /**
   * Apply slow motion at the given priority level.
   * Does nothing and returns false if a higher-priority source is already active.
   */
  setSlomo(world: ENGINE.World, value: number, newPriority: number): boolean {
    if (newPriority <= this._priority) return false;

    this._stack.push({
      priority: this._priority,
      value: (world as unknown as { slomo: number }).slomo ?? 1,
    });

    (world as unknown as { slomo: number }).slomo = value;
    this._priority = newPriority;
    return true;
  }

  /**
   * Restore the previous slomo value, but only if current priority matches expectedPriority.
   * Use when you know you are the current owner.
   */
  resetIfPriority(world: ENGINE.World, expectedPriority: number): void {
    if (this._priority !== expectedPriority) return;

    const prev = this._stack.pop();
    if (prev) {
      this._priority = prev.priority;
      (world as unknown as { slomo: number }).slomo = prev.value;
    } else {
      this._priority = 0;
      (world as unknown as { slomo: number }).slomo = 1;
    }
  }

  /**
   * Remove a specific priority from the stack and restore the value below it.
   * Safe to call even when priorityToRemove is not currently active.
   */
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
      this._priority = 0;
      (world as unknown as { slomo: number }).slomo = 1;
    }
  }

  /**
   * Hard reset — clears all stack state and sets slomo to 1.
   * Call during world teardown, mission reset, or game over.
   */
  forceReset(world: ENGINE.World): void {
    this._priority = 0;
    this._stack = [];
    (world as unknown as { slomo: number }).slomo = 1;
  }
}

export const slomoManager = new SlomoManager();
