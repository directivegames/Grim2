/**
 * InnocentIndicatorUI — screen-edge chevron pointing toward the active innocent.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const EDGE_MARGIN_PX = 52;
/** NDC bounds — innocent inside this box is considered on-screen (arrow hidden). */
const ON_SCREEN_NDC_MARGIN = 0.08;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class InnocentIndicatorUI {
  private static readonly instances = new Map<ENGINE.World, InnocentIndicatorUI>();

  private readonly _world: ENGINE.World | null;
  private _arrow: HTMLDivElement | null = null;
  private _visible = false;
  private readonly _targetScratch = new THREE.Vector3();

  public static getInstance(world: ENGINE.World | null): InnocentIndicatorUI {
    if (!world) {
      return new InnocentIndicatorUI(null);
    }

    let inst = InnocentIndicatorUI.instances.get(world);
    if (!inst) {
      inst = new InnocentIndicatorUI(world);
      InnocentIndicatorUI.instances.set(world, inst);
      inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    InnocentIndicatorUI.instances.get(world)?.hide();
  }

  private constructor(world: ENGINE.World | null) {
    this._world = world;
  }

  private _gameContainer(): HTMLElement | null {
    if (!this._world) return null;
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private _buildDom(): void {
    const gc = this._gameContainer();
    if (!gc || this._arrow) return;

    InnocentIndicatorUI._injectStyles(gc);

    this._arrow = document.createElement('div');
    this._arrow.setAttribute('data-innocent-indicator', '');
    this._arrow.style.cssText = `
      position: absolute;
      width: 0;
      height: 0;
      pointer-events: none;
      user-select: none;
      z-index: 1004;
      display: none;
      opacity: 0;
      border-left: 14px solid transparent;
      border-right: 14px solid transparent;
      border-bottom: 26px solid #fff6c8;
      filter: drop-shadow(0 0 8px rgba(255, 240, 160, 0.9))
              drop-shadow(0 2px 4px rgba(0, 0, 0, 0.85));
      transform-origin: 50% 65%;
    `;
    gc.appendChild(this._arrow);
  }

  public show(): void {
    if (!this._arrow) return;
    this._visible = true;
    this._arrow.style.display = 'block';
    this._arrow.style.opacity = '1';
  }

  public hide(): void {
    this._visible = false;
    if (!this._arrow) return;
    this._arrow.style.opacity = '0';
    this._arrow.style.display = 'none';
  }

  /** Update arrow position and rotation from innocent world position. */
  public updateTarget(worldPos: THREE.Vector3 | null): void {
    if (!this._visible || !this._arrow || !this._world) return;

    const gc = this._gameContainer();
    const camera = this._world.getActiveCamera();
    if (!gc || !camera || !worldPos) {
      this.hide();
      return;
    }

    this._targetScratch.copy(worldPos);
    this._targetScratch.project(camera);

    const rect = gc.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    let sx = (this._targetScratch.x * 0.5 + 0.5) * w;
    let sy = (-this._targetScratch.y * 0.5 + 0.5) * h;

    const cx = w * 0.5;
    const cy = h * 0.5;

    // Target behind the camera — mirror through screen center so the chevron points the right way.
    if (this._targetScratch.z > 1) {
      sx = cx + (cx - sx);
      sy = cy + (cy - sy);
    }

    const ndc = this._targetScratch;
    const inFront = ndc.z > -1 && ndc.z < 1;
    const onScreen =
      inFront &&
      ndc.x >= -1 + ON_SCREEN_NDC_MARGIN &&
      ndc.x <= 1 - ON_SCREEN_NDC_MARGIN &&
      ndc.y >= -1 + ON_SCREEN_NDC_MARGIN &&
      ndc.y <= 1 - ON_SCREEN_NDC_MARGIN;

    if (onScreen) {
      this._arrow.style.display = 'none';
      return;
    }

    this._arrow.style.display = 'block';

    const dx = sx - cx;
    const dy = sy - cy;
    const angle = Math.atan2(dy, dx);

    const maxX = w * 0.5 - EDGE_MARGIN_PX;
    const maxY = h * 0.5 - EDGE_MARGIN_PX;
    const absDx = Math.abs(Math.cos(angle));
    const absDy = Math.abs(Math.sin(angle));
    const scale = Math.min(
      absDx > 1e-5 ? maxX / absDx : Infinity,
      absDy > 1e-5 ? maxY / absDy : Infinity,
    );

    const edgeX = cx + Math.cos(angle) * scale;
    const edgeY = cy + Math.sin(angle) * scale;

    this._arrow.style.left = `${edgeX}px`;
    this._arrow.style.top = `${edgeY}px`;
    this._arrow.style.transform = `translate(-50%, -50%) rotate(${angle + Math.PI / 2}rad)`;
  }

  private static _injectStyles(container: HTMLElement): void {
    const id = 'grim-innocent-indicator-styles';
    if (container.querySelector(`#${id}`)) return;

    const st = document.createElement('style');
    st.id = id;
    st.textContent = `
      @keyframes grim-innocent-arrow-pulse {
        0%, 100% { filter: drop-shadow(0 0 6px rgba(255, 240, 160, 0.75)); opacity: 0.92; }
        50% { filter: drop-shadow(0 0 14px rgba(255, 255, 200, 1)); opacity: 1; }
      }
      [data-innocent-indicator] {
        animation: grim-innocent-arrow-pulse 1.4s ease-in-out infinite;
      }
    `;
    container.appendChild(st);
  }
}

