import * as ENGINE from '@gnsx/genesys.js';
import { ComboCounterUI } from '../ui/ComboCounterUI.js';
import { ComboMilestoneUI } from '../ui/ComboMilestoneUI.js';

const RESET_DELAY_MS = 3000; // ms of no kills before combo fades

/**
 * Singleton combo meter tracker.
 * Records kills and shows a combo counter with image background (right side, vertically centered).
 * Fades after RESET_DELAY_MS of no kills.
 */
class ComboMeterTracker {
  private _count = 0;
  private _ui: ComboCounterUI | null = null;
  private _resetId: ReturnType<typeof globalThis.setTimeout> | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  public async recordKill(world: ENGINE.World): Promise<void> {
    this._count++;
    await this._ensureUI(world);
    this._updateDisplay();
    this._scheduleReset();

    // Check for milestone
    ComboMilestoneUI.getInstance(world).checkAndTrigger(this._count);
  }

  public reset(): void {
    if (this._resetId !== null) {
      globalThis.clearTimeout(this._resetId);
      this._resetId = null;
    }
    this._count = 0;
    this._hide();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _ensureUI(world: ENGINE.World): Promise<void> {
    if (this._ui) return;
    this._ui = await ComboCounterUI.getInstance(world);
  }

  private _updateDisplay(): void {
    if (!this._ui || this._count < 2) return;

    this._ui.setCount(this._count);
    this._ui.show();
    this._ui.punch();
  }

  private _scheduleReset(): void {
    if (this._resetId !== null) globalThis.clearTimeout(this._resetId);

    this._resetId = globalThis.setTimeout(() => {
      this._hide();
      // Delay actual count reset until fade finishes
      globalThis.setTimeout(() => {
        this._count = 0;
        this._resetId = null;
      }, 450);
    }, RESET_DELAY_MS);
  }

  private _hide(): void {
    this._ui?.hide();
  }
}

export const comboMeterTracker = new ComboMeterTracker();
