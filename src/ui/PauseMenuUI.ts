/**
 * PauseMenuUI — in-game pause overlay (RESUME / QUIT).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { withMenuSelectSound } from '../utils/menu-audio.js';
import { pauseGame, resumeGame } from '../utils/game-pause.js';
import { OptionsMenuUI } from './OptionsMenuUI.js';
import { returnToMap } from '../utils/return-to-map.js';
import {
  UI_MENU_PANEL,
  UI_OPTIONS_FRAME,
  applyBackgroundImageWhenReady,
  getCachedUiImageUrl,
  resolveAndCacheUiImage,
} from '../utils/ui-image-cache.js';

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

export class PauseMenuUI {
  private static readonly byWorld = new Map<ENGINE.World, PauseMenuUI>();

  private readonly _world: ENGINE.World;
  private _root: HTMLDivElement | null = null;
  private _mounting = false;
  private _panelUrl = '';

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static isOpen(world: ENGINE.World): boolean {
    const inst = PauseMenuUI.byWorld.get(world);
    return Boolean(inst?._root);
  }

  public static open(world: ENGINE.World): PauseMenuUI {
    const w = world as GameContainerWorld;
    if (!w.gameContainer || w.options?.headless) {
      return new PauseMenuUI(world);
    }

    let inst = PauseMenuUI.byWorld.get(world);
    if (inst?._root || inst?._mounting) {
      return inst ?? new PauseMenuUI(world);
    }

    if (!inst) {
      inst = new PauseMenuUI(world);
      PauseMenuUI.byWorld.set(world, inst);
    }

    void inst._mount();
    return inst;
  }

  public static close(world: ENGINE.World): void {
    const inst = PauseMenuUI.byWorld.get(world);
    inst?.close();
  }

  private _gameContainer(): HTMLElement | null {
    const w = this._world as GameContainerWorld;
    return w.gameContainer ?? null;
  }

  private _createMenuButton(
    label: string,
    onClick: () => void,
    highlight = false,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-grim-menu-panel-btn', '');
    wrap.style.cssText = `
      position: relative;
      width: min(300px, 78%);
      aspect-ratio: 3.4 / 1;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.2s ease;
    `;
    if (this._panelUrl) {
      wrap.style.backgroundImage = `url("${this._panelUrl}")`;
      wrap.style.backgroundSize = '100% auto';
      wrap.style.backgroundRepeat = 'no-repeat';
      wrap.style.backgroundPosition = 'center';
    }

    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: ${highlight ? 800 : 700};
      font-size: clamp(0.65rem, 1.7vw, 0.88rem);
      letter-spacing: 0.22em;
      color: ${highlight ? 'rgba(160, 245, 255, 0.98)' : 'rgba(220, 228, 236, 0.92)'};
      text-shadow: ${highlight
        ? '0 0 18px rgba(0, 220, 255, 0.55), 0 2px 4px rgba(0,0,0,0.95)'
        : '0 1px 3px rgba(0,0,0,0.95)'};
      pointer-events: none;
    `;
    wrap.appendChild(text);
    wrap.addEventListener('click', withMenuSelectSound(this._world, onClick));
    wrap.addEventListener('mouseenter', () => {
      wrap.style.transform = 'scale(1.03)';
      wrap.style.filter = 'brightness(1.06)';
    });
    wrap.addEventListener('mouseleave', () => {
      wrap.style.transform = 'scale(1)';
      wrap.style.filter = highlight ? 'none' : 'brightness(0.95)';
    });
    return wrap;
  }

  private _mount(): void {
    if (this._root || this._mounting) {
      return;
    }
    this._mounting = true;
    try {
      this._mountInner();
    } finally {
      this._mounting = false;
    }
  }

  private _mountInner(): void {
    const gameContainer = this._gameContainer();
    const w = this._world as GameContainerWorld;
    if (!gameContainer || w.options?.headless) {
      return;
    }

    this._panelUrl = getCachedUiImageUrl(UI_MENU_PANEL);

    const overlay = document.createElement('div');
    overlay.className = 'grim-pause-menu-root';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10060;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(5, 5, 8, 0.72);
      box-sizing: border-box;
      user-select: none;
      padding: clamp(16px, 3vh, 32px) clamp(12px, 3vw, 28px);
      overflow-y: auto;
    `;

    const stack = document.createElement('div');
    stack.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: min(480px, 90vw);
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: relative;
      width: 100%;
      box-sizing: border-box;
      background: #0d1117;
      border: 2px solid rgba(100, 160, 200, 0.25);
      border-radius: 6px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.65);
      padding: clamp(44px, 6.5vh, 52px) clamp(28px, 4.5vw, 40px) clamp(36px, 5vh, 44px);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: clamp(10px, 1.8vh, 14px);
    `;
    applyBackgroundImageWhenReady(panel, UI_OPTIONS_FRAME, {
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    });

    const title = document.createElement('h2');
    title.textContent = 'PAUSED';
    title.style.cssText = `
      margin: 0;
      text-align: center;
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(1.35rem, 3.2vw, 1.85rem);
      letter-spacing: 0.32em;
      color: rgba(200, 210, 220, 0.95);
      text-shadow:
        0 2px 0 rgba(0, 0, 0, 0.9),
        0 0 20px rgba(0, 220, 255, 0.25);
    `;

    const divider = document.createElement('div');
    divider.style.cssText = `
      width: min(220px, 70%);
      height: 1px;
      margin: 4px auto 8px;
      background: linear-gradient(90deg, transparent, rgba(120, 140, 160, 0.55), transparent);
      position: relative;
    `;
    const dividerSkull = document.createElement('span');
    dividerSkull.textContent = '☠';
    dividerSkull.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 0.55rem;
      color: rgba(160, 170, 180, 0.75);
      background: transparent;
      padding: 0 6px;
    `;
    divider.appendChild(dividerSkull);

    const buttonCol = document.createElement('div');
    buttonCol.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: clamp(8px, 1.4vh, 12px);
      width: 100%;
      margin-top: 4px;
    `;

    buttonCol.appendChild(
      this._createMenuButton('RESUME', () => this._onResume(), true),
    );
    buttonCol.appendChild(
      this._createMenuButton('OPTIONS', () => {
        this.close();
        OptionsMenuUI.open(this._world, () => {
          pauseGame(this._world);
          void PauseMenuUI.open(this._world);
        });
      }),
    );
    buttonCol.appendChild(
      this._createMenuButton('QUIT', () => this._onQuit()),
    );

    panel.appendChild(title);
    panel.appendChild(divider);
    panel.appendChild(buttonCol);
    stack.appendChild(panel);
    overlay.appendChild(stack);
    gameContainer.appendChild(overlay);

    this._root = overlay;

    void resolveAndCacheUiImage(UI_MENU_PANEL).then(url => {
      this._panelUrl = url;
      if (!this._root) {
        return;
      }
      this._root.querySelectorAll<HTMLElement>('[data-grim-menu-panel-btn]').forEach(btn => {
        if (url) {
          btn.style.backgroundImage = `url("${url}")`;
          btn.style.backgroundSize = '100% auto';
          btn.style.backgroundRepeat = 'no-repeat';
          btn.style.backgroundPosition = 'center';
        }
      });
    });
  }

  private _onResume(): void {
    this.close();
    resumeGame(this._world);
  }

  private _onQuit(): void {
    returnToMap(this._world);
  }

  public close(): void {
    if (this._root?.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    PauseMenuUI.byWorld.delete(this._world);
  }
}
