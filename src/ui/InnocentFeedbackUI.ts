/**
 * InnocentFeedbackUI — full-screen "SOUL SAVED" / "SOUL WASTED" flashes (~2s).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { injectBreeSerifFont } from './uiTypography.js';

const DISPLAY_MS = 2000;

const SAVED_COLOR = '#FFE082';
const SAVED_GLOW = '0 0 24px rgba(255, 200, 80, 0.95), 0 4px 12px rgba(0,0,0,0.9)';
const WASTED_COLOR = '#ff3a3a';
const WASTED_GLOW = '0 0 28px rgba(255, 40, 40, 0.95), 0 4px 14px rgba(0,0,0,0.95)';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class InnocentFeedbackUI {
  private static readonly instances = new Map<ENGINE.World, InnocentFeedbackUI>();

  private readonly _world: ENGINE.World | null;
  private _layer: HTMLDivElement | null = null;
  private _busy = false;

  public static async getInstance(world: ENGINE.World | null): Promise<InnocentFeedbackUI> {
    if (!world) {
      return new InnocentFeedbackUI(null);
    }

    let inst = InnocentFeedbackUI.instances.get(world);
    if (!inst) {
      inst = new InnocentFeedbackUI(world);
      InnocentFeedbackUI.instances.set(world, inst);
      await injectBreeSerifFont();
      inst._buildDom();
      InnocentFeedbackUI._injectStyles(inst._gameContainer());
    }
    return inst;
  }

  private constructor(world: ENGINE.World | null) {
    this._world = world;
  }

  private _gameContainer(): HTMLElement | null {
    if (!this._world) return null;
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private _buildDom(): void {
    const gc = this._gameContainer();
    if (!gc || this._layer) return;

    this._layer = document.createElement('div');
    this._layer.setAttribute('data-innocent-feedback', '');
    this._layer.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10120;
      pointer-events: none;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    gc.appendChild(this._layer);
  }

  public showSoulSaved(): void {
    void this._showMessage('SOUL SAVED', 'saved');
  }

  /** Shows wasted flash; calls `onComplete` after the display duration. */
  public showSoulWasted(onComplete?: () => void): void {
    const world = this._world;
    if (world) {
      const pawn = world.getFirstPlayerPawn();
      if (pawn instanceof IsometricPlayerPawn) {
        pawn.triggerScreenShake(0.35, 0.28);
      }
    }
    void this._showMessage('SOUL WASTED', 'wasted', onComplete);
  }

  private async _showMessage(
    text: string,
    kind: 'saved' | 'wasted',
    onComplete?: () => void,
  ): Promise<void> {
    if (!this._layer || this._busy) {
      onComplete?.();
      return;
    }

    this._busy = true;

    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(36px, 6vw, 72px);
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: ${kind === 'saved' ? SAVED_COLOR : WASTED_COLOR};
      text-shadow: ${kind === 'saved' ? SAVED_GLOW : WASTED_GLOW};
      -webkit-text-stroke: 2px ${kind === 'saved' ? '#5c3a00' : '#4a0000'};
      paint-order: stroke fill;
      opacity: 0;
      transform: translateY(40px) scale(0.85);
      will-change: transform, opacity;
    `;

    this._layer.appendChild(el);

    const anim = el.animate(
      kind === 'saved'
        ? [
            { opacity: 0, transform: 'translateY(48px) scale(0.8)' },
            { opacity: 1, transform: 'translateY(-8px) scale(1.05)', offset: 0.2 },
            { opacity: 1, transform: 'translateY(-18px) scale(1)', offset: 0.55 },
            { opacity: 0, transform: 'translateY(-36px) scale(0.98)' },
          ]
        : [
            { opacity: 0, transform: 'translateY(20px) scale(1.15)' },
            { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.12 },
            { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.65 },
            { opacity: 0, transform: 'translateY(-8px) scale(0.95)' },
          ],
      { duration: DISPLAY_MS, easing: 'ease-out', fill: 'forwards' },
    );

    await anim.finished.catch(() => undefined);
    el.remove();
    this._busy = false;
    onComplete?.();
  }

  private static _injectStyles(container: HTMLElement | null): void {
    if (!container || container.querySelector('#grim-innocent-feedback-styles')) return;

    const st = document.createElement('style');
    st.id = 'grim-innocent-feedback-styles';
    st.textContent = `
      @keyframes grim-soul-wasted-shake {
        0%, 100% { transform: translateX(0); }
        20% { transform: translateX(-6px); }
        40% { transform: translateX(7px); }
        60% { transform: translateX(-5px); }
        80% { transform: translateX(4px); }
      }
      [data-innocent-feedback].grim-wasted-shake {
        animation: grim-soul-wasted-shake 0.28s ease-out;
      }
    `;
    container.appendChild(st);
  }
}
