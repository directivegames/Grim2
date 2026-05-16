/**
 * ComboCounterUI - Displays the current combo count.
 *
 * Positioned middle-right of screen. Shows number with "x" suffix.
 * Background shakes slightly when combo increments.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { injectBreeSerifFont, sunsetNumberTextCss } from './uiTypography.js';

const BG_URL = '@project/assets/UI/ComboBG 1.png';

const UI_SCALE = 0.35;
const BG_WIDTH = 512;
const BG_HEIGHT = 512;

export class ComboCounterUI {
  private static _instance: ComboCounterUI | null = null;

  private _world: ENGINE.World | null = null;
  private _gameContainer: HTMLElement | null = null;
  private _container: HTMLDivElement | null = null;
  private _bgElement: HTMLDivElement | null = null;
  private _countDisplay: HTMLSpanElement | null = null;
  private _currentCount = 0;
  private _shakeAnimation: Animation | null = null;
  private _isVisible = false;

  public static async getInstance(world: ENGINE.World | null): Promise<ComboCounterUI> {
    if (!ComboCounterUI._instance) {
      ComboCounterUI._instance = new ComboCounterUI(world);
      await ComboCounterUI._instance._initializeAsync();
    }
    return ComboCounterUI._instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;
    this._world = world;
    this._gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer ?? null;
  }

  private async _initializeAsync(): Promise<void> {
    if (!this._gameContainer) return;

    injectBreeSerifFont();

    // Resolve background URL
    const css = `.bg { background-image: url("${BG_URL}"); }`;
    const resolved = await ENGINE.resolveAssetPathsInText(css);
    const match = resolved.match(/url\("([^"]+)"\)/);
    const bgUrl = match ? match[1] : '';

    // Container
    this._container = document.createElement('div');
    this._container.style.cssText = `
      position: absolute;
      right: ${20 * UI_SCALE}px;
      top: 50%;
      transform: translateY(-50%);
      width: ${BG_WIDTH * UI_SCALE}px;
      height: ${BG_HEIGHT * UI_SCALE}px;
      pointer-events: none;
      user-select: none;
      z-index: 1200;
      will-change: transform, opacity;
      display: none;
      align-items: center;
      justify-content: center;
    `;

    // Background
    this._bgElement = document.createElement('div');
    this._bgElement.style.cssText = `
      position: absolute;
      inset: 0;
      background-image: url("${bgUrl}");
      background-size: 100% 100%;
      background-repeat: no-repeat;
      will-change: transform;
    `;

    // Count display
    this._countDisplay = document.createElement('span');
    this._countDisplay.style.cssText = `
      position: relative;
      ${sunsetNumberTextCss(80 * UI_SCALE)}
      z-index: 1;
    `;
    this._countDisplay.textContent = '0x';

    this._container.appendChild(this._bgElement);
    this._container.appendChild(this._countDisplay);
    this._gameContainer.appendChild(this._container);
  }

  public setCount(count: number): void {
    this._currentCount = count;
    if (this._countDisplay) {
      this._countDisplay.textContent = `${count}x`;
    }
  }

  public show(): void {
    if (!this._container || this._isVisible) return;
    this._isVisible = true;
    this._container.style.display = 'flex';
    this._container.animate([
      { opacity: 0, transform: 'translateY(-50%) scale(0.5)', filter: 'brightness(1.8)' },
      { opacity: 1, transform: 'translateY(-50%) scale(1.25)', filter: 'brightness(1.2)', offset: 0.55 },
      { opacity: 1, transform: 'translateY(-50%) scale(1)', filter: 'brightness(1)' },
    ], {
      duration: 320,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      fill: 'forwards',
    });
  }

  public hide(): void {
    if (!this._container || !this._isVisible) return;
    this._container.animate([
      { opacity: 1, transform: 'translateY(-50%) scale(1)' },
      { opacity: 0, transform: 'translateY(-50%) scale(0.8)' },
    ], {
      duration: 300,
      easing: 'ease-in',
      fill: 'forwards',
    }).onfinish = () => {
      if (this._container) {
        this._container.style.display = 'none';
        this._isVisible = false;
      }
    };
  }

  public punch(): void {
    if (!this._countDisplay || !this._bgElement) return;

    // Number scale punch
    this._countDisplay.animate([
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.45)', filter: 'brightness(1.4)' },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], {
      duration: 220,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });

    // Background shake
    this._shakeAnimation?.cancel();
    this._shakeAnimation = this._bgElement.animate([
      { transform: 'translate(0, 0)' },
      { transform: 'translate(-3px, 2px)' },
      { transform: 'translate(3px, -2px)' },
      { transform: 'translate(-2px, -3px)' },
      { transform: 'translate(2px, 3px)' },
      { transform: 'translate(0, 0)' },
    ], {
      duration: 250,
      easing: 'ease-in-out',
    });
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    this._bgElement = null;
    this._countDisplay = null;
    ComboCounterUI._instance = null;
  }
}
