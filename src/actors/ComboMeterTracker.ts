import * as ENGINE from '@gnsx/genesys.js';
import { ComboCounterUI } from '../ui/ComboCounterUI.js';
import { ComboMilestoneUI } from '../ui/ComboMilestoneUI.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';

const RESET_DELAY_SEC = 3.0;
const FADE_DELAY_SEC = 0.45;

/** Combo meter idle/fade timers use wall-clock time so UI doesn't stall during slomo. */
class ComboMeterTracker {
  private _count = 0;
  private _ui: ComboCounterUI | null = null;
  private _idleSec = 0;
  private _fadeSec = -1;

  public async recordKill(world: ENGINE.World): Promise<void> {
    this._count++;
    this._idleSec = 0;
    this._fadeSec = -1;
    await this._ensureUI(world);
    this._updateDisplay();
    ComboMilestoneUI.getInstance(world).checkAndTrigger(this._count);
  }

  /** Call each frame from player tick with scaled deltaTime. */
  public tick(world: ENGINE.World, deltaTime: number): void {
    if (this._count <= 0) return;
    const realDt = getUnscaledDeltaTime(world, deltaTime);

    if (this._fadeSec >= 0) {
      this._fadeSec += realDt;
      if (this._fadeSec >= FADE_DELAY_SEC) {
        this._count = 0;
        this._fadeSec = -1;
        this._idleSec = 0;
      }
      return;
    }

    this._idleSec += realDt;
    if (this._idleSec >= RESET_DELAY_SEC) {
      this._hide();
      this._fadeSec = 0;
    }
  }

  public reset(): void {
    this._count = 0;
    this._idleSec = 0;
    this._fadeSec = -1;
    this._hide();
  }

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

  private _hide(): void {
    this._ui?.hide();
  }
}

export const comboMeterTracker = new ComboMeterTracker();
