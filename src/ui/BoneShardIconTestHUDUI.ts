/**
 * BoneShardIconTestHUDUI — Bone Shard icon above health bar (clone of FistAbilityHUDUI).
 */
import * as ENGINE from '@gnsx/genesys.js';

const BONE_SHARD_ICON_URL = '@project/assets/UI/Boneshard.png';

/** Match HealthBarUI placement. */
const HEALTH_BAR_BOTTOM = 20;
const HEALTH_BAR_HEIGHT = 235 * 0.35;
const ICON_SIZE = 52;
const GAP_ABOVE_HEALTH = 10;
const GAP_BESIDE_FIST = 12;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class BoneShardIconTestHUDUI {
  private static readonly instances = new Map<ENGINE.World, BoneShardIconTestHUDUI>();

  private readonly _world: ENGINE.World;
  private _container: HTMLDivElement | null = null;
  private _iconEl: HTMLImageElement | null = null;
  private _initialized = false;

  private constructor(world: ENGINE.World) {
    this._world = world;
    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return;
    }

    const bottom = HEALTH_BAR_BOTTOM + HEALTH_BAR_HEIGHT + GAP_ABOVE_HEALTH;
    const left = 36 + ICON_SIZE + GAP_BESIDE_FIST;

    this._container = document.createElement('div');
    this._container.setAttribute('data-grim-bone-shard-icon-test', '');
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

    const keyHint = document.createElement('span');
    keyHint.textContent = 'BONE';
    keyHint.style.cssText = `
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.06em;
      color: rgba(220, 210, 200, 0.95);
      text-shadow:
        0 0 6px rgba(0, 0, 0, 0.9),
        0 1px 2px rgba(0, 0, 0, 0.85);
    `;

    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = `
      position: relative;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
    `;

    this._iconEl = document.createElement('img');
    this._iconEl.alt = 'Bone Shard';
    this._iconEl.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      transition: filter 0.15s ease, opacity 0.15s ease;
      filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
    `;

    iconWrap.append(this._iconEl);
    this._container.append(keyHint, iconWrap);
    gc.appendChild(this._container);
  }

  public static async getInstance(world: ENGINE.World | null): Promise<BoneShardIconTestHUDUI | null> {
    if (!world) {
      return null;
    }

    let inst = BoneShardIconTestHUDUI.instances.get(world);
    if (!inst) {
      inst = new BoneShardIconTestHUDUI(world);
      BoneShardIconTestHUDUI.instances.set(world, inst);
      await inst._initializeAsync();
    }
    return inst;
  }

  private async _initializeAsync(): Promise<void> {
    if (!this._iconEl || !this._container) {
      return;
    }

    const resolved = await ENGINE.resolveAssetPathsInText(BONE_SHARD_ICON_URL);
    this._iconEl.src = resolved;

    // Stay mounted + loaded for shop/cache test, but invisible to the player.
    this._container.style.display = 'flex';
    this._container.style.opacity = '0';
    this._container.style.visibility = 'hidden';
    this._initialized = true;
  }

  public tick(): void {
    if (!this._container || !this._iconEl || !this._initialized) {
      return;
    }
    this._container.style.display = 'flex';
  }

  public destroy(): void {
    this._container?.remove();
    this._container = null;
    this._iconEl = null;
    this._initialized = false;
    BoneShardIconTestHUDUI.instances.delete(this._world);
  }
}
