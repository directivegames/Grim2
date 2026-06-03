/**
 * DamageProgressUI — mission goal: damage dealt before collateral max.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ensureMobileHudStyles } from './mobile-hud-layout.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class DamageProgressUI {
  private static readonly instances = new Map<ENGINE.World, DamageProgressUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _line: HTMLDivElement | null = null;
  private _visible = false;

  public static async getInstance(world: ENGINE.World | null): Promise<DamageProgressUI> {
    if (!world) {
      return new DamageProgressUI(null);
    }
    let inst = DamageProgressUI.instances.get(world);
    if (!inst) {
      inst = new DamageProgressUI(world);
      DamageProgressUI.instances.set(world, inst);
      inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    DamageProgressUI.instances.get(world)?.hide();
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
    if (!gc || this._container) return;

    ensureMobileHudStyles(gc);

    this._container = document.createElement('div');
    this._container.setAttribute('data-damage-progress-ui', '');
    this._container.className = 'grim-hud-mission-objective';
    this._container.style.cssText = `
      position: absolute;
      top: 48px;
      right: 18px;
      z-index: 1005;
      pointer-events: none;
      display: none;
      opacity: 0;
      text-align: right;
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9);
    `;

    this._line = document.createElement('div');
    this._line.style.fontSize = 'clamp(13px, 1.15vw, 18px)';
    this._container.appendChild(this._line);
    gc.appendChild(this._container);
  }

  public show(): void {
    if (!this._container) return;
    this._visible = true;
    this._container.style.display = 'block';
    requestAnimationFrame(() => {
      if (this._container && this._visible) {
        this._container.style.transition = 'opacity 0.25s ease';
        this._container.style.opacity = '1';
      }
    });
  }

  public hide(): void {
    this._visible = false;
    if (!this._container) return;
    this._container.style.opacity = '0';
    window.setTimeout(() => {
      if (this._container && !this._visible) {
        this._container.style.display = 'none';
      }
    }, 260);
  }

  public setProgress(dealt: number, required: number): void {
    if (!this._line) return;
    const clamped = Math.min(dealt, required);
    this._line.innerHTML = `
      <span style="color:#e8e4dc">DAMAGE: </span>
      <span style="color:#ffb86c">${clamped.toLocaleString()}</span>
      <span style="color:#e8e4dc"> / ${required.toLocaleString()}</span>
    `;
  }
}
