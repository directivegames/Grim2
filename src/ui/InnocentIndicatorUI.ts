/**
 * InnocentIndicatorUI — screen-edge chevron pointing toward the active innocent.
 * Double-layer arrow, distance readout, urgency scaling, and spawn ping.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const EDGE_MARGIN_PX = 64;
/** NDC bounds — innocent inside this box is considered on-screen (arrow hidden). */
const ON_SCREEN_NDC_MARGIN = 0.08;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export interface InnocentIndicatorUpdateOptions {
  /** Seconds left on the save timer; drives urgency pulse/size. */
  secondsRemaining?: number;
}

export class InnocentIndicatorUI {
  private static readonly instances = new Map<ENGINE.World, InnocentIndicatorUI>();

  private readonly _world: ENGINE.World | null;
  private _root: HTMLDivElement | null = null;
  private _pingRing: HTMLDivElement | null = null;
  private _distanceLabel: HTMLDivElement | null = null;
  private _visible = false;
  private _pendingPing = false;
  private readonly _targetScratch = new THREE.Vector3();
  private readonly _playerScratch = new THREE.Vector3();

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
    if (!gc || this._root) return;

    InnocentIndicatorUI._injectStyles(gc);

    this._root = document.createElement('div');
    this._root.setAttribute('data-innocent-indicator', '');
    this._root.style.cssText = `
      position: absolute;
      pointer-events: none;
      user-select: none;
      z-index: 1004;
      display: none;
      opacity: 0;
      transform-origin: 50% 72%;
    `;

    this._pingRing = document.createElement('div');
    this._pingRing.className = 'grim-innocent-ping-ring';

    const arrowWrap = document.createElement('div');
    arrowWrap.className = 'grim-innocent-arrow-wrap';

    const arrowOuter = document.createElement('div');
    arrowOuter.className = 'grim-innocent-arrow-outer';

    const arrowInner = document.createElement('div');
    arrowInner.className = 'grim-innocent-arrow-inner';

    arrowWrap.append(arrowOuter, arrowInner);

    this._distanceLabel = document.createElement('div');
    this._distanceLabel.className = 'grim-innocent-distance';

    this._root.append(this._pingRing, arrowWrap, this._distanceLabel);
    gc.appendChild(this._root);
  }

  public show(): void {
    if (!this._root) return;
    this._visible = true;
    this._root.style.display = 'block';
    this._root.style.opacity = '1';
  }

  public hide(): void {
    this._visible = false;
    this._pendingPing = false;
    if (!this._root) return;
    this._root.style.opacity = '0';
    this._root.style.display = 'none';
  }

  /** Radial burst at the edge arrow when a new innocent spawns. */
  public playSpawnPing(): void {
    this._pendingPing = true;
  }

  /** Update arrow position and rotation from innocent world position. */
  public updateTarget(
    worldPos: THREE.Vector3 | null,
    options: InnocentIndicatorUpdateOptions = {},
  ): void {
    if (!this._visible || !this._root || !this._world) return;

    const gc = this._gameContainer();
    const camera = this._world.getActiveCamera();
    if (!gc || !camera || !worldPos) {
      this.hide();
      return;
    }

    this._applyUrgency(options.secondsRemaining ?? 0);

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
      this._root.style.display = 'none';
      return;
    }

    this._root.style.display = 'block';

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

    const urgencyScale = this._urgencyScale(options.secondsRemaining ?? 0);
    this._root.style.left = `${edgeX}px`;
    this._root.style.top = `${edgeY}px`;
    this._root.style.transform =
      `translate(-50%, -50%) rotate(${angle + Math.PI / 2}rad) scale(${urgencyScale})`;

    if (this._distanceLabel) {
      const distM = this._distanceToPlayerMeters(worldPos);
      this._distanceLabel.textContent = distM > 0 ? `${distM}m` : '';
    }

    if (this._pendingPing) {
      this._pendingPing = false;
      this._triggerPing();
    }
  }

  private _distanceToPlayerMeters(worldPos: THREE.Vector3): number {
    const pawn = this._world?.getFirstPlayerPawn();
    if (!pawn) return 0;
    pawn.getWorldPosition(this._playerScratch);
    return Math.round(this._playerScratch.distanceTo(worldPos));
  }

  private _urgencyScale(secondsRemaining: number): number {
    if (secondsRemaining <= 0) return 1;
    if (secondsRemaining < 10) return 1.4;
    if (secondsRemaining < 30) return 1.2;
    return 1;
  }

  private _applyUrgency(secondsRemaining: number): void {
    if (!this._root) return;

    let pulseSec = 1.4;
    if (secondsRemaining > 0 && secondsRemaining < 10) {
      pulseSec = 0.3;
    } else if (secondsRemaining > 0 && secondsRemaining < 30) {
      pulseSec = 0.8;
    }

    this._root.style.setProperty('--innocent-pulse-duration', `${pulseSec}s`);
    this._root.classList.toggle(
      'grim-innocent-urgent-warn',
      secondsRemaining > 0 && secondsRemaining < 30 && secondsRemaining >= 10,
    );
    this._root.classList.toggle(
      'grim-innocent-urgent-critical',
      secondsRemaining > 0 && secondsRemaining < 10,
    );
  }

  private _triggerPing(): void {
    if (!this._pingRing) return;
    this._pingRing.classList.remove('grim-innocent-ping-active');
    // Force reflow so repeated spawns retrigger the animation.
    void this._pingRing.offsetWidth;
    this._pingRing.classList.add('grim-innocent-ping-active');
  }

  private static _injectStyles(container: HTMLElement): void {
    const id = 'grim-innocent-indicator-styles';
    if (container.querySelector(`#${id}`)) return;

    const st = document.createElement('style');
    st.id = id;
    st.textContent = `
      [data-innocent-indicator] {
        --innocent-pulse-duration: 1.4s;
      }

      .grim-innocent-arrow-wrap {
        position: relative;
        width: 48px;
        height: 52px;
      }

      .grim-innocent-arrow-outer,
      .grim-innocent-arrow-inner {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: solid transparent;
        border-right: solid transparent;
        border-bottom-style: solid;
      }

      .grim-innocent-arrow-outer {
        bottom: 0;
        border-left-width: 22px;
        border-right-width: 22px;
        border-bottom-width: 42px;
        border-bottom-color: #1a1208;
        filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.95));
      }

      .grim-innocent-arrow-inner {
        bottom: 3px;
        border-left-width: 17px;
        border-right-width: 17px;
        border-bottom-width: 34px;
        border-bottom-color: #fff6c8;
        filter: drop-shadow(0 0 10px rgba(255, 230, 120, 0.95));
        animation: grim-innocent-arrow-pulse var(--innocent-pulse-duration) ease-in-out infinite;
      }

      [data-innocent-indicator].grim-innocent-urgent-warn .grim-innocent-arrow-inner {
        border-bottom-color: #ffe082;
        filter: drop-shadow(0 0 14px rgba(255, 200, 80, 1));
      }

      [data-innocent-indicator].grim-innocent-urgent-critical .grim-innocent-arrow-inner {
        border-bottom-color: #ff8a65;
        filter: drop-shadow(0 0 18px rgba(255, 90, 60, 1));
      }

      .grim-innocent-distance {
        margin-top: 4px;
        text-align: center;
        font-family: 'Montserrat', 'Segoe UI', sans-serif;
        font-weight: 800;
        font-size: clamp(11px, 1.4vw, 15px);
        letter-spacing: 0.08em;
        color: #fff6c8;
        text-shadow:
          0 0 8px rgba(255, 220, 100, 0.85),
          0 1px 3px rgba(0, 0, 0, 0.95),
          0 0 0 2px rgba(0, 0, 0, 0.75);
      }

      [data-innocent-indicator].grim-innocent-urgent-critical .grim-innocent-distance {
        color: #ffb199;
      }

      .grim-innocent-ping-ring {
        position: absolute;
        left: 50%;
        top: 38%;
        width: 56px;
        height: 56px;
        margin: -28px 0 0 -28px;
        border-radius: 50%;
        border: 3px solid rgba(255, 240, 160, 0.85);
        opacity: 0;
        pointer-events: none;
        box-shadow: 0 0 16px rgba(255, 230, 120, 0.6);
      }

      .grim-innocent-ping-ring.grim-innocent-ping-active {
        animation: grim-innocent-ping 0.75s ease-out forwards;
      }

      @keyframes grim-innocent-arrow-pulse {
        0%, 100% {
          opacity: 0.88;
          filter: drop-shadow(0 0 8px rgba(255, 230, 120, 0.8));
        }
        50% {
          opacity: 1;
          filter: drop-shadow(0 0 16px rgba(255, 255, 200, 1));
        }
      }

      @keyframes grim-innocent-ping {
        0% {
          transform: scale(0.35);
          opacity: 0.95;
          border-width: 4px;
        }
        100% {
          transform: scale(2.6);
          opacity: 0;
          border-width: 1px;
        }
      }
    `;
    container.appendChild(st);
  }
}
