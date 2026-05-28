/**
 * BossHealthBarUI — top-centre boss health bar for Postman boss fights.
 */
import * as ENGINE from '@gnsx/genesys.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class BossHealthBarUI {
  private static readonly instances = new Map<ENGINE.World, BossHealthBarUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _title: HTMLDivElement | null = null;
  private _barTrack: HTMLDivElement | null = null;
  private _barFill: HTMLDivElement | null = null;
  private _hpText: HTMLDivElement | null = null;
  private _visible = false;

  public static async getInstance(world: ENGINE.World | null): Promise<BossHealthBarUI> {
    if (!world) {
      return new BossHealthBarUI(null);
    }
    let inst = BossHealthBarUI.instances.get(world);
    if (!inst) {
      inst = new BossHealthBarUI(world);
      BossHealthBarUI.instances.set(world, inst);
      inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    BossHealthBarUI.instances.get(world)?.hide();
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
    this._container.setAttribute('data-boss-health-bar-ui', '');
    this._container.style.cssText = `
      position: absolute;
      top: clamp(20px, 4vh, 36px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 1006;
      pointer-events: none;
      display: none;
      opacity: 0;
      width: min(420px, 72vw);
      text-align: center;
      font-family: Montserrat, 'Segoe UI', sans-serif;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.85);
    `;

    this._title = document.createElement('div');
    this._title.textContent = 'THE POSTMAN';
    this._title.style.cssText = `
      font-size: clamp(12px, 1.4vw, 15px);
      color: #ffe8b0;
      margin-bottom: 8px;
    `;

    this._barTrack = document.createElement('div');
    this._barTrack.style.cssText = `
      width: 100%;
      height: clamp(14px, 2vh, 18px);
      border-radius: 4px;
      background: rgba(8, 6, 4, 0.88);
      border: 1px solid rgba(255, 200, 120, 0.45);
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    `;

    this._barFill = document.createElement('div');
    this._barFill.style.cssText = `
      width: 100%;
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, #8b2020 0%, #e04040 55%, #ff7070 100%);
      transform-origin: left center;
      transform: scaleX(1);
      transition: transform 0.2s ease-out;
    `;
    this._barTrack.appendChild(this._barFill);

    this._hpText = document.createElement('div');
    this._hpText.style.cssText = `
      margin-top: 6px;
      font-size: clamp(11px, 1.1vw, 13px);
      color: #e8e4dc;
      letter-spacing: 0.06em;
    `;

    this._container.appendChild(this._title);
    this._container.appendChild(this._barTrack);
    this._container.appendChild(this._hpText);
    gc.appendChild(this._container);
  }

  public show(): void {
    if (!this._container) return;
    this._visible = true;
    this._container.style.display = 'block';
    requestAnimationFrame(() => {
      if (this._container && this._visible) {
        this._container.style.transition = 'opacity 0.3s ease';
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
    }, 300);
  }

  public setHealth(current: number, max: number): void {
    const safeMax = Math.max(1, max);
    const clamped = Math.max(0, Math.min(current, safeMax));
    const ratio = clamped / safeMax;

    if (this._barFill) {
      this._barFill.style.transform = `scaleX(${ratio})`;
    }
    if (this._hpText) {
      this._hpText.textContent = `${Math.ceil(clamped)} / ${Math.ceil(safeMax)}`;
    }
  }
}
