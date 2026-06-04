/**
 * CollateralDamageUI — top-right mission HUD: "COLLATERAL DAMAGE: NN%"
 * White label, red percentage, no background (matches design reference).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ensureMobileHudStyles, getMobileMissionColumn } from './mobile-hud-layout.js';
import { isMobileDevice } from '../utils/mobile-device.js';

const MONTserrat_BOLD_URL =
  '@project/assets/UI/Bree_Serif,Montserrat/Montserrat/static/Montserrat-Bold.ttf';

const LABEL_TEXT = 'COLLATERAL DAMAGE:';
const LABEL_COLOR = '#ffffff';
const VALUE_COLOR = '#ff2b2b';
const HIGH_COLLATERAL_THRESHOLD = 70;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class CollateralDamageUI {
  private static readonly instances = new Map<ENGINE.World, CollateralDamageUI>();

  private readonly _world: ENGINE.World | null;
  private _container: HTMLDivElement | null = null;
  private _valueEl: HTMLSpanElement | null = null;
  private _visible = false;

  public static async getInstance(world: ENGINE.World | null): Promise<CollateralDamageUI> {
    if (!world) {
      return new CollateralDamageUI(null);
    }

    let instance = CollateralDamageUI.instances.get(world);
    if (!instance) {
      instance = new CollateralDamageUI(world);
      CollateralDamageUI.instances.set(world, instance);
      await instance._ensureFont();
      instance._buildDom();
    }
    return instance;
  }

  public static hideForWorld(world: ENGINE.World): void {
    CollateralDamageUI.instances.get(world)?.hide();
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
    const gameContainer = this._gameContainer();
    if (!gameContainer || this._container) return;

    ensureMobileHudStyles(gameContainer);

    this._container = document.createElement('div');
    this._container.setAttribute('data-collateral-damage-ui', '');
    this._container.className = 'grim-hud-collateral';
    this._container.style.cssText = `
      position: absolute;
      top: 14px;
      right: 18px;
      z-index: 1005;
      pointer-events: none;
      user-select: none;
      display: none;
      opacity: 0;
      font-family: 'MontserratCollateral', 'Montserrat', 'Segoe UI', sans-serif;
      font-weight: 700;
      font-size: clamp(15px, 1.35vw, 22px);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      line-height: 1.15;
      text-shadow:
        0 1px 2px rgba(0, 0, 0, 0.9),
        0 2px 8px rgba(0, 0, 0, 0.65);
    `;

    const mobile = isMobileDevice();
    const label = document.createElement('span');
    label.textContent = mobile ? 'COLLATERAL: ' : `${LABEL_TEXT} `;
    label.style.color = LABEL_COLOR;

    this._valueEl = document.createElement('span');
    this._valueEl.style.color = VALUE_COLOR;
    this._valueEl.textContent = '0%';

    this._container.append(label, this._valueEl);
    getMobileMissionColumn(gameContainer).appendChild(this._container);
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

  public setPercent(percent: number): void {
    const clamped = Math.max(0, Math.min(100, percent));
    if (!this._valueEl) return;

    const rounded = Math.round(clamped);
    this._valueEl.textContent = `${rounded}%`;

    if (rounded >= HIGH_COLLATERAL_THRESHOLD) {
      this._valueEl.style.color = '#ff1a1a';
      this._valueEl.style.textShadow = '0 0 10px rgba(255, 40, 40, 0.85)';
    } else {
      this._valueEl.style.color = VALUE_COLOR;
      this._valueEl.style.textShadow = 'none';
    }
  }
}
