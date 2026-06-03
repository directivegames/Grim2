/**
 * Grim Grinder HUD — F key hint and run-soul progress toward 50.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { GrimGrinderModeActor } from '../actors/GrimGrinderModeActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import {
  GRIM_GRINDER_SOUL_THRESHOLD,
} from '../data/grim-grinder-config.js';
import { grimVault } from '../game/GrimVault.js';
import { ensureMobileHudStyles } from './mobile-hud-layout.js';

const ICON_URL = '@project/assets/UI/grimgrinder.webp';

const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const ICON_SIZE = 52;
const GAP_ABOVE_HEALTH = 10;
const FIST_STACK_OFFSET = ICON_SIZE + 24;
const GRIM_GRINDER_HUD_STYLE_ID = 'grim-grinder-hud-styles';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class GrimGrinderHUDUI {
  private static readonly instances = new Map<ENGINE.World, GrimGrinderHUDUI>();

  private readonly _world: ENGINE.World;
  private _container: HTMLDivElement | null = null;
  private _iconWrap: HTMLDivElement | null = null;
  private _progressEl: HTMLDivElement | null = null;
  private _fillEl: HTMLDivElement | null = null;
  private _readyLabel: HTMLSpanElement | null = null;
  private _initialized = false;
  private _wasReady = false;

  private constructor(world: ENGINE.World) {
    this._world = world;
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    GrimGrinderHUDUI._injectStyles(gc);
    ensureMobileHudStyles(gc);

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH + FIST_STACK_OFFSET;

    this._container = document.createElement('div');
    this._container.className = 'grim-grinder-hud grim-hud-grim-grinder';
    this._container.style.cssText = `
      position: absolute;
      bottom: ${bottom}px;
      left: 36px;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      pointer-events: none;
      user-select: none;
      z-index: 1002;
      opacity: 0;
      will-change: opacity, filter;
    `;

    const keyHint = document.createElement('span');
    keyHint.setAttribute('data-grim-hud-key', '');
    keyHint.textContent = 'F';
    keyHint.style.cssText = `
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.06em;
      color: rgba(200, 240, 255, 0.95);
      text-shadow: 0 0 8px rgba(0, 200, 255, 0.45);
    `;

    this._iconWrap = document.createElement('div');
    this._iconWrap.setAttribute('data-grim-hud-icon', '');
    this._iconWrap.style.cssText = `width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;`;

    const icon = document.createElement('img');
    icon.alt = 'Grim Grinder';
    icon.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
    `;
    void ENGINE.resolveAssetPathsInText(ICON_URL).then((src) => {
      icon.src = src;
    });

    this._iconWrap.append(icon);

    this._progressEl = document.createElement('div');
    this._progressEl.setAttribute('data-grim-hud-progress', '');
    this._progressEl.style.cssText = `
      width: ${ICON_SIZE + 8}px;
      height: 5px;
      border-radius: 999px;
      background: rgba(0, 40, 60, 0.65);
      border: 1px solid rgba(0, 180, 220, 0.35);
      overflow: hidden;
    `;

    this._fillEl = document.createElement('div');
    this._fillEl.style.cssText = `
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, rgba(0, 160, 200, 0.9), rgba(0, 230, 255, 1));
      transition: width 0.12s ease;
    `;
    this._progressEl.append(this._fillEl);

    this._readyLabel = document.createElement('span');
    this._readyLabel.textContent = 'READY!';
    this._readyLabel.className = 'grim-grinder-ready-label';
    this._readyLabel.style.cssText = `
      display: none;
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 10px;
      letter-spacing: 0.14em;
      color: rgba(0, 255, 255, 0.98);
      text-shadow: 0 0 10px rgba(0, 230, 255, 0.85);
    `;

    this._container.append(keyHint, this._iconWrap, this._progressEl, this._readyLabel);
    gc.appendChild(this._container);
  }

  private static _injectStyles(container: HTMLElement): void {
    if (container.querySelector(`#${GRIM_GRINDER_HUD_STYLE_ID}`)) {
      return;
    }
    const st = document.createElement('style');
    st.id = GRIM_GRINDER_HUD_STYLE_ID;
    st.textContent = `
      @keyframes grim-grinder-ready-pulse {
        0%, 100% {
          filter: brightness(1.15) drop-shadow(0 0 8px rgba(0, 230, 255, 0.55));
        }
        50% {
          filter: brightness(1.35) drop-shadow(0 0 18px rgba(0, 255, 255, 0.95));
        }
      }
      @keyframes grim-grinder-ready-label {
        0%, 100% { opacity: 0.85; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.08); }
      }
      .grim-grinder-hud.grim-grinder-ready .grim-grinder-ready-label {
        display: block !important;
        animation: grim-grinder-ready-label 1s ease-in-out infinite;
      }
      .grim-grinder-hud.grim-grinder-ready > div:nth-child(2) {
        animation: grim-grinder-ready-pulse 1.2s ease-in-out infinite;
      }
      .grim-grinder-hud.grim-grinder-ready {
        opacity: 1 !important;
      }
    `;
    container.appendChild(st);
  }

  public static async getInstance(world: ENGINE.World | null): Promise<GrimGrinderHUDUI | null> {
    if (!world) {
      return null;
    }
    let inst = GrimGrinderHUDUI.instances.get(world);
    if (!inst) {
      inst = new GrimGrinderHUDUI(world);
      GrimGrinderHUDUI.instances.set(world, inst);
      await inst._show();
    } else {
      inst._syncUnlockVisibility();
    }
    return inst;
  }

  /** Re-show HUD after unlocking transform mid-session (e.g. shop then mission). */
  private _syncUnlockVisibility(): void {
    if (!this._container || !this._initialized) {
      return;
    }
    if (grimVault.hasGrimGrinderUnlocked() && !GrimGrinderModeActor.isActive()) {
      this._container.style.display = 'flex';
      this._container.style.opacity = '1';
    }
  }

  private async _show(): Promise<void> {
    if (!this._container) {
      return;
    }
    this._container.style.display = 'flex';
    requestAnimationFrame(() => {
      if (this._container) {
        this._container.style.transition = 'opacity 0.3s ease';
        this._container.style.opacity = '1';
      }
    });
    this._initialized = true;
  }

  public tick(): void {
    if (!this._container || !this._fillEl || !this._initialized) {
      return;
    }

    const equipped = grimVault.hasGrimGrinderUnlocked();
    if (!equipped || GrimGrinderModeActor.isActive()) {
      this._container.style.display = 'none';
      this._container.classList.remove('grim-grinder-ready');
      this._wasReady = false;
      return;
    }

    this._container.style.display = 'flex';

    const pawn = this._world.getFirstPlayerPawn();
    const progress = pawn instanceof IsometricPlayerPawn ? pawn.grimGrinderSoulProgress : 0;
    const frac = Math.min(1, progress / GRIM_GRINDER_SOUL_THRESHOLD);
    this._fillEl.style.width = `${(frac * 100).toFixed(1)}%`;

    const ready = progress >= GRIM_GRINDER_SOUL_THRESHOLD;
    if (ready) {
      this._container.classList.add('grim-grinder-ready');
      this._container.style.filter = 'none';
      this._container.style.opacity = '1';
      if (this._progressEl) {
        this._progressEl.style.borderColor = 'rgba(0, 255, 255, 0.75)';
        this._progressEl.style.boxShadow = '0 0 10px rgba(0, 230, 255, 0.55)';
      }
      if (this._readyLabel) {
        this._readyLabel.style.display = 'block';
      }
      if (!this._wasReady && this._iconWrap) {
        this._iconWrap.style.transform = 'scale(1.12)';
        window.setTimeout(() => {
          if (this._iconWrap) {
            this._iconWrap.style.transition = 'transform 0.25s ease';
            this._iconWrap.style.transform = 'scale(1)';
          }
        }, 280);
      }
    } else {
      this._container.classList.remove('grim-grinder-ready');
      this._container.style.filter = 'brightness(0.75)';
      this._container.style.opacity = '0.88';
      if (this._progressEl) {
        this._progressEl.style.borderColor = 'rgba(0, 180, 220, 0.35)';
        this._progressEl.style.boxShadow = 'none';
      }
      if (this._readyLabel) {
        this._readyLabel.style.display = 'none';
      }
    }
    this._wasReady = ready;
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    GrimGrinderHUDUI.instances.delete(this._world);
  }
}
