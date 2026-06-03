/**
 * InnocentSaveProgressUI — below collateral: souls saved vs required (deaths don't count).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ensureMobileHudStyles } from './mobile-hud-layout.js';

const MONTserrat_BOLD_URL =
  '@project/assets/UI/Bree_Serif,Montserrat/Montserrat/static/Montserrat-Bold.ttf';

const LABEL_COLOR = '#ffffff';
const SAVED_COLOR = '#7dffb8';
const REMAINING_COLOR = '#c8d4e0';
const TIMER_COLOR = '#ffb86c';
const TIMER_URGENT_COLOR = '#ff6b6b';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class InnocentSaveProgressUI {
  private static readonly instances = new Map<ENGINE.World, InnocentSaveProgressUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _mainLine: HTMLDivElement | null = null;
  private _timerLine: HTMLDivElement | null = null;
  private _remainLine: HTMLDivElement | null = null;
  private _visible = false;

  public static async getInstance(world: ENGINE.World | null): Promise<InnocentSaveProgressUI> {
    if (!world) {
      return new InnocentSaveProgressUI(null);
    }

    let inst = InnocentSaveProgressUI.instances.get(world);
    if (!inst) {
      inst = new InnocentSaveProgressUI(world);
      InnocentSaveProgressUI.instances.set(world, inst);
      await inst._ensureFont();
      inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    InnocentSaveProgressUI.instances.get(world)?.hide();
  }

  private constructor(world: ENGINE.World | null) {
    this._world = world;
  }

  private _gameContainer(): HTMLElement | null {
    if (!this._world) return null;
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private async _ensureFont(): Promise<void> {
    if (document.querySelector('style[data-font="MontserratBold"]')) {
      return;
    }

    const resolved = await ENGINE.resolveAssetPathsInText(`url("${MONTserrat_BOLD_URL}")`);
    const match = resolved.match(/url\(["']?([^"')]+)["']?\)/);
    const fontSrc = (match?.[1] ?? resolved).trim();
    if (!fontSrc || fontSrc.includes('@project')) {
      return;
    }

    const fontFace = document.createElement('style');
    fontFace.setAttribute('data-font', 'MontserratBold');
    fontFace.textContent = `
      @font-face {
        font-family: 'MontserratCollateral';
        src: url('${fontSrc}') format('truetype');
        font-weight: 700;
        font-style: normal;
      }
    `;
    document.head.appendChild(fontFace);
  }

  private _buildDom(): void {
    const gc = this._gameContainer();
    if (!gc || this._container) return;

    ensureMobileHudStyles(gc);

    this._container = document.createElement('div');
    this._container.setAttribute('data-innocent-save-progress', '');
    this._container.className = 'grim-hud-mission-objective';
    this._container.style.cssText = `
      position: absolute;
      top: 48px;
      right: 18px;
      z-index: 1005;
      pointer-events: none;
      user-select: none;
      display: none;
      opacity: 0;
      text-align: right;
      font-family: 'MontserratCollateral', 'Montserrat', 'Segoe UI', sans-serif;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      line-height: 1.35;
      text-shadow:
        0 1px 2px rgba(0, 0, 0, 0.9),
        0 2px 8px rgba(0, 0, 0, 0.65);
    `;

    this._mainLine = document.createElement('div');
    this._mainLine.style.fontSize = 'clamp(14px, 1.25vw, 20px)';

    this._timerLine = document.createElement('div');
    this._timerLine.style.fontSize = 'clamp(13px, 1.15vw, 18px)';
    this._timerLine.style.marginTop = '4px';

    this._remainLine = document.createElement('div');
    this._remainLine.style.fontSize = 'clamp(12px, 1.1vw, 17px)';
    this._remainLine.style.marginTop = '2px';

    this._container.append(this._mainLine, this._timerLine, this._remainLine);
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

  /** Countdown for the active innocent (hidden when none active). */
  public setSaveTimer(secondsRemaining: number, limitSec: number): void {
    if (!this._timerLine) return;

    if (secondsRemaining <= 0 || limitSec <= 0) {
      this._timerLine.style.display = 'none';
      return;
    }

    const secs = Math.ceil(secondsRemaining);
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    const timeText = mins > 0 ? `${mins}:${rem.toString().padStart(2, '0')}` : `${secs}`;

    const urgent = secondsRemaining <= 15;
    const color = urgent ? TIMER_URGENT_COLOR : TIMER_COLOR;

    this._timerLine.style.display = 'block';
    this._timerLine.innerHTML = `
      <span style="color:${LABEL_COLOR}">TIME TO SAVE: </span>
      <span style="color:${color}">${timeText}</span>
    `;
  }

  /** @param saved innocents successfully saved (deaths do not increment). */
  public setProgress(saved: number, required: number): void {
    if (!this._mainLine || !this._remainLine) return;

    const clampedSaved = Math.max(0, Math.min(saved, required));
    const remaining = Math.max(0, required - clampedSaved);

    this._mainLine.innerHTML = `
      <span style="color:${LABEL_COLOR}">SOULS SAVED: </span>
      <span style="color:${SAVED_COLOR}">${clampedSaved}</span>
      <span style="color:${LABEL_COLOR}"> / ${required}</span>
    `;

    if (remaining > 0) {
      this._remainLine.innerHTML = `
        <span style="color:${REMAINING_COLOR}">${remaining} remaining</span>
      `;
      this._remainLine.style.display = 'block';
    } else {
      this._remainLine.textContent = 'All souls saved';
      this._remainLine.style.color = SAVED_COLOR;
      this._remainLine.style.display = 'block';
    }
  }
}
