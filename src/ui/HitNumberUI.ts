/**
 * HitNumberUI - Displays floating damage numbers when zombies are hit.
 *
 * Uses object pooling for performance. Numbers appear at hit location,
 * float upward, and fade out with elastic punch + chromatic flash.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { injectBreeSerifFont, sunsetNumberTextCss } from './uiTypography.js';

const HIT_BG_URL = '@project/assets/UI/HitNumbersBG 1.png';

const BG_SIZE = 512;
const UI_SCALE = 0.15;
const POOL_SIZE = 15;
const HIT_DURATION_MS = 1000;

interface PooledElement {
  container: HTMLDivElement;
  number: HTMLSpanElement;
  inUse: boolean;
}

interface ActiveHitNumber {
  element: PooledElement;
  startTime: number;
  duration: number;
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

  private readonly _scratchPos = new THREE.Vector3();

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

    injectBreeSerifFont();
    void this._resolveUrl();
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
        ${sunsetNumberTextCss(80 * UI_SCALE)}
      `;

      container.appendChild(number);
      this._gameContainer!.appendChild(container);

      this._pool.push({ container, number, inUse: false });
    }
  }

  public showDamage(damage: number, worldPos: THREE.Vector3): void {
    if (!this._initialized || !this._world || !this._gameContainer) return;

    const element = this._getPooledElement();
    if (!element) return;

    element.number.textContent = Math.round(damage).toString();

    if (this._resolvedBgUrl) {
      element.container.style.backgroundImage = `url("${this._resolvedBgUrl}")`;
    }

    this._positionAtWorldPoint(element.container, worldPos);
    element.container.style.display = 'block';
    element.inUse = true;

    this._active.push({
      element,
      startTime: performance.now(),
      duration: HIT_DURATION_MS,
      worldPos: worldPos.clone(),
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
      this._releaseElement(element);
      const idx = this._active.findIndex((a) => a.element === element);
      if (idx !== -1) this._active.splice(idx, 1);
    };
  }

  private _getPooledElement(): PooledElement | null {
    for (const el of this._pool) {
      if (!el.inUse) return el;
    }
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

    this._scratchPos.copy(worldPos);
    this._scratchPos.project(camera);

    const rect = this._gameContainer!.getBoundingClientRect();
    const screenX = (this._scratchPos.x * 0.5 + 0.5) * rect.width;
    const screenY = (-this._scratchPos.y * 0.5 + 0.5) * rect.height;

    container.style.left = `${screenX}px`;
    container.style.top = `${screenY}px`;
    container.style.transform = 'translate(-50%, -50%)';
  }

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
