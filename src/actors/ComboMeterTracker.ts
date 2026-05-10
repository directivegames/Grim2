import * as ENGINE from '@gnsx/genesys.js';

const RESET_DELAY_MS = 3000; // ms of no kills before combo fades

/**
 * Singleton combo meter tracker.
 * Records kills and shows a "Nx COMBO" counter on screen (right side, under souls).
 * Fades after RESET_DELAY_MS of no kills.
 */
class ComboMeterTracker {
  private _count = 0;
  private _el: HTMLDivElement | null = null;
  private _resetId: ReturnType<typeof globalThis.setTimeout> | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  public recordKill(world: ENGINE.World): void {
    this._count++;
    this._ensureElement(world);
    this._updateDisplay();
    this._scheduleReset();
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

  private _ensureElement(world: ENGINE.World): void {
    if (this._el) return;
    const container = world.gameContainer;
    if (!container) return;

    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      'right:24px',
      'bottom:110px',
      'text-align:right',
      'font-family:"Arial Black",Arial,sans-serif',
      'pointer-events:none',
      'opacity:0',
      'transition:opacity 0.4s ease',
      'z-index:100',
    ].join(';');
    container.appendChild(el);
    this._el = el;
  }

  private _updateDisplay(): void {
    const el = this._el;
    if (!el || this._count < 2) return;

    const label = this._getComboLabel();
    const labelColor = this._count >= 10 ? '#ffffff' : '#ffcc44';
    const labelGlow = this._count >= 10 ? 'text-shadow:0 0 10px #ffcc44,0 0 22px #ff6600;' : '';

    el.innerHTML = [
      `<div id="combo-num" style="color:#ff6a00;font-size:32px;line-height:1;`,
      `text-shadow:0 0 8px #ff3300,0 0 18px #ff6600;`,
      `letter-spacing:1px;display:inline-block;">${this._count}x</div>`,
      `<div style="color:${labelColor};font-size:13px;letter-spacing:5px;`,
      `text-transform:uppercase;margin-top:2px;${labelGlow}">${label}</div>`,
    ].join('');

    el.style.opacity = '1';

    // Spring punch animation on the number
    const numEl = el.querySelector('#combo-num') as HTMLElement | null;
    if (numEl) {
      numEl.style.transition = 'none';
      numEl.style.transform = 'scale(1.6)';
      requestAnimationFrame(() => {
        numEl.style.transition = 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
        numEl.style.transform = 'scale(1)';
      });
    }
  }

  private _getComboLabel(): string {
    if (this._count >= 15) return 'GRIM REAPER';
    if (this._count >= 10) return 'SOUL STORM';
    if (this._count >= 5) return 'RAMPAGE';
    return 'COMBO';
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
    if (this._el) this._el.style.opacity = '0';
  }
}

export const comboMeterTracker = new ComboMeterTracker();
