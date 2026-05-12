/**
 * HitNumberUI - Displays floating damage numbers when zombies are hit.
 *
 * Uses object pooling for performance. Numbers appear at hit location,
 * float upward, and fade out.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const HIT_BG_URL = '@project/assets/UI/HitNumbersBG 1.png';
const FONT_URL = '@project/assets/UI/Bree_Serif/BreeSerif-Regular.ttf';

// Background dimensions
const BG_SIZE = 512;
const UI_SCALE = 0.15;

// Pool configuration
const POOL_SIZE = 15;

interface PooledElement {
  container: HTMLDivElement;
  number: HTMLSpanElement;
  inUse: boolean;
}

interface ActiveHitNumber {
  element: PooledElement;
  startTime: number;
  duration: number;
  startY: number;
  worldPos: THREE.Vector3;
}

export class HitNumberUI {
  private static instance: HitNumberUI | null = null;

  private _world: ENGINE.World | null = null;
  private _gameContainer: HTMLElement | null = null;
  private _pool: PooledElement[] = [];
  private _active: ActiveHitNumber[] = [];
  private _initialized = false;
  private _resolvedBgUrl: string | null = null;

  // Scratch vectors for projection math
  private readonly _scratchPos = new THREE.Vector3();
  private readonly _scratchScreenPos = new THREE.Vector3();

  public static getInstance(world: ENGINE.World | null): HitNumberUI {
    if (!HitNumberUI.instance) {
      HitNumberUI.instance = new HitNumberUI(world);
    }
    return HitNumberUI.instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;
    this._world = world;

    this._gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer ?? null;
    if (!this._gameContainer) return;

    // Inject font style
    if (!document.querySelector('style[data-font="BreeSerif"]')) {
      const fontFace = document.createElement('style');
      fontFace.setAttribute('data-font', 'BreeSerif');
      fontFace.textContent = `
        @font-face {
          font-family: 'BreeSerif';
          src: url('${FONT_URL}') format('truetype');
          font-weight: normal;
          font-style: normal;
        }
      `;
      document.head.appendChild(fontFace);
    }

    // Pre-resolve background URL
    void this._resolveUrl();

    // Initialize object pool
    this._initializePool();

    this._initialized = true;
  }

  private async _resolveUrl(): Promise<void> {
    const cssString = `.bg { background-image: url("${HIT_BG_URL}"); }`;
    const resolvedCss = await ENGINE.resolveAssetPathsInText(cssString);
    const match = resolvedCss.match(/url\("([^"]+)"\)/);
    if (match) {
      this._resolvedBgUrl = match[1];
    }
  }

  private _initializePool(): void {
    for (let i = 0; i < POOL_SIZE; i++) {
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
      `;

      const number = document.createElement('span');
      number.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-family: 'BreeSerif', serif;
        font-size: ${80 * UI_SCALE}px;
        font-weight: bold;
        color: #ffffff;
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(255, 50, 50, 0.8);
      `;

      container.appendChild(number);
      this._gameContainer!.appendChild(container);

      this._pool.push({
        container,
        number,
        inUse: false,
      });
    }
  }

  /**
   * Show a hit number at the specified world position.
   */
  public showDamage(damage: number, worldPos: THREE.Vector3): void {
    if (!this._initialized || !this._world || !this._gameContainer) return;

    // Get available element from pool
    const element = this._getPooledElement();
    if (!element) return; // Pool exhausted, skip this hit

    // Set damage number
    element.number.textContent = Math.round(damage).toString();

    // Set background if resolved
    if (this._resolvedBgUrl) {
      element.container.style.backgroundImage = `url("${this._resolvedBgUrl}")`;
    }

    // Position at world location
    this._positionAtWorldPoint(element.container, worldPos);

    // Show element
    element.container.style.display = 'block';
    element.inUse = true;

    this._active.push({
      element,
      startTime: performance.now(),
      duration: 600,
      startY: parseFloat(element.container.style.top || '0'),
      worldPos: worldPos.clone(),
    });

    // Single animation: punch in, float up, fade out
    const anim = element.container.animate([
      { transform: 'translate(-50%, -50%) scale(0.5) translateY(0px)',   opacity: 0   },
      { transform: 'translate(-50%, -50%) scale(1.2) translateY(-8px)',  opacity: 1,  offset: 0.15 },
      { transform: 'translate(-50%, -50%) scale(1)   translateY(-20px)', opacity: 1,  offset: 0.35 },
      { transform: 'translate(-50%, -50%) scale(1)   translateY(-60px)', opacity: 0   },
    ], {
      duration: 600,
      easing: 'ease-out',
      fill: 'forwards',
    });

    anim.onfinish = () => {
      this._releaseElement(element);
      const idx = this._active.findIndex(a => a.element === element);
      if (idx !== -1) this._active.splice(idx, 1);
    };
  }

  private _getPooledElement(): PooledElement | null {
    // Find first available element
    for (const el of this._pool) {
      if (!el.inUse) {
        return el;
      }
    }
    // Pool exhausted - reuse oldest active element
    if (this._active.length > 0) {
      const oldest = this._active.shift()!;
      return oldest.element;
    }
    return null;
  }

  private _positionAtWorldPoint(container: HTMLDivElement, worldPos: THREE.Vector3): void {
    if (!this._world) return;

    const camera = this._world.getActiveCamera();
    if (!camera) return;

    // Project world position to screen space
    this._scratchPos.copy(worldPos);
    this._scratchPos.project(camera);

    // Convert to CSS coordinates
    const rect = this._gameContainer!.getBoundingClientRect();
    const screenX = (this._scratchPos.x * 0.5 + 0.5) * rect.width;
    const screenY = (-this._scratchPos.y * 0.5 + 0.5) * rect.height;

    // Position container (centered on point)
    container.style.left = `${screenX}px`;
    container.style.top = `${screenY}px`;
    container.style.transform = 'translate(-50%, -50%)';
  }

  /**
   * Safety-net cleanup for stale active entries. Call from game tick.
   */
  public tick(): void {
    if (this._active.length === 0) return;

    const now = performance.now();
    const toRemove: number[] = [];

    for (let i = 0; i < this._active.length; i++) {
      const hit = this._active[i]!;
      if (now - hit.startTime > hit.duration + 200) {
        this._releaseElement(hit.element);
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      this._active.splice(toRemove[i]!, 1);
    }
  }

  private _releaseElement(element: PooledElement): void {
    element.inUse = false;
    element.container.style.display = 'none';
    element.container.style.opacity = '0';
  }

  public destroy(): void {
    for (const el of this._pool) {
      el.container.remove();
    }
    this._pool = [];
    this._active = [];
    this._gameContainer = null;
    HitNumberUI.instance = null;
  }
}
