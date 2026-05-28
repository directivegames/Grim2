/**
 * SurviveTimerUI — countdown for Survive and Speed Reap missions.
 */
import * as ENGINE from '@gnsx/genesys.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class SurviveTimerUI {
  private static readonly instances = new Map<ENGINE.World, SurviveTimerUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _line: HTMLDivElement | null = null;
  private _visible = false;

  public static async getInstance(world: ENGINE.World | null): Promise<SurviveTimerUI> {
    if (!world) {
      return new SurviveTimerUI(null);
    }
    let inst = SurviveTimerUI.instances.get(world);
    if (!inst) {
      inst = new SurviveTimerUI(world);
      SurviveTimerUI.instances.set(world, inst);
      inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    SurviveTimerUI.instances.get(world)?.hide();
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

    this._container = document.createElement('div');
    this._container.setAttribute('data-survive-timer-ui', '');
    this._container.style.cssText = `
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1006;
      pointer-events: none;
      display: none;
      opacity: 0;
      text-align: center;
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-shadow: 0 2px 8px rgba(0,0,0,0.85);
    `;

    this._line = document.createElement('div');
    this._line.style.fontSize = 'clamp(18px, 2.2vw, 28px)';
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

  public setTimer(remainingSec: number, totalSec: number, label = 'SURVIVE'): void {
    if (!this._line) return;
    const secs = Math.max(0, Math.ceil(remainingSec));
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    const timeText = mins > 0 ? `${mins}:${rem.toString().padStart(2, '0')}` : `${secs}`;
    const urgent = remainingSec <= 15 && totalSec > 15;
    const color = urgent ? '#ff6b6b' : '#a8f0ff';
    this._line.innerHTML = `
      <span style="color:#e8e4dc">${label}: </span>
      <span style="color:${color}">${timeText}</span>
    `;
  }
}
