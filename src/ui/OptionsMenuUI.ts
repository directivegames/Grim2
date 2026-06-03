/**
 * OptionsMenuUI — main-menu options overlay (audio sliders + 360 spin toggle).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { grimVault } from '../game/GrimVault.js';
import { applyMusicVolumeToWorld } from '../utils/apply-music-volume.js';
import { GAME_SETTINGS_DEFAULTS, gameSettings } from '../utils/game-settings.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';
import {
  UI_MENU_PANEL,
  UI_OPTIONS_FRAME,
  UI_OPTIONS_LOGO,
  UI_OPTIONS_LOGO_ASPECT,
  applyBackgroundImageWhenReady,
  ensureUiImagesReady,
  getCachedUiImageUrl,
} from '../utils/ui-image-cache.js';

/** Reserved header width for Options.webp (1536×1024); height comes from aspect-ratio on the slot. */
const OPTIONS_LOGO_MAX_WIDTH_PX = 540;
const OPTIONS_PANEL_OVERLAP_PX = 18;

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

export class OptionsMenuUI {
  private static readonly byWorld = new Map<ENGINE.World, OptionsMenuUI>();

  private readonly _world: ENGINE.World;
  private _root: HTMLDivElement | null = null;
  private _mounting = false;
  private _onClose: (() => void) | null = null;

  private _sfxValueLabel: HTMLSpanElement | null = null;
  private _musicValueLabel: HTMLSpanElement | null = null;
  private _spinValueLabel: HTMLSpanElement | null = null;
  private _skipCutscenesValueLabel: HTMLSpanElement | null = null;

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static isOpen(world: ENGINE.World): boolean {
    const inst = OptionsMenuUI.byWorld.get(world);
    return Boolean(inst?._root);
  }

  public static close(world: ENGINE.World): void {
    OptionsMenuUI.byWorld.get(world)?.close();
  }

  public static open(world: ENGINE.World, onClose?: () => void): OptionsMenuUI {
    const w = world as GameContainerWorld;
    if (!w.gameContainer || w.options?.headless) {
      onClose?.();
      return new OptionsMenuUI(world);
    }

    let inst = OptionsMenuUI.byWorld.get(world);
    if (inst?._root || inst?._mounting) {
      return inst ?? new OptionsMenuUI(world);
    }

    if (!inst) {
      inst = new OptionsMenuUI(world);
      OptionsMenuUI.byWorld.set(world, inst);
    }

    inst._onClose = onClose ?? null;
    void inst._mount();
    return inst;
  }

  private _gameContainer(): HTMLElement | null {
    const w = this._world as GameContainerWorld;
    return w.gameContainer ?? null;
  }

  private _applySfxVolume(): void {
    try {
      getGameAudioManager(this._world).applySfxVolume(gameSettings.sfxVolume);
    } catch {
      /* audio may not be ready yet */
    }
  }

  private _applyMusicVolume(): void {
    applyMusicVolumeToWorld(this._world, gameSettings.musicVolume);
  }

  private _ensureStyles(container: HTMLElement): void {
    const styleId = 'grim-options-menu-styles';
    if (container.querySelector(`#${styleId}`)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .grim-options-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: rgba(0, 220, 255, 0.18);
        outline: none;
        cursor: pointer;
      }
      .grim-options-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: rgba(0, 220, 255, 0.95);
        box-shadow: 0 0 10px rgba(0, 220, 255, 0.55);
        border: 1px solid rgba(180, 245, 255, 0.9);
      }
      .grim-options-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: rgba(0, 220, 255, 0.95);
        box-shadow: 0 0 10px rgba(0, 220, 255, 0.55);
        border: 1px solid rgba(180, 245, 255, 0.9);
      }
      .grim-options-slider::-moz-range-track {
        height: 6px;
        border-radius: 999px;
        background: rgba(0, 220, 255, 0.18);
      }
    `;
    container.appendChild(style);
  }

  private _createSectionHeader(title: string): HTMLDivElement {
    const section = document.createElement('div');
    section.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 18px 0 10px;
    `;

    const line = () => {
      const el = document.createElement('div');
      el.style.cssText = `
        flex: 1;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(0, 220, 255, 0.35), transparent);
      `;
      return el;
    };

    const label = document.createElement('span');
    label.textContent = title;
    label.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.62rem, 1.4vw, 0.78rem);
      letter-spacing: 0.22em;
      color: rgba(0, 220, 255, 0.88);
      white-space: nowrap;
    `;

    section.appendChild(line());
    section.appendChild(label);
    section.appendChild(line());
    return section;
  }

  private _createSliderRow(
    labelText: string,
    initialValue: number,
    onChange: (value: number) => void,
  ): { row: HTMLDivElement; valueLabel: HTMLSpanElement } {
    const row = document.createElement('div');
    row.style.cssText = `
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(120px, 38%) auto;
      align-items: center;
      gap: clamp(8px, 1.5vw, 16px);
      margin-bottom: 12px;
    `;

    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.58rem, 1.25vw, 0.72rem);
      letter-spacing: 0.14em;
      color: rgba(220, 228, 236, 0.92);
    `;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(Math.round(initialValue * 100));
    slider.className = 'grim-options-slider';

    const valueLabel = document.createElement('span');
    valueLabel.textContent = `${Math.round(initialValue * 100)}%`;
    valueLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 600;
      font-size: clamp(0.58rem, 1.2vw, 0.72rem);
      letter-spacing: 0.08em;
      color: rgba(180, 190, 200, 0.88);
      min-width: 2.8em;
      text-align: right;
    `;

    slider.addEventListener('input', () => {
      const pct = Number(slider.value);
      valueLabel.textContent = `${pct}%`;
      onChange(pct / 100);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueLabel);
    return { row, valueLabel };
  }

  private _createToggleRow(
    labelText: string,
    initialValue: boolean,
    onChange: (value: boolean) => void,
  ): { row: HTMLDivElement; valueLabel: HTMLSpanElement } {
    const row = document.createElement('div');
    row.style.cssText = `
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: clamp(8px, 1.5vw, 16px);
      margin-bottom: 8px;
    `;

    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.58rem, 1.25vw, 0.72rem);
      letter-spacing: 0.14em;
      color: rgba(220, 228, 236, 0.92);
    `;

    const control = document.createElement('div');
    control.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const arrowStyle = `
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: Montserrat, system-ui, sans-serif;
      font-size: 0.75rem;
      color: rgba(180, 190, 200, 0.85);
      cursor: pointer;
      user-select: none;
      border: 1px solid rgba(120, 140, 160, 0.35);
      background: rgba(20, 24, 30, 0.85);
    `;

    const leftArrow = document.createElement('button');
    leftArrow.type = 'button';
    leftArrow.textContent = '◄';
    leftArrow.style.cssText = arrowStyle;

    const valueLabel = document.createElement('span');
    valueLabel.textContent = initialValue ? 'ON' : 'OFF';
    valueLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.58rem, 1.2vw, 0.72rem);
      letter-spacing: 0.16em;
      color: rgba(220, 228, 236, 0.95);
      min-width: 3.2em;
      text-align: center;
    `;

    const rightArrow = document.createElement('button');
    rightArrow.type = 'button';
    rightArrow.textContent = '►';
    rightArrow.style.cssText = arrowStyle;

    const setValue = (next: boolean) => {
      valueLabel.textContent = next ? 'ON' : 'OFF';
      onChange(next);
    };

    leftArrow.addEventListener('click', () => {
      playMenuSelectSound(this._world);
      setValue(false);
    });
    rightArrow.addEventListener('click', () => {
      playMenuSelectSound(this._world);
      setValue(true);
    });

    control.appendChild(leftArrow);
    control.appendChild(valueLabel);
    control.appendChild(rightArrow);
    row.appendChild(label);
    row.appendChild(control);
    return { row, valueLabel };
  }

  private async _mount(): Promise<void> {
    if (this._root || this._mounting) {
      return;
    }
    this._mounting = true;
    try {
      await this._mountInner();
    } finally {
      this._mounting = false;
    }
  }

  private async _mountInner(): Promise<void> {
    const gameContainer = this._gameContainer();
    const w = this._world as GameContainerWorld;
    if (!gameContainer || w.options?.headless) {
      return;
    }

    await ensureUiImagesReady([UI_OPTIONS_LOGO, UI_OPTIONS_FRAME, UI_MENU_PANEL]);

    this._ensureStyles(gameContainer);

    const logoUrl = getCachedUiImageUrl(UI_OPTIONS_LOGO);
    const frameUrl = getCachedUiImageUrl(UI_OPTIONS_FRAME);
    const menuPanelUrl = getCachedUiImageUrl(UI_MENU_PANEL);

    const overlay = document.createElement('div');
    overlay.className = 'grim-options-menu-root';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10065;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(5, 5, 8, 0.85);
      box-sizing: border-box;
      user-select: none;
      padding: clamp(16px, 3vh, 32px) clamp(12px, 3vw, 28px);
      overflow: auto;
    `;

    const menuStack = document.createElement('div');
    menuStack.style.cssText = `
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: min(560px, 94vw);
      flex-shrink: 0;
      margin: auto;
    `;

    const logoSlot = document.createElement('div');
    logoSlot.style.cssText = `
      position: relative;
      width: min(${OPTIONS_LOGO_MAX_WIDTH_PX}px, 98%);
      max-width: 100%;
      aspect-ratio: ${UI_OPTIONS_LOGO_ASPECT};
      flex-shrink: 0;
      margin: 0 auto;
      margin-bottom: -${OPTIONS_PANEL_OVERLAP_PX}px;
    `;

    if (logoUrl) {
      const titleImg = document.createElement('img');
      titleImg.src = logoUrl;
      titleImg.alt = 'Options';
      titleImg.draggable = false;
      titleImg.style.cssText = `
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center bottom;
        pointer-events: none;
        filter: drop-shadow(0 0 22px rgba(0, 220, 255, 0.4));
      `;
      logoSlot.appendChild(titleImg);
    }

    menuStack.appendChild(logoSlot);

    const panelFrameBg = frameUrl
      ? `
      background-image: url("${frameUrl}");
      background-size: 100% 100%;
      background-repeat: no-repeat;
      background-position: center;
    `
      : '';

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: relative;
      width: 100%;
      box-sizing: border-box;
      background: #0d1117;
      border: 2px solid rgba(100, 160, 200, 0.25);
      border-radius: 6px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.65);
      padding: clamp(48px, 7vh, 56px) clamp(32px, 5vw, 44px) clamp(40px, 5.5vh, 48px);
      display: flex;
      flex-direction: column;
      align-items: stretch;
      flex-shrink: 0;
      ${panelFrameBg}
    `;

    if (!frameUrl) {
      applyBackgroundImageWhenReady(panel, UI_OPTIONS_FRAME, {
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      });
    }

    const panelBtnBg = {
      backgroundSize: '100% auto',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
    } as const;

    const applyMenuPanelBtnBg = (el: HTMLElement): void => {
      if (menuPanelUrl) {
        el.style.backgroundImage = `url("${menuPanelUrl}")`;
        el.style.backgroundSize = panelBtnBg.backgroundSize;
        el.style.backgroundRepeat = panelBtnBg.backgroundRepeat;
        el.style.backgroundPosition = panelBtnBg.backgroundPosition;
        return;
      }
      applyBackgroundImageWhenReady(el, UI_MENU_PANEL, panelBtnBg);
    };

    panel.appendChild(this._createSectionHeader('AUDIO'));

    const sfxRow = this._createSliderRow('SFX VOLUME', gameSettings.sfxVolume, value => {
      gameSettings.sfxVolume = value;
      this._applySfxVolume();
    });
    this._sfxValueLabel = sfxRow.valueLabel;
    panel.appendChild(sfxRow.row);

    const musicRow = this._createSliderRow('MUSIC VOLUME', gameSettings.musicVolume, value => {
      gameSettings.musicVolume = value;
      this._applyMusicVolume();
    });
    this._musicValueLabel = musicRow.valueLabel;
    panel.appendChild(musicRow.row);

    panel.appendChild(this._createSectionHeader('GAMEPLAY'));

    const spinRow = this._createToggleRow('DISABLE 360 SPIN', gameSettings.disable360Spin, value => {
      gameSettings.disable360Spin = value;
    });
    this._spinValueLabel = spinRow.valueLabel;
    panel.appendChild(spinRow.row);

    const tutRow = this._createToggleRow(
      'ALWAYS SHOW TUTORIALS',
      gameSettings.alwaysShowTutorials,
      value => {
        gameSettings.alwaysShowTutorials = value;
      },
    );
    panel.appendChild(tutRow.row);

    const skipCutscenesRow = this._createToggleRow(
      'SKIP ALL CUTSCENES',
      gameSettings.skipAllCutscenes,
      value => {
        gameSettings.skipAllCutscenes = value;
      },
    );
    this._skipCutscenesValueLabel = skipCutscenesRow.valueLabel;
    panel.appendChild(skipCutscenesRow.row);

    panel.appendChild(this._createSectionHeader('DATA'));

    const resetWrap = document.createElement('div');
    resetWrap.style.cssText = `
      position: relative;
      width: min(280px, 72%);
      aspect-ratio: 3.4 / 1;
      margin: 8px auto 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.2s ease;
    `;
    applyMenuPanelBtnBg(resetWrap);
    const resetLabel = document.createElement('span');
    resetLabel.textContent = 'RESET ALL PROGRESS';
    resetLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(0.55rem, 1.4vw, 0.72rem);
      letter-spacing: 0.14em;
      color: rgba(255, 180, 160, 0.95);
      text-shadow: 0 1px 3px rgba(0,0,0,0.95);
      pointer-events: none;
      text-align: center;
    `;
    resetWrap.appendChild(resetLabel);
    resetWrap.addEventListener('click', () => {
      playMenuSelectSound(this._world);
      const ok = window.confirm(
        'Reset all progress? Souls, upgrades, items, risk unlocks, and the tutorial will be wiped. This cannot be undone.',
      );
      if (ok) {
        grimVault.resetAllProgress();
        gameSettings.resetToDefaults();
        window.location.reload();
      }
    });
    panel.appendChild(resetWrap);

    const backWrap = document.createElement('div');
    backWrap.style.cssText = `
      position: relative;
      width: min(280px, 72%);
      aspect-ratio: 3.4 / 1;
      margin: 22px auto 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.2s ease;
    `;
    applyMenuPanelBtnBg(backWrap);

    const backLabel = document.createElement('span');
    backLabel.textContent = 'BACK';
    backLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.62rem, 1.6vw, 0.82rem);
      letter-spacing: 0.24em;
      color: rgba(220, 228, 236, 0.92);
      text-shadow: 0 1px 3px rgba(0,0,0,0.95);
      pointer-events: none;
    `;
    backWrap.appendChild(backLabel);
    backWrap.addEventListener('click', () => {
      playMenuSelectSound(this._world);
      this.close();
    });
    backWrap.addEventListener('mouseenter', () => {
      backWrap.style.transform = 'scale(1.03)';
      backWrap.style.filter = 'brightness(1.05)';
    });
    backWrap.addEventListener('mouseleave', () => {
      backWrap.style.transform = 'scale(1)';
      backWrap.style.filter = 'none';
    });
    panel.appendChild(backWrap);

    const defaultsBtn = document.createElement('button');
    defaultsBtn.type = 'button';
    defaultsBtn.title = 'Defaults';
    defaultsBtn.style.cssText = `
      position: absolute;
      right: clamp(28px, 4.5vw, 40px);
      bottom: clamp(24px, 3.5vh, 32px);
      width: clamp(52px, 8vw, 64px);
      height: clamp(52px, 8vw, 64px);
      border: 1px solid rgba(120, 140, 160, 0.4);
      border-radius: 4px;
      background: rgba(18, 22, 28, 0.92);
      color: rgba(200, 210, 220, 0.9);
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: 0.45rem;
      letter-spacing: 0.08em;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
    `;
    defaultsBtn.innerHTML = `<span style="font-size:1rem;line-height:1;">📖</span><span>DEFAULTS</span>`;
    defaultsBtn.addEventListener('click', () => {
      playMenuSelectSound(this._world);
      this._resetDefaults();
    });
    panel.appendChild(defaultsBtn);

    menuStack.appendChild(panel);
    overlay.appendChild(menuStack);
    gameContainer.appendChild(overlay);

    this._root = overlay;
    this._applySfxVolume();
    this._applyMusicVolume();
  }

  private _resetDefaults(): void {
    gameSettings.resetToDefaults();
    this._applySfxVolume();
    this._applyMusicVolume();

    if (this._sfxValueLabel) {
      this._sfxValueLabel.textContent = `${Math.round(GAME_SETTINGS_DEFAULTS.sfxVolume * 100)}%`;
    }
    if (this._musicValueLabel) {
      this._musicValueLabel.textContent = `${Math.round(GAME_SETTINGS_DEFAULTS.musicVolume * 100)}%`;
    }
    if (this._spinValueLabel) {
      this._spinValueLabel.textContent = GAME_SETTINGS_DEFAULTS.disable360Spin ? 'ON' : 'OFF';
    }
    if (this._skipCutscenesValueLabel) {
      this._skipCutscenesValueLabel.textContent = GAME_SETTINGS_DEFAULTS.skipAllCutscenes
        ? 'ON'
        : 'OFF';
    }

    const sliders = this._root?.querySelectorAll<HTMLInputElement>('input[type="range"]');
    if (sliders?.[0]) {
      sliders[0].value = String(Math.round(GAME_SETTINGS_DEFAULTS.sfxVolume * 100));
    }
    if (sliders?.[1]) {
      sliders[1].value = String(Math.round(GAME_SETTINGS_DEFAULTS.musicVolume * 100));
    }
  }

  public close(): void {
    if (this._root?.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    OptionsMenuUI.byWorld.delete(this._world);
    const cb = this._onClose;
    this._onClose = null;
    cb?.();
  }
}
