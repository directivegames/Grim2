/**
 * InnocentHelpMeUI — "HELP ME" bubble above the active innocent when on-screen.
 * Blinks and shakes to draw attention; hidden when off-screen (edge arrow handles that).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const HELPME_URL = '@project/assets/UI/Helpme.png';

/** Extra world Y above the innocent indicator point (head-ish). */
const WORLD_OFFSET_ABOVE = 1.05;

const ON_SCREEN_NDC_MARGIN = 0.08;

const STYLE_ID = 'grim-innocent-helpme-styles';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class InnocentHelpMeUI {
  private static readonly instances = new Map<ENGINE.World, InnocentHelpMeUI>();

  private readonly _world: ENGINE.World | null;
  private _bubble: HTMLDivElement | null = null;
  private _resolvedUrl = '';
  private _visible = false;
  private readonly _scratch = new THREE.Vector3();

  public static getInstance(world: ENGINE.World | null): InnocentHelpMeUI {
    if (!world) {
      return new InnocentHelpMeUI(null);
    }

    let inst = InnocentHelpMeUI.instances.get(world);
    if (!inst) {
      inst = new InnocentHelpMeUI(world);
      InnocentHelpMeUI.instances.set(world, inst);
      void inst._buildDom();
    }
    return inst;
  }

  public static hideForWorld(world: ENGINE.World): void {
    InnocentHelpMeUI.instances.get(world)?.hide();
  }

  private constructor(world: ENGINE.World | null) {
    this._world = world;
  }

  private _gameContainer(): HTMLElement | null {
    if (!this._world) return null;
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private async _buildDom(): Promise<void> {
    const gc = this._gameContainer();
    if (!gc || this._bubble) return;

    InnocentHelpMeUI._injectStyles(gc);

    const css = `url("${HELPME_URL}")`;
    const resolved = await ENGINE.resolveAssetPathsInText(css);
    const match = resolved.match(/url\(["']?([^"')]+)["']?\)/);
    this._resolvedUrl = match?.[1] ?? '';

    this._bubble = document.createElement('div');
    this._bubble.setAttribute('data-innocent-helpme', '');
    this._bubble.style.cssText = `
      position: absolute;
      width: clamp(72px, 14vw, 128px);
      height: clamp(36px, 7vw, 64px);
      pointer-events: none;
      user-select: none;
      z-index: 1005;
      display: none;
      opacity: 0;
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center bottom;
      transform: translate(-50%, -100%);
      transform-origin: 50% 100%;
      will-change: transform, opacity;
      ${this._resolvedUrl ? `background-image: url("${this._resolvedUrl}");` : ''}
    `;
    gc.appendChild(this._bubble);
  }

  public show(): void {
    if (!this._bubble) return;
    this._visible = true;
  }

  public hide(): void {
    this._visible = false;
    if (!this._bubble) return;
    this._bubble.style.display = 'none';
    this._bubble.style.opacity = '0';
  }

  /** Position bubble above innocent; visible only when they are on-screen. */
  public updateTarget(worldPos: THREE.Vector3 | null): void {
    if (!this._visible || !this._bubble || !this._world) return;

    const gc = this._gameContainer();
    const camera = this._world.getActiveCamera();
    if (!gc || !camera || !worldPos) {
      this.hide();
      return;
    }

    this._scratch.copy(worldPos);
    this._scratch.y += WORLD_OFFSET_ABOVE;
    this._scratch.project(camera);

    const rect = gc.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    let sx = (this._scratch.x * 0.5 + 0.5) * w;
    let sy = (-this._scratch.y * 0.5 + 0.5) * h;

    if (this._scratch.z > 1) {
      sx = w * 0.5 + (w * 0.5 - sx);
      sy = h * 0.5 + (h * 0.5 - sy);
    }

    const ndc = this._scratch;
    const onScreen =
      ndc.z > -1 &&
      ndc.z < 1 &&
      ndc.x >= -1 + ON_SCREEN_NDC_MARGIN &&
      ndc.x <= 1 - ON_SCREEN_NDC_MARGIN &&
      ndc.y >= -1 + ON_SCREEN_NDC_MARGIN &&
      ndc.y <= 1 - ON_SCREEN_NDC_MARGIN;

    if (!onScreen) {
      this._bubble.style.display = 'none';
      return;
    }

    this._bubble.style.display = 'block';
    this._bubble.style.left = `${sx}px`;
    this._bubble.style.top = `${sy}px`;
  }

  private static _injectStyles(container: HTMLElement): void {
    if (container.querySelector(`#${STYLE_ID}`)) return;

    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      @keyframes grim-helpme-blink {
        0%, 40% { opacity: 1; }
        50%, 90% { opacity: 0.25; }
        100% { opacity: 1; }
      }
      @keyframes grim-helpme-shake {
        0%, 100% { transform: translate(-50%, -100%) rotate(0deg) scale(1); }
        20% { transform: translate(calc(-50% - 4px), -100%) rotate(-5deg) scale(1.04); }
        40% { transform: translate(calc(-50% + 4px), -100%) rotate(5deg) scale(1.04); }
        60% { transform: translate(calc(-50% - 3px), -100%) rotate(-3deg) scale(1.02); }
        80% { transform: translate(calc(-50% + 3px), -100%) rotate(3deg) scale(1.02); }
      }
      [data-innocent-helpme] {
        animation:
          grim-helpme-blink 1.35s ease-in-out infinite,
          grim-helpme-shake 0.55s ease-in-out infinite;
      }
    `;
    container.appendChild(st);
  }
}
