/**
 * CollateralWarningUI — "+20% COLLATERAL" punch-in after SOUL WASTED (~1.5s).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { injectBreeSerifFont } from './uiTypography.js';

const DISPLAY_MS = 1500;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class CollateralWarningUI {
  private static readonly instances = new Map<ENGINE.World, CollateralWarningUI>();

  private readonly _world: ENGINE.World | null;
  private _layer: HTMLDivElement | null = null;
  private _busy = false;

  public static async getInstance(world: ENGINE.World | null): Promise<CollateralWarningUI> {
    if (!world) {
      return new CollateralWarningUI(null);
    }

    let inst = CollateralWarningUI.instances.get(world);
    if (!inst) {
      inst = new CollateralWarningUI(world);
      CollateralWarningUI.instances.set(world, inst);
      await injectBreeSerifFont();
      inst._buildDom();
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
    this._layer.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10115;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
      padding-top: 12vh;
    `;
    gc.appendChild(this._layer);
  }

  public showCollateralJump(jumpPercent: number): void {
    void this._show(`+${Math.round(jumpPercent)}% COLLATERAL`);
  }

  private async _show(text: string): Promise<void> {
    if (!this._layer || this._busy) return;
    this._busy = true;

    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `
      font-family: 'BreeSerif', Georgia, serif;
      font-size: clamp(28px, 4.5vw, 52px);
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #ff2b2b;
      text-shadow:
        0 0 20px rgba(255, 40, 40, 0.9),
        0 3px 10px rgba(0, 0, 0, 0.9);
      -webkit-text-stroke: 2px #4a0000;
      paint-order: stroke fill;
      opacity: 0;
      transform: scale(0.4);
      will-change: transform, opacity;
    `;

    this._layer.appendChild(el);

    const anim = el.animate(
      [
        { opacity: 0, transform: 'scale(0.35)' },
        { opacity: 1, transform: 'scale(1.12)', offset: 0.18 },
        { opacity: 1, transform: 'scale(1)', offset: 0.45 },
        { opacity: 0, transform: 'scale(1.02)' },
      ],
      { duration: DISPLAY_MS, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)', fill: 'forwards' },
    );

    await anim.finished.catch(() => undefined);
    el.remove();
    this._busy = false;
  }
}
