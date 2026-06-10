/**
 * SoulThrowHUDUI — Soul Throw icon next to the E skill, with RMB key hint on desktop.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { SOUL_THROW_COOLDOWN_L3, SpinningWeaponActor } from '../actors/SpinningWeaponActor.js';
import { grimVault } from '../game/GrimVault.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { ensureMobileHudStyles } from './mobile-hud-layout.js';
import { playMenuSelectSound } from '../utils/menu-audio.js';

const SOUL_THROW_ICON_URL = '@project/assets/UI/soulthrow.webp';

const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const ICON_SIZE = 64;
const GAP_ABOVE_HEALTH = 10;
/** Horizontal gap between the Fist (E) icon and this icon. */
const FIST_ICON_LEFT = 36;
const FIST_ICON_SIZE = 80;
const ICON_HORIZONTAL_GAP = 8;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class SoulThrowHUDUI {
  private static readonly instances = new Map<ENGINE.World, SoulThrowHUDUI>();

  private readonly _world: ENGINE.World;
  private _container: HTMLDivElement | null = null;
  private _iconEl: HTMLImageElement | null = null;
  private _cooldownOverlay: HTMLDivElement | null = null;
  private _initialized = false;
  private _wasBlocked = false;

  private constructor(world: ENGINE.World) {
    this._world = world;
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    ensureMobileHudStyles(gc);

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH;
    const left = FIST_ICON_LEFT + FIST_ICON_SIZE + ICON_HORIZONTAL_GAP;

    this._container = document.createElement('div');
    this._container.className = 'grim-hud-soul-throw';
    this._container.style.cssText = `
      position: absolute;
      bottom: ${bottom}px;
      left: ${left}px;
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
    keyHint.textContent = 'RMB';
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
    this._iconEl.alt = 'Soul Throw';
    this._iconEl.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      transition: filter 0.15s ease, opacity 0.15s ease;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
    `;

    this._cooldownOverlay = document.createElement('div');
    this._cooldownOverlay.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 0%;
      background: rgba(8, 6, 12, 0.55);
      border-radius: 4px;
      pointer-events: none;
      transition: height 0.08s linear;
    `;

    iconWrap.append(this._iconEl, this._cooldownOverlay);

    if (mobile) {
      iconWrap.style.pointerEvents = 'auto';
      iconWrap.style.touchAction = 'manipulation';
      iconWrap.style.cursor = 'pointer';
      iconWrap.addEventListener('touchstart', (e) => {
        e.preventDefault();
        playMenuSelectSound(this._world);
        SpinningWeaponActor.triggerSoulThrow(this._world);
      }, { passive: false });
      this._container.append(iconWrap);
    } else {
      this._container.append(keyHint, iconWrap);
    }

    gc.appendChild(this._container);
  }

  public static async getInstance(world: ENGINE.World | null): Promise<SoulThrowHUDUI | null> {
    if (!world) {
      return null;
    }

    let inst = SoulThrowHUDUI.instances.get(world);
    if (!inst) {
      inst = new SoulThrowHUDUI(world);
      SoulThrowHUDUI.instances.set(world, inst);
      await inst._initializeAsync();
    }
    return inst;
  }

  private async _initializeAsync(): Promise<void> {
    if (!this._iconEl || !this._container) {
      return;
    }

    const resolved = await ENGINE.resolveAssetPathsInText(SOUL_THROW_ICON_URL);
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

    const skillLevel = grimVault.getSkillLevel('soulThrow');
    if (skillLevel < 1) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = 'flex';

    const weapon = SpinningWeaponActor.findInWorld(this._world);
    const cdRemaining = weapon?.getSoulThrowCooldownRemaining() ?? 0;
    const inFlight = weapon?.hasSoulBladesInFlight() ?? false;
    const soulThrowLevel = weapon?.getSoulThrowSkillLevel() ?? skillLevel;
    const meleeBusy = weapon?.isMeleeBusy() ?? false;

    const isBlocked =
      cdRemaining > 0
      || inFlight
      || (meleeBusy && soulThrowLevel < 3);
    const cdFraction = cdRemaining > 0 ? cdRemaining / SOUL_THROW_COOLDOWN_L3 : 0;

    if (isBlocked) {
      this._iconEl.style.filter =
        'grayscale(1) brightness(0.5) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45))';
      this._iconEl.style.opacity = '0.72';
    } else {
      this._iconEl.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55))';
      this._iconEl.style.opacity = '1';
    }

    this._cooldownOverlay.style.height = `${(cdFraction * 100).toFixed(1)}%`;

    if (isBlocked !== this._wasBlocked && !isBlocked) {
      this._container.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.12)' },
          { transform: 'scale(1)' },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
    this._wasBlocked = isBlocked;
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    this._iconEl = null;
    this._cooldownOverlay = null;
    this._initialized = false;
    SoulThrowHUDUI.instances.delete(this._world);
  }
}
