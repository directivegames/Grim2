/**
 * StartMenuUI — full-screen main menu (PLAY / QUIT) over the game container.
 * PLAY stays disabled until warmup completes; then it highlights and becomes clickable.
 * Transition: grid shards of the menu image fly away (scythe-slash style).
 */
import * as ENGINE from '@gnsx/genesys.js';

const BG_URL = '@project/assets/UI/background.png';
const MENU_PANEL_URL = '@project/assets/UI/menu element.png';

const SHATTER_COLS = 8;
const SHATTER_ROWS = 6;
const SHATTER_DURATION_MS = 880;
const SHATTER_STAGGER_MS = 14;

/** Sync overlay: covers canvas until real menu DOM is ready (see preflightCover). */
const BLOCKER_ATTR = 'data-grim-start-menu-blocker';

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

export class StartMenuUI {
  private static readonly byWorld = new Map<ENGINE.World, StartMenuUI>();

  private readonly _world: ENGINE.World;
  private _root: HTMLDivElement | null = null;
  private _playWrap: HTMLDivElement | null = null;
  private _playLabel: HTMLSpanElement | null = null;
  private _warmupReady = false;
  private _dismissed = false;
  private _resolvedBgUrl = '';
  private _resolvedPanelUrl = '';

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  /**
   * Cover the game container immediately (no await). Call from preStart so the first
   * frames never show an unobstructed canvas; safe to call again from attach().
   */
  public static preflightCover(world: ENGINE.World | null): void {
    const w = world as GameContainerWorld | null;
    const gc = w?.gameContainer;
    if (!gc || w?.options?.headless) {
      return;
    }
    if (gc.querySelector(`[${BLOCKER_ATTR}]`)) {
      return;
    }
    const blocker = document.createElement('div');
    blocker.setAttribute(BLOCKER_ATTR, '');
    blocker.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10045;
      background: #050508;
      pointer-events: none;
    `;
    gc.appendChild(blocker);
  }

  private static _removeBlockersFrom(container: HTMLElement | null): void {
    if (!container) {
      return;
    }
    container.querySelectorAll(`[${BLOCKER_ATTR}]`).forEach(el => el.remove());
  }

  /** Show menu, disable gameplay input, resolve assets. Safe to call once per world. */
  public static attach(world: ENGINE.World): StartMenuUI {
    let inst = StartMenuUI.byWorld.get(world);
    if (inst?._root) {
      return inst;
    }
    if (!inst) {
      inst = new StartMenuUI(world);
      StartMenuUI.byWorld.set(world, inst);
    }
    const w = world as GameContainerWorld;
    if (w.gameContainer && !w.options?.headless) {
      try {
        world.inputManager.setInputEnabled(false);
      } catch {
        /* */
      }
    }
    StartMenuUI.preflightCover(world);
    void inst._mount();
    return inst;
  }

  /** Call when WarmupActor finishes (same moment as former GrimLoadingScreen). */
  public markWarmupComplete(): void {
    this._warmupReady = true;
    this._refreshPlayState();
  }

  private _gameContainer(): HTMLElement | null {
    const w = this._world as GameContainerWorld;
    return w.gameContainer ?? null;
  }

  private _setInput(enabled: boolean): void {
    try {
      this._world.inputManager.setInputEnabled(enabled);
    } catch {
      /* world may be tearing down */
    }
  }

  private async _mount(): Promise<void> {
    const gameContainer = this._gameContainer();
    const w = this._world as GameContainerWorld;
    if (!gameContainer || w.options?.headless) {
      return;
    }

    try {
      this._world.inputManager.setInputEnabled(false);
    } catch {
      /* */
    }

    const css = `
      .sm-bg { background-image: url("${BG_URL}"); }
      .sm-panel { background-image: url("${MENU_PANEL_URL}"); }
    `;
    const resolved = await ENGINE.resolveAssetPathsInText(css);
    const bgM = resolved.match(/\.sm-bg\s*\{[^}]*url\("([^"]+)"/);
    const panelM = resolved.match(/\.sm-panel\s*\{[^}]*url\("([^"]+)"/);
    this._resolvedBgUrl = bgM?.[1] ?? '';
    this._resolvedPanelUrl = panelM?.[1] ?? '';
    if (!this._resolvedBgUrl) {
      StartMenuUI._removeBlockersFrom(gameContainer);
      this._setInput(true);
      return;
    }

    if (this._dismissed) {
      StartMenuUI._removeBlockersFrom(gameContainer);
      this._setInput(true);
      return;
    }

    const root = document.createElement('div');
    root.className = 'grim-start-menu-root';
    root.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10050;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding: clamp(12px, 4vh, 48px);
      box-sizing: border-box;
      user-select: none;
      overflow: hidden;
    `;

    const bg = document.createElement('div');
    bg.style.cssText = `
      position: absolute;
      inset: 0;
      background-image: url("${this._resolvedBgUrl}");
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
    `;

    const vignette = document.createElement('div');
    vignette.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse at 50% 40%, transparent 0%, rgba(0,0,0,0.35) 100%);
    `;

    const bar = document.createElement('div');
    bar.style.cssText = `
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: clamp(10px, 2vh, 22px);
      width: min(520px, 92vw);
      margin-bottom: clamp(8px, 3vh, 36px);
    `;

    const playWrap = document.createElement('div');
    playWrap.style.cssText = `
      position: relative;
      width: 100%;
      min-height: clamp(52px, 12vh, 76px);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: not-allowed;
      transition: filter 0.35s ease, opacity 0.35s ease, transform 0.25s ease;
    `;
    if (this._resolvedPanelUrl) {
      playWrap.style.backgroundImage = `url("${this._resolvedPanelUrl}")`;
      playWrap.style.backgroundSize = '100% 100%';
      playWrap.style.backgroundRepeat = 'no-repeat';
      playWrap.style.backgroundPosition = 'center';
    }

    const playLabel = document.createElement('span');
    playLabel.textContent = 'PLAY';
    playLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(1.15rem, 4.2vw, 1.65rem);
      letter-spacing: 0.22em;
      color: rgba(200, 210, 220, 0.55);
      text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      pointer-events: none;
    `;
    playWrap.appendChild(playLabel);
    playWrap.addEventListener('click', () => this._onPlayClicked());

    const quitWrap = document.createElement('div');
    quitWrap.style.cssText = `
      position: relative;
      width: 100%;
      min-height: clamp(48px, 10vh, 68px);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.2s ease;
    `;
    if (this._resolvedPanelUrl) {
      quitWrap.style.backgroundImage = `url("${this._resolvedPanelUrl}")`;
      quitWrap.style.backgroundSize = '100% 100%';
      quitWrap.style.backgroundRepeat = 'no-repeat';
      quitWrap.style.backgroundPosition = 'center';
      quitWrap.style.filter = 'brightness(0.82)';
    }
    const quitLabel = document.createElement('span');
    quitLabel.textContent = 'QUIT';
    quitLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.95rem, 3.5vw, 1.25rem);
      letter-spacing: 0.28em;
      color: rgba(220, 228, 236, 0.88);
      text-shadow: 0 1px 3px rgba(0,0,0,0.95);
    `;
    quitWrap.appendChild(quitLabel);
    quitWrap.addEventListener('click', () => this._onQuit());
    quitWrap.addEventListener('mouseenter', () => {
      quitWrap.style.transform = 'scale(1.03)';
      quitWrap.style.filter = 'brightness(1.05)';
    });
    quitWrap.addEventListener('mouseleave', () => {
      quitWrap.style.transform = 'scale(1)';
      quitWrap.style.filter = 'brightness(0.82)';
    });

    bar.appendChild(playWrap);
    bar.appendChild(quitWrap);
    root.appendChild(bg);
    root.appendChild(vignette);
    root.appendChild(bar);

    gameContainer.appendChild(root);
    StartMenuUI._removeBlockersFrom(gameContainer);

    this._root = root;
    this._playWrap = playWrap;
    this._playLabel = playLabel;
    this._refreshPlayState();
  }

  private _refreshPlayState(): void {
    const wrap = this._playWrap;
    const label = this._playLabel;
    if (!wrap || !label) {
      return;
    }
    if (this._warmupReady) {
      wrap.style.cursor = 'pointer';
      wrap.style.opacity = '1';
      wrap.style.filter = 'none';
      wrap.style.pointerEvents = 'auto';
      label.style.color = 'rgba(160, 245, 255, 0.98)';
      label.style.textShadow = '0 0 18px rgba(0, 220, 255, 0.55), 0 2px 4px rgba(0,0,0,0.95)';
    } else {
      wrap.style.cursor = 'not-allowed';
      wrap.style.opacity = '0.5';
      wrap.style.filter = 'grayscale(1) brightness(0.72)';
      wrap.style.pointerEvents = 'none';
      label.style.color = 'rgba(160, 170, 180, 0.45)';
      label.style.textShadow = '0 1px 2px rgba(0,0,0,0.85)';
    }
  }

  private _onPlayClicked(): void {
    if (!this._warmupReady || this._dismissed || !this._root) {
      return;
    }
    this._dismissed = true;
    const gameContainer = this._gameContainer();
    const root = this._root;
    if (!gameContainer || !this._resolvedBgUrl) {
      this._teardownAfterTransition();
      return;
    }

    const rect = root.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    const shatter = document.createElement('div');
    shatter.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10060;
      pointer-events: none;
      overflow: hidden;
    `;

    const shardStyleId = 'grim-start-menu-shard-keyframes';
    if (!gameContainer.querySelector(`#${shardStyleId}`)) {
      const st = document.createElement('style');
      st.id = shardStyleId;
      st.textContent = `
        @keyframes grim-shard-a {
          to {
            transform: translate(18vw, -42vh) rotate(22deg) scale(0.92);
            opacity: 0;
          }
        }
        @keyframes grim-shard-b {
          to {
            transform: translate(-22vw, 48vh) rotate(-26deg) scale(0.88);
            opacity: 0;
          }
        }
      `;
      gameContainer.appendChild(st);
    }

    const cellW = w / SHATTER_COLS;
    const cellH = h / SHATTER_ROWS;
    const bgW = SHATTER_COLS * 100;
    const bgH = SHATTER_ROWS * 100;

    for (let j = 0; j < SHATTER_ROWS; j++) {
      for (let i = 0; i < SHATTER_COLS; i++) {
        const shard = document.createElement('div');
        const nx = (i + 0.5) / SHATTER_COLS;
        const ny = (j + 0.5) / SHATTER_ROWS;
        const slashSide = nx + ny > 1;

        shard.style.cssText = `
          position: absolute;
          left: ${i * cellW}px;
          top: ${j * cellH}px;
          width: ${cellW + 0.5}px;
          height: ${cellH + 0.5}px;
          background-image: url("${this._resolvedBgUrl}");
          background-size: ${bgW}% ${bgH}%;
          background-position: ${(i / Math.max(1, SHATTER_COLS - 1)) * 100}% ${(j / Math.max(1, SHATTER_ROWS - 1)) * 100}%;
          background-repeat: no-repeat;
          will-change: transform, opacity;
          animation-name: ${slashSide ? 'grim-shard-a' : 'grim-shard-b'};
          animation-duration: ${SHATTER_DURATION_MS * 0.001}s;
          animation-timing-function: cubic-bezier(0.4, 0.0, 0.2, 1);
          animation-fill-mode: forwards;
          animation-delay: ${(i + j) * SHATTER_STAGGER_MS * 0.001}s;
        `;
        shatter.appendChild(shard);
      }
    }

    root.style.visibility = 'hidden';
    gameContainer.appendChild(shatter);

    const totalMs =
      SHATTER_DURATION_MS + (SHATTER_COLS + SHATTER_ROWS - 2) * SHATTER_STAGGER_MS + 120;
    window.setTimeout(() => {
      shatter.remove();
      this._teardownAfterTransition();
    }, totalMs);
  }

  private _onQuit(): void {
    window.close();
  }

  private _teardownAfterTransition(): void {
    StartMenuUI._removeBlockersFrom(this._gameContainer());
    if (this._root?.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    this._playWrap = null;
    this._playLabel = null;
    StartMenuUI.byWorld.delete(this._world);
    this._setInput(true);
  }

  public destroy(): void {
    this._dismissed = true;
    StartMenuUI._removeBlockersFrom(this._gameContainer());
    if (this._root?.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    this._playWrap = null;
    this._playLabel = null;
    StartMenuUI.byWorld.delete(this._world);
    this._setInput(true);
  }
}
