/**
 * FistAbilityHUDUI — Fist of Annoyance icon above the health bar with E key hint.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { FIST_COOLDOWN_SEC, SpinningWeaponActor } from '../actors/SpinningWeaponActor.js';
import { grimVault } from '../game/GrimVault.js';

const FIST_ICON_URL = '@project/assets/UI/fistofa.webp';

/** Match HealthBarUI placement. */
const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const ICON_SIZE = 52;
const GAP_ABOVE_HEALTH = 10;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class FistAbilityHUDUI {
  private static readonly instances = new Map<ENGINE.World, FistAbilityHUDUI>();

  private readonly _world: ENGINE.World;
  private _container: HTMLDivElement | null = null;
  private _iconEl: HTMLImageElement | null = null;
  private _cooldownOverlay: HTMLDivElement | null = null;
  private _initialized = false;
  private _wasOnCooldown = false;

  private constructor(world: ENGINE.World) {
    this._world = world;
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH;

    this._container = document.createElement('div');
    this._container.style.cssText = `
      position: absolute;
      bottom: ${bottom}px;
      left: 36px;
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

    const keyHint = document.createElement('span');
    keyHint.textContent = 'E';
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
    iconWrap.style.cssText = `
      position: relative;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
    `;

    this._iconEl = document.createElement('img');
    this._iconEl.alt = 'Fist of Annoyance';
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
    this._container.append(keyHint, iconWrap);
    gc.appendChild(this._container);
  }

  public static async getInstance(world: ENGINE.World | null): Promise<FistAbilityHUDUI | null> {
    if (!world) {
      return null;
    }

    let inst = FistAbilityHUDUI.instances.get(world);
    if (!inst) {
      inst = new FistAbilityHUDUI(world);
      FistAbilityHUDUI.instances.set(world, inst);
      await inst._initializeAsync();
    }
    return inst;
  }

  private async _initializeAsync(): Promise<void> {
    if (!this._iconEl || !this._container) {
      return;
    }

    const resolved = await ENGINE.resolveAssetPathsInText(FIST_ICON_URL);
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

    const equipped = grimVault.getSkillLevel('fistOfAnnoyance') >= 1;
    if (!equipped) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = 'flex';

    const weapon = SpinningWeaponActor.findInWorld(this._world);
    const remaining = weapon?.getFistCooldownRemaining() ?? 0;
    const onCooldown = remaining > 0;
    const cdFraction = onCooldown ? remaining / FIST_COOLDOWN_SEC : 0;

    if (onCooldown) {
      this._iconEl.style.filter =
        'grayscale(1) brightness(0.5) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45))';
      this._iconEl.style.opacity = '0.72';
    } else {
      this._iconEl.style.filter = 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55))';
      this._iconEl.style.opacity = '1';
    }

    this._cooldownOverlay.style.height = `${(cdFraction * 100).toFixed(1)}%`;

    if (onCooldown !== this._wasOnCooldown && !onCooldown) {
      this._container.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.12)' },
          { transform: 'scale(1)' },
        ],
        { duration: 180, easing: 'ease-out' },
      );
    }
    this._wasOnCooldown = onCooldown;
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    this._iconEl = null;
    this._cooldownOverlay = null;
    this._initialized = false;
    FistAbilityHUDUI.instances.delete(this._world);
  }
}
