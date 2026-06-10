/**
 * GrimGrinderSkillHUDUI — F key skill button for Grim Grinder, sits to the
 * right of the Soul Throw (RMB) icon in the bottom-left skill row.
 *
 * Only visible after grimGrinder is unlocked. Dims while soul progress has not
 * yet reached the activation threshold; full brightness when ready to use.
 * Hidden while Grim Grinder mode is actively running.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { GrimGrinderModeActor } from '../actors/GrimGrinderModeActor.js';
import { SpinningWeaponActor } from '../actors/SpinningWeaponActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { GRIM_GRINDER_SOUL_THRESHOLD } from '../data/grim-grinder-config.js';
import { grimVault } from '../game/GrimVault.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';
import { ensureMobileHudStyles } from './mobile-hud-layout.js';

const ICON_URL = '@project/assets/UI/grimgrinderskill.webp';

const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const GAP_ABOVE_HEALTH = 10;

// Position — immediately right of the Soul Throw icon
const FIST_ICON_LEFT   = 36;
const FIST_ICON_SIZE   = 80;
const GAP              = 8;
const SOUL_THROW_SIZE  = 64;
const ICON_LEFT        = FIST_ICON_LEFT + FIST_ICON_SIZE + GAP + SOUL_THROW_SIZE + GAP; // 196
const ICON_SIZE        = 52;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class GrimGrinderSkillHUDUI {
  private static readonly instances = new Map<ENGINE.World, GrimGrinderSkillHUDUI>();

  private readonly _world: ENGINE.World;
  private _container: HTMLDivElement | null = null;
  private _iconEl: HTMLImageElement | null = null;
  private _cooldownOverlay: HTMLDivElement | null = null;
  private _initialized = false;
  private _wasReady = false;

  private constructor(world: ENGINE.World) {
    this._world = world;
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    ensureMobileHudStyles(gc);

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH;

    this._container = document.createElement('div');
    this._container.className = 'grim-hud-grimgrinder-skill';
    this._container.style.cssText = `
      position: absolute;
      bottom: ${bottom}px;
      left: ${ICON_LEFT}px;
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      pointer-events: none;
      user-select: none;
      z-index: 1002;
      opacity: 0;
      will-change: opacity, filter;
    `;

    const mobile = isMobileDevice();

    const keyHint = document.createElement('span');
    keyHint.setAttribute('data-grim-hud-key', '');
    keyHint.textContent = 'F';
    keyHint.style.cssText = `
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.06em;
      color: rgba(255, 232, 200, 0.95);
      text-shadow:
        0 0 6px rgba(0, 0, 0, 0.9),
        0 1px 2px rgba(0, 0, 0, 0.85),
        0 0 10px rgba(255, 180, 80, 0.35);
    `;

    const iconWrap = document.createElement('div');
    iconWrap.setAttribute('data-grim-hud-icon', '');
    iconWrap.style.cssText = `
      position: relative;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
    `;

    this._iconEl = document.createElement('img');
    this._iconEl.alt = 'Grim Grinder';
    this._iconEl.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      transition: filter 0.15s ease, opacity 0.15s ease;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
    `;

    // Overlay drains upward as souls are collected — full when empty, gone when ready.
    this._cooldownOverlay = document.createElement('div');
    this._cooldownOverlay.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 100%;
      background: rgba(8, 6, 12, 0.55);
      border-radius: 4px;
      pointer-events: none;
      transition: height 0.12s linear;
    `;

    iconWrap.append(this._iconEl, this._cooldownOverlay);

    if (!mobile) {
      this._container.append(keyHint, iconWrap);
    } else {
      iconWrap.style.pointerEvents = 'auto';
      iconWrap.style.touchAction = 'manipulation';
      iconWrap.style.cursor = 'pointer';
      iconWrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        playMenuSelectSound(this._world);
        SpinningWeaponActor.triggerGrimGrinder(this._world);
      }, { passive: false });
      this._container.append(iconWrap);
    }

    gc.appendChild(this._container);
  }

  public static async getInstance(world: ENGINE.World | null): Promise<GrimGrinderSkillHUDUI | null> {
    if (!world) {
      return null;
    }
    let inst = GrimGrinderSkillHUDUI.instances.get(world);
    if (!inst) {
      inst = new GrimGrinderSkillHUDUI(world);
      GrimGrinderSkillHUDUI.instances.set(world, inst);
      await inst._initializeAsync();
    }
    return inst;
  }

  private async _initializeAsync(): Promise<void> {
    if (!this._iconEl || !this._container) {
      return;
    }

    const resolved = await ENGINE.resolveAssetPathsInText(ICON_URL);
    this._iconEl.src = resolved;

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
    if (!this._container || !this._iconEl || !this._cooldownOverlay || !this._initialized) {
      return;
    }

    if (!grimVault.hasGrimGrinderUnlocked() || GrimGrinderModeActor.isActive()) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = 'flex';

    const pawn = this._world.getFirstPlayerPawn();
    const progress = pawn instanceof IsometricPlayerPawn ? pawn.grimGrinderSoulProgress : 0;
    const ready = progress >= GRIM_GRINDER_SOUL_THRESHOLD;
    const fillFrac = Math.min(1, progress / GRIM_GRINDER_SOUL_THRESHOLD);

    // Overlay height fills DOWN from full when uncharged, drains to 0 when ready.
    const overlayPct = ((1 - fillFrac) * 100).toFixed(1);
    this._cooldownOverlay.style.height = `${overlayPct}%`;

    if (ready) {
      this._iconEl.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55))';
      this._iconEl.style.opacity = '1';
      if (!this._wasReady) {
        this._container.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(1.12)' },
            { transform: 'scale(1)' },
          ],
          { duration: 180, easing: 'ease-out' },
        );
      }
    } else {
      this._iconEl.style.filter =
        'grayscale(1) brightness(0.5) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45))';
      this._iconEl.style.opacity = '0.72';
    }

    this._wasReady = ready;
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    this._iconEl = null;
    this._cooldownOverlay = null;
    this._initialized = false;
    GrimGrinderSkillHUDUI.instances.delete(this._world);
  }
}
