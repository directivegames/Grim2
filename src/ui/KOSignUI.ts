/**
 * KOSignUI - Displays a KO sign image when an enemy is killed.
 *
 * Uses object pooling. Sign appears at the enemy's world position,
 * punches in, floats upward, and fades out — identical rhythm to HitNumberUI.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const KO_BG_URL = '@project/assets/UI/KO-sign 2.png';

const BG_SIZE = 512;
const UI_SCALE = 0.15;
const DURATION_MS = 700;
const POOL_SIZE = 8;

interface PooledElement {
  container: HTMLDivElement;
  inUse: boolean;
}

export class KOSignUI {
  private static _instance: KOSignUI | null = null;

  private _world: ENGINE.World | null = null;
  private _gameContainer: HTMLElement | null = null;
  private _pool: PooledElement[] = [];
  private _active: { element: PooledElement; startTime: number }[] = [];
  private _resolvedUrl: string | null = null;
  private _initialized = false;

  private readonly _scratchPos = new THREE.Vector3();

  public static getInstance(world: ENGINE.World | null): KOSignUI {
    if (!KOSignUI._instance) {
      KOSignUI._instance = new KOSignUI(world);
    }
    return KOSignUI._instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;
    this._world = world;
    this._gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer ?? null;
    if (!this._gameContainer) return;

    void this._resolveUrl();
    this._initPool();
    this._initialized = true;
  }

  private async _resolveUrl(): Promise<void> {
    const css = `.bg { background-image: url("${KO_BG_URL}"); }`;
    const resolved = await ENGINE.resolveAssetPathsInText(css);
    const match = resolved.match(/url\("([^"]+)"\)/);
    if (match) this._resolvedUrl = match[1];
  }

  private _initPool(): void {
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
      this._gameContainer!.appendChild(container);
      this._pool.push({ container, inUse: false });
    }
  }

  public showKO(worldPos: THREE.Vector3): void {
    if (!this._initialized || !this._world || !this._gameContainer) return;

    const element = this._acquire();
    if (!element) return;

    if (this._resolvedUrl) {
      element.container.style.backgroundImage = `url("${this._resolvedUrl}")`;
    }

    this._positionAt(element.container, worldPos);
    element.container.style.display = 'block';
    element.inUse = true;

    this._active.push({ element, startTime: performance.now() });

    const anim = element.container.animate([
      { transform: 'translate(-50%, -50%) scale(0.4) translateY(0px)',   opacity: 0   },
      { transform: 'translate(-50%, -50%) scale(1.3) translateY(-10px)', opacity: 1,  offset: 0.18 },
      { transform: 'translate(-50%, -50%) scale(1)   translateY(-25px)', opacity: 1,  offset: 0.38 },
      { transform: 'translate(-50%, -50%) scale(1)   translateY(-70px)', opacity: 0   },
    ], {
      duration: DURATION_MS,
      easing: 'ease-out',
      fill: 'forwards',
    });

    anim.onfinish = () => {
      this._release(element);
      const idx = this._active.findIndex(a => a.element === element);
      if (idx !== -1) this._active.splice(idx, 1);
    };
  }

  private _acquire(): PooledElement | null {
    for (const el of this._pool) {
      if (!el.inUse) return el;
    }
    if (this._active.length > 0) {
      const oldest = this._active.shift()!;
      return oldest.element;
    }
    return null;
  }

  private _positionAt(container: HTMLDivElement, worldPos: THREE.Vector3): void {
    if (!this._world) return;
    const camera = this._world.getActiveCamera();
    if (!camera) return;

    this._scratchPos.copy(worldPos);
    this._scratchPos.project(camera);

    const rect = this._gameContainer!.getBoundingClientRect();
    const screenX = (this._scratchPos.x * 0.5 + 0.5) * rect.width;
    const screenY = (-this._scratchPos.y * 0.5 + 0.5) * rect.height;

    container.style.left = `${screenX}px`;
    container.style.top = `${screenY}px`;
    container.style.transform = 'translate(-50%, -50%)';
  }

  /** Safety-net cleanup for stale entries. Call from game tick. */
  public tick(): void {
    if (this._active.length === 0) return;
    const now = performance.now();
    const toRemove: number[] = [];
    for (let i = 0; i < this._active.length; i++) {
      if (now - this._active[i]!.startTime > DURATION_MS + 200) {
        this._release(this._active[i]!.element);
        toRemove.push(i);
      }
    }
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this._active.splice(toRemove[i]!, 1);
    }
  }

  private _release(element: PooledElement): void {
    element.inUse = false;
    element.container.style.display = 'none';
    element.container.style.opacity = '0';
  }

  public destroy(): void {
    for (const el of this._pool) el.container.remove();
    this._pool = [];
    this._active = [];
    this._gameContainer = null;
    KOSignUI._instance = null;
  }
}
