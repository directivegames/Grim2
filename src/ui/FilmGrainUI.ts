/**
 * Full-screen film grain overlay via tiled canvas noise (compositor-only, no render pipeline cost).
 */
import * as ENGINE from '@gnsx/genesys.js';

const OVERLAY_ATTR = 'data-grim-film-grain';
const TILE_SIZE = 128;

export type FilmGrainSettings = {
  enabled: boolean;
  opacity: number;
  baseFrequency: number;
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

  private readonly _world: ENGINE.World;
  private _gameContainer: HTMLElement | null = null;
  private _overlay: HTMLDivElement | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _imageData: ImageData | null = null;
  private _settings: FilmGrainSettings = { ...DEFAULT_FILM_GRAIN_SETTINGS };
  private _rafId: number | null = null;

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
    this._syncDom();
  }

  public get isAttached(): boolean {
    return this._overlay !== null && this._canvas !== null;
  }

  public dispose(): void {
    this._stopAnimation();
    this._overlay?.remove();
    this._overlay = null;
    this._canvas = null;
    this._ctx = null;
    this._imageData = null;
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
      this._canvas = existing.querySelector('canvas[data-grim-film-grain-canvas]');
      this._ctx = this._canvas?.getContext('2d') ?? null;
      if (this._ctx && this._canvas) {
        this._imageData = this._ctx.createImageData(this._canvas.width, this._canvas.height);
      }
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

    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-grim-film-grain-canvas', '');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    canvas.style.cssText = 'display:none;';

    overlay.appendChild(canvas);
    gameContainer.appendChild(overlay);

    this._overlay = overlay;
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._imageData = this._ctx?.createImageData(TILE_SIZE, TILE_SIZE) ?? null;
  }

  private _tileSizePx(): number {
    return Math.max(64, Math.round(180 * this._settings.baseFrequency));
  }

  private _syncDom(): void {
    if (!this._overlay || !this._canvas || !this._ctx || !this._imageData) {
      return;
    }

    const s = this._settings;
    this._overlay.style.display = s.enabled ? 'block' : 'none';
    this._overlay.style.opacity = String(s.opacity);
    this._overlay.style.mixBlendMode = s.blendMode;
    this._overlay.style.backgroundSize = `${this._tileSizePx()}px ${this._tileSizePx()}px`;

    this._fillNoise(s.baseFrequency, s.numOctaves);
    this._applyCanvasToBackground();

    if (s.enabled && s.animated) {
      this._startAnimation();
    } else {
      this._stopAnimation();
    }
  }

  private _applyCanvasToBackground(): void {
    if (!this._overlay || !this._canvas) {
      return;
    }
    this._overlay.style.backgroundImage = `url(${this._canvas.toDataURL()})`;
    this._overlay.style.backgroundRepeat = 'repeat';
  }

  private _fillNoise(baseFrequency: number, numOctaves: number): void {
    if (!this._ctx || !this._imageData) {
      return;
    }

    const data = this._imageData.data;
    const coarse = Math.max(1, Math.round((1.1 - baseFrequency) * 4));
    const detail = Math.max(1, Math.round(numOctaves));

    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const i = (y * TILE_SIZE + x) * 4;
        const cellX = Math.floor(x / coarse);
        const cellY = Math.floor(y / coarse);
        let value = this._hash(cellX, cellY);

        for (let o = 1; o < detail; o++) {
          const scale = 1 << o;
          value += this._hash(cellX * scale, cellY * scale) / (scale * 2);
        }

        value = Math.min(1, Math.max(0, value));
        const byte = Math.round(value * 255);
        data[i] = byte;
        data[i + 1] = byte;
        data[i + 2] = byte;
        data[i + 3] = 255;
      }
    }

    this._ctx.putImageData(this._imageData, 0, 0);
  }

  private _hash(x: number, y: number): number {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  private _startAnimation(): void {
    if (this._rafId !== null || typeof window === 'undefined') {
      return;
    }

    const tick = (): void => {
      if (this._settings.enabled && this._settings.animated && this._ctx && this._imageData) {
        const data = this._imageData.data;
        const swaps = Math.floor(data.length / 12);
        for (let n = 0; n < swaps; n++) {
          const i = (Math.floor(Math.random() * (data.length / 4)) * 4) | 0;
          const byte = Math.round(Math.random() * 255);
          data[i] = byte;
          data[i + 1] = byte;
          data[i + 2] = byte;
        }
        this._ctx.putImageData(this._imageData, 0, 0);
        this._applyCanvasToBackground();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  private _stopAnimation(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }
}
