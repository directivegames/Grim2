/**
 * Grim Grinder HUD — F key hint and run-soul progress toward 50.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { GrimGrinderModeActor } from '../actors/GrimGrinderModeActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import {
  GRIM_GRINDER_SKILL_ID,
  GRIM_GRINDER_SOUL_THRESHOLD,
} from '../data/grim-grinder-config.js';
import { grimVault } from '../game/GrimVault.js';

const ICON_URL = '@project/assets/UI/grimtitle.webp';

const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const ICON_SIZE = 52;
const GAP_ABOVE_HEALTH = 10;
const FIST_STACK_OFFSET = ICON_SIZE + 24;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class GrimGrinderHUDUI {
  private static readonly instances = new Map<ENGINE.World, GrimGrinderHUDUI>();

  private readonly _world: ENGINE.World;
  private _container: HTMLDivElement | null = null;
  private _progressEl: HTMLDivElement | null = null;
  private _fillEl: HTMLDivElement | null = null;
  private _initialized = false;

  private constructor(world: ENGINE.World) {
    this._world = world;
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH + FIST_STACK_OFFSET;

    this._container = document.createElement('div');
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
      will-change: opacity;
    `;

    const keyHint = document.createElement('span');
    keyHint.textContent = 'F';
    keyHint.style.cssText = `
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.06em;
      color: rgba(200, 240, 255, 0.95);
      text-shadow: 0 0 8px rgba(0, 200, 255, 0.45);
    `;

    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = `width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;`;

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

    iconWrap.append(icon);

    this._progressEl = document.createElement('div');
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

    this._container.append(keyHint, iconWrap, this._progressEl);
    gc.appendChild(this._container);
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
    }
    return inst;
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

    const equipped = grimVault.getSkillLevel(GRIM_GRINDER_SKILL_ID) >= 1;
    if (!equipped || GrimGrinderModeActor.isActive()) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = 'flex';

    const pawn = this._world.getFirstPlayerPawn();
    const progress = pawn instanceof IsometricPlayerPawn ? pawn.grimGrinderSoulProgress : 0;
    const frac = Math.min(1, progress / GRIM_GRINDER_SOUL_THRESHOLD);
    this._fillEl.style.width = `${(frac * 100).toFixed(1)}%`;

    const ready = progress >= GRIM_GRINDER_SOUL_THRESHOLD;
    this._container.style.filter = ready ? 'none' : 'brightness(0.75)';
    this._container.style.opacity = ready ? '1' : '0.88';
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    GrimGrinderHUDUI.instances.delete(this._world);
  }
}
