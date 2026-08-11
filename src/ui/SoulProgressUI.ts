/**
 * SoulProgressUI — mission goal: souls retrieved / required.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ensureMobileHudStyles, getMobileMissionColumn } from './mobile-hud-layout.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class SoulProgressUI {
  private static readonly instances = new Map<ENGINE.World, SoulProgressUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _line: HTMLDivElement | null = null;
  private _visible = false;
  private _stackBelowInnocents = false;

  private static readonly DESKTOP_TOP_PX = 48;
  private static readonly DESKTOP_STACKED_TOP_PX = 132;

  public static async getInstance(world: ENGINE.World | null): Promise<SoulProgressUI> {
    if (!world) {
      return new SoulProgressUI(null);
    }
    let inst = SoulProgressUI.instances.get(world);
    if (!inst) {
      inst = new SoulProgressUI(world);
      SoulProgressUI.instances.set(world, inst);
      inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    SoulProgressUI.instances.get(world)?.hide();
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
    this._container.setAttribute('data-soul-progress-ui', '');
    this._container.className = 'grim-hud-soul-progress grim-hud-mission-objective';
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
      letter-spacing: 0.06em;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9);
    `;

    this._line = document.createElement('div');
    this._line.style.fontSize = 'clamp(14px, 1.25vw, 20px)';
    this._container.appendChild(this._line);
    getMobileMissionColumn(gc).appendChild(this._container);
  }

  /** Stack under InnocentSaveProgressUI on reap-and-save missions. */
  public setStackBelowInnocents(enabled: boolean): void {
    this._stackBelowInnocents = enabled;
    if (!this._container) return;
    if (enabled) {
      this._container.setAttribute('data-stack-below-innocent', '');
      this._container.style.top = `${SoulProgressUI.DESKTOP_STACKED_TOP_PX}px`;
    } else {
      this._container.removeAttribute('data-stack-below-innocent');
      this._container.style.top = `${SoulProgressUI.DESKTOP_TOP_PX}px`;
    }
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

  public setProgress(collected: number, required: number, label = 'SOULS RETRIEVED'): void {
    if (!this._line) return;
    const title = document.createElement('span');
    title.style.color = '#e8e4dc';
    title.textContent = `${label}: `;
    const value = document.createElement('span');
    value.style.color = '#b8e0ff';
    value.textContent = String(Math.min(collected, required));
    const total = document.createElement('span');
    total.style.color = '#e8e4dc';
    total.textContent = ` / ${required}`;
    this._line.replaceChildren(title, value, total);
  }
}
