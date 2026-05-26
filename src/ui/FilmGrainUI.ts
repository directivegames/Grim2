/**
 * Full-screen film grain overlay using a 6-frame horizontal sprite sheet
 * (assets/UI/noise.png). CSS steps() animation — no per-frame canvas work.
 */
import * as ENGINE from '@gnsx/genesys.js';

const NOISE_SPRITE_URL = '@project/assets/UI/noise.png';
const OVERLAY_ATTR = 'data-grim-film-grain';
const GRAIN_ANIM_STYLE_ID = 'grim-film-grain-keyframes';
const GRAIN_ANIM_NAME = 'grim-film-grain-shift';
const GRAIN_ANIM_DURATION_S = 0.6;
const SPRITE_FRAME_COUNT = 6;

export type FilmGrainSettings = {
  enabled: boolean;
  opacity: number;
  /** Scales tile size on screen (larger = finer / smaller tiles). */
  baseFrequency: number;
  /** Affects flicker speed when animated (higher = faster). */
  numOctaves: number;
  animated: boolean;
  blendMode: string;
};

export const DEFAULT_FILM_GRAIN_SETTINGS: FilmGrainSettings = {
  enabled: true,
  opacity: 0.10,
  baseFrequency: 0.65,
  numOctaves: 3,
  animated: true,
  blendMode: 'overlay',
};

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

export class FilmGrainUI {
  private static readonly byWorld = new Map<ENGINE.World, FilmGrainUI>();
  private static _spriteLoadPromise: Promise<{ url: string; frameWidth: number; frameHeight: number }> | null =
    null;

  private readonly _world: ENGINE.World;
  private _gameContainer: HTMLElement | null = null;
  private _overlay: HTMLDivElement | null = null;
  private _settings: FilmGrainSettings = { ...DEFAULT_FILM_GRAIN_SETTINGS };
  private _spriteUrl = '';
  private _frameWidth = 0;
  private _frameHeight = 0;
  private _styleKey = '';

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static attach(
    world: ENGINE.World,
    settings: Partial<FilmGrainSettings> = {},
  ): FilmGrainUI {
    let inst = FilmGrainUI.byWorld.get(world);
    if (!inst) {
      inst = new FilmGrainUI(world);
      FilmGrainUI.byWorld.set(world, inst);
    }
    inst._ensureDom();
    inst.applySettings(settings);
    return inst;
  }

  public static detach(world: ENGINE.World): void {
    const inst = FilmGrainUI.byWorld.get(world);
    inst?.dispose();
    FilmGrainUI.byWorld.delete(world);
  }

  public applySettings(partial: Partial<FilmGrainSettings> = {}): void {
    this._settings = { ...this._settings, ...partial };
    void this._syncDom();
  }

  public get isAttached(): boolean {
    return this._overlay !== null && this._spriteUrl.length > 0 && this._frameWidth > 0;
  }

  public dispose(): void {
    this._overlay?.remove();
    this._overlay = null;
    this._spriteUrl = '';
    this._frameWidth = 0;
    this._frameHeight = 0;
    this._styleKey = '';
    this._gameContainer = null;
  }

  private _ensureDom(): void {
    const w = this._world as GameContainerWorld;
    const gameContainer = w.gameContainer;
    if (!gameContainer || w.options?.headless) {
      return;
    }
    this._gameContainer = gameContainer;

    const existing = gameContainer.querySelector(`[${OVERLAY_ATTR}]`) as HTMLDivElement | null;
    if (existing) {
      this._overlay = existing;
      return;
    }

    const overlay = document.createElement('div');
    overlay.setAttribute(OVERLAY_ATTR, '');
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      user-select: none;
      z-index: 10040;
    `;

    gameContainer.appendChild(overlay);
    this._overlay = overlay;
  }

  private static _loadSpriteSheet(): Promise<{ url: string; frameWidth: number; frameHeight: number }> {
    if (FilmGrainUI._spriteLoadPromise) {
      return FilmGrainUI._spriteLoadPromise;
    }

    FilmGrainUI._spriteLoadPromise = (async () => {
      const resolved = await ENGINE.resolveAssetPathsInText(`url("${NOISE_SPRITE_URL}")`);
      const match = resolved.match(/url\("([^"]+)"\)/);
      const url = match?.[1] ?? '';
      if (!url) {
        throw new Error('FilmGrainUI: could not resolve noise sprite URL');
      }

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('FilmGrainUI: failed to load noise sprite'));
        img.src = url;
      });

      const frameWidth = Math.round(img.naturalWidth / SPRITE_FRAME_COUNT);
      const frameHeight = img.naturalHeight;
      if (frameWidth <= 0 || frameHeight <= 0) {
        throw new Error('FilmGrainUI: invalid noise sprite dimensions');
      }

      return { url, frameWidth, frameHeight };
    })();

    return FilmGrainUI._spriteLoadPromise;
  }

  private _displayScale(): number {
    const f = this._settings.baseFrequency;
    return Math.max(0.35, Math.min(2.2, 0.35 + f * 1.1));
  }

  private _animDurationS(): number {
    const octaves = Math.max(1, Math.min(5, Math.round(this._settings.numOctaves)));
    return GRAIN_ANIM_DURATION_S * (4 / octaves);
  }

  private async _syncDom(): Promise<void> {
    if (!this._overlay || !this._gameContainer) {
      return;
    }

    try {
      const sheet = await FilmGrainUI._loadSpriteSheet();
      this._spriteUrl = sheet.url;
      this._frameWidth = sheet.frameWidth;
      this._frameHeight = sheet.frameHeight;
    } catch {
      return;
    }

    const s = this._settings;
    const scale = this._displayScale();
    const tileW = Math.max(32, Math.round(this._frameWidth * scale));
    const tileH = Math.max(32, Math.round(this._frameHeight * scale));
    const shiftPx = (SPRITE_FRAME_COUNT - 1) * tileW;
    const styleKey = `${tileW}:${tileH}:${shiftPx}`;

    if (styleKey !== this._styleKey) {
      this._styleKey = styleKey;
      FilmGrainUI._injectKeyframes(this._gameContainer, shiftPx);
    }

    this._overlay.style.display = s.enabled ? 'block' : 'none';
    this._overlay.style.opacity = String(s.opacity);
    this._overlay.style.mixBlendMode = s.blendMode;
    this._overlay.style.backgroundImage = `url("${this._spriteUrl}")`;
    this._overlay.style.backgroundRepeat = 'repeat';
    this._overlay.style.backgroundSize = `${tileW}px ${tileH}px`;

    if (s.enabled && s.animated) {
      this._overlay.style.animation = `${GRAIN_ANIM_NAME} ${this._animDurationS()}s steps(${SPRITE_FRAME_COUNT}) infinite`;
      this._overlay.style.backgroundPosition = '0 0';
    } else {
      this._overlay.style.animation = 'none';
      this._overlay.style.backgroundPosition = '0 0';
    }
  }

  private static _injectKeyframes(container: HTMLElement, shiftPx: number): void {
    let style = container.querySelector(`#${GRAIN_ANIM_STYLE_ID}`) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = GRAIN_ANIM_STYLE_ID;
      container.appendChild(style);
    }

    style.textContent = `
      @keyframes ${GRAIN_ANIM_NAME} {
        from { background-position: 0 0; }
        to { background-position: -${shiftPx}px 0; }
      }
    `;
  }
}




