/**
 * FloatingDamageNumbers — pooled HTML overlay for floating hit indicators.
 *
 * Numbers appear at a 3D world position, animate upward with an elastic punch, and fade out.
 * Uses object pooling to avoid per-hit DOM allocation.
 *
 * Adaptation required:
 *  - Pass backgroundImageUrl to show a sprite behind each number (optional).
 *  - Pass textCss to override the number font/colour/size.
 *  - Call tick() each frame and destroy() on teardown.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const BG_SIZE = 512;
const UI_SCALE = 0.15;
const HIT_DURATION_MS = 1000;

export interface FloatingDamageNumbersOptions {
  /** URL for the sprite rendered behind each number. Supports @project/@engine paths. Null = text only. */
  backgroundImageUrl?: string | null;
  /** Number of pooled elements (default 15). Fixed at construction. */
  poolSize?: number;
  /** Full CSS string for the number span. Must include position:absolute, top/left 50%, and transform translate(-50%,-50%). */
  textCss?: string;
}

function defaultTextCss(fontSizePx: number): string {
  return `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: Arial, sans-serif;
    font-size: ${fontSizePx}px;
    font-weight: 900;
    color: #ffffff;
    -webkit-text-stroke: 1.5px #000000;
    paint-order: stroke fill;
    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    will-change: transform, text-shadow, opacity;
  `.replace(/\s+/g, ' ').trim();
}

interface PooledElement {
  container: HTMLDivElement;
  number: HTMLSpanElement;
  inUse: boolean;
}

interface ActiveHitNumber {
  element: PooledElement;
  startTime: number;
  duration: number;
}

export class FloatingDamageNumbers {
  private _world: ENGINE.World | null = null;
  private _gameContainer: HTMLElement | null = null;
  private _pool: PooledElement[] = [];
  private _active: ActiveHitNumber[] = [];
  private _initialized = false;
  private _resolvedBgUrl: string | null = null;
  private readonly _textCss: string;
  private readonly _scratchPos = new THREE.Vector3();

  constructor(
    world: ENGINE.World | null,
    gameContainer: HTMLElement | null,
    options?: FloatingDamageNumbersOptions,
  ) {
    if (!world || !gameContainer) return;

    this._world = world;
    this._gameContainer = gameContainer;
    this._textCss = options?.textCss ?? defaultTextCss(80 * UI_SCALE);

    if (options?.backgroundImageUrl) {
      void this._resolveUrl(options.backgroundImageUrl);
    }

    this._initPool(options?.poolSize ?? 15);
    this._initialized = true;
  }

  private async _resolveUrl(url: string): Promise<void> {
    if (!url.includes('@')) {
      this._resolvedBgUrl = url;
      return;
    }
    const cssString = `.bg { background-image: url("${url}"); }`;
    const resolvedCss = await ENGINE.resolveAssetPathsInText(cssString);
    const match = resolvedCss.match(/url\("([^"]+)"\)/);
    if (match?.[1]) {
      this._resolvedBgUrl = match[1];
    }
  }

  private _initPool(size: number): void {
    for (let i = 0; i < size; i++) {
      const container = document.createElement('div');
      container.style.cssText = `
        position: absolute;
        width: ${BG_SIZE * UI_SCALE}px;
        height: ${BG_SIZE * UI_SCALE}px;
        pointer-events: none;
        user-select: none;
        z-index: 1500;
        opacity: 0;
        background-size: 100% 100%;
        background-repeat: no-repeat;
        will-change: transform, opacity;
        display: none;
      `.replace(/\s+/g, ' ').trim();

      const number = document.createElement('span');
      number.style.cssText = this._textCss;

      container.appendChild(number);
      this._gameContainer!.appendChild(container);
      this._pool.push({ container, number, inUse: false });
    }
  }

  /** Show a damage number at the given world position. */
  public showDamage(damage: number, worldPos: THREE.Vector3): void {
    if (!this._initialized || !this._world || !this._gameContainer) return;

    const element = this._acquire();
    if (!element) return;

    element.number.textContent = Math.round(damage).toString();

    if (this._resolvedBgUrl) {
      element.container.style.backgroundImage = `url("${this._resolvedBgUrl}")`;
    }

    this._projectToScreen(element.container, worldPos);
    element.container.style.display = 'block';
    element.inUse = true;

    this._active.push({
      element,
      startTime: performance.now(),
      duration: HIT_DURATION_MS,
    });

    const anim = element.container.animate([
      {
        transform: 'translate(-50%, -50%) scale(0.35, 1.7) translateY(4px)',
        opacity: 0,
      },
      {
        transform: 'translate(-50%, -50%) scale(1.55, 0.88) translateY(-6px)',
        opacity: 1,
        offset: 0.12,
      },
      {
        transform: 'translate(-50%, -50%) scale(1.12, 1.06) translateY(-14px)',
        opacity: 1,
        offset: 0.28,
      },
      {
        transform: 'translate(-50%, -50%) scale(1, 1) translateY(-28px)',
        opacity: 1,
        offset: 0.45,
      },
      {
        transform: 'translate(-50%, -50%) scale(0.95, 1) translateY(-70px)',
        opacity: 0,
      },
    ], {
      duration: HIT_DURATION_MS,
      easing: 'cubic-bezier(0.22, 1.15, 0.36, 1)',
      fill: 'forwards',
    });

    anim.onfinish = () => {
      this._release(element);
      const idx = this._active.findIndex(a => a.element === element);
      if (idx !== -1) this._active.splice(idx, 1);
    };
  }

  /**
   * Call each frame. Cleans up elements whose animation finished late or was cancelled.
   * Required when hits can burst faster than the pool can recycle via onfinish alone.
   */
  public tick(): void {
    if (this._active.length === 0) return;

    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < this._active.length; i++) {
      const hit = this._active[i]!;
      if (now - hit.startTime > hit.duration + 200) {
        this._release(hit.element);
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      this._active.splice(toRemove[i]!, 1);
    }
  }

  /** Remove all DOM elements. Call on mission end or world teardown. */
  public destroy(): void {
    for (const el of this._pool) {
      el.container.remove();
    }
    this._pool = [];
    this._active = [];
    this._gameContainer = null;
  }

  private _acquire(): PooledElement | null {
    for (const el of this._pool) {
      if (!el.inUse) return el;
    }
    // Pool exhausted — recycle the oldest active element
    if (this._active.length > 0) {
      const oldest = this._active.shift()!;
      this._release(oldest.element);
      return oldest.element;
    }
    return null;
  }

  private _release(element: PooledElement): void {
    element.inUse = false;
    element.container.style.display = 'none';
    element.container.style.opacity = '0';
  }

  private _projectToScreen(container: HTMLDivElement, worldPos: THREE.Vector3): void {
    if (!this._world) return;

    const camera = this._world.getActiveCamera();
    if (!camera) return;

    this._scratchPos.copy(worldPos).project(camera);

    const rect = this._gameContainer!.getBoundingClientRect();
    const screenX = (this._scratchPos.x * 0.5 + 0.5) * rect.width;
    const screenY = (-this._scratchPos.y * 0.5 + 0.5) * rect.height;

    container.style.left = `${screenX}px`;
    container.style.top = `${screenY}px`;
    container.style.transform = 'translate(-50%, -50%)';
  }
}
