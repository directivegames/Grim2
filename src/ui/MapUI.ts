/**
 * MapUI — Burdenville level-select map after Grim's Room intro.
 * Only selectable missions can be started; others show "Coming Soon".
 */
import * as ENGINE from '@gnsx/genesys.js';

import { GRIM_INTRO_BLACK_COVER_ATTR } from '../actors/GrimIntroActor.js';
import { MapMusicActor } from '../actors/MapMusicActor.js';
import { MISSIONS, type MissionDef } from '../data/missions.js';
import { withMenuSelectSound } from '../utils/menu-audio.js';
import { fadeInElement, fadeOutIntroBlackCover } from '../utils/screen-transition.js';

const MAP_BG_URL = '@project/assets/UI/Burdenvillemaponly.png';
const COMPASS_URL = '@project/assets/UI/compass.png';
const MENU_PANEL_URL = '@project/assets/UI/menu element.png';
const OPTIONS_FRAME_URL = '@project/assets/UI/optionsbackground.png';

const MAP_OVERLAY_ATTR = 'data-grim-map-ui';

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

function missionIconPath(iconFile: string): string {
  return `@project/assets/UI/${iconFile}`;
}

function extractUrlFromCss(text: string): string | null {
  const match = text.match(/url\(["']([^"']+)["']\)/);
  return match?.[1] ?? null;
}

/** Resolve a single @project asset path to a browser URL (same pattern as ReadyToReapUI). */
async function resolveAssetUrl(projectPath: string): Promise<string> {
  const direct = (await ENGINE.resolveAssetPathsInText(projectPath)).trim();
  if (direct && !direct.includes('@project')) {
    return direct;
  }

  const fromCss = extractUrlFromCss(
    await ENGINE.resolveAssetPathsInText(`url("${projectPath}")`),
  );
  const url = (fromCss ?? '').trim();
  return url.includes('@project') ? '' : url;
}

export class MapUI {
  private static readonly byWorld = new Map<ENGINE.World, MapUI>();

  private readonly _world: ENGINE.World;
  private _root: HTMLDivElement | null = null;
  private _briefing: HTMLDivElement | null = null;
  private _onMissionStart: ((mission: MissionDef) => void) | null = null;
  private _resolvedMapUrl = '';
  private _resolvedCompassUrl = '';
  private _resolvedPanelUrl = '';
  private _resolvedFrameUrl = '';
  private readonly _resolvedIconUrls = new Map<string, string>();

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static isOpen(world: ENGINE.World): boolean {
    const inst = MapUI.byWorld.get(world);
    return Boolean(inst?._root);
  }

  /**
   * Show the Burdenville map. Calls `onMissionStart` when the player confirms a selectable mission.
   */
  public static open(
    world: ENGINE.World,
    onMissionStart: (mission: MissionDef) => void,
  ): MapUI {
    const w = world as GameContainerWorld;
    if (!w.gameContainer || w.options?.headless) {
      const fallback = MISSIONS.find(m => m.selectable) ?? MISSIONS[2]!;
      onMissionStart(fallback);
      return new MapUI(world);
    }

    let inst = MapUI.byWorld.get(world);
    if (inst?._root) {
      inst._onMissionStart = onMissionStart;
      return inst;
    }

    if (!inst) {
      inst = new MapUI(world);
      MapUI.byWorld.set(world, inst);
    }

    inst._onMissionStart = onMissionStart;
    void inst._mount();
    return inst;
  }

  public static close(world: ENGINE.World): void {
    MapUI.byWorld.get(world)?.destroy();
  }

  private _gameContainer(): HTMLElement | null {
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private async _mount(): Promise<void> {
    const gameContainer = this._gameContainer();
    if (!gameContainer) {
      return;
    }

    try {
      this._world.inputManager.setInputEnabled(false);
    } catch {
      /* */
    }

    const [mapUrl, compassUrl, panelUrl, frameUrl, ...missionIconUrls] = await Promise.all([
      resolveAssetUrl(MAP_BG_URL),
      resolveAssetUrl(COMPASS_URL),
      resolveAssetUrl(MENU_PANEL_URL),
      resolveAssetUrl(OPTIONS_FRAME_URL),
      ...MISSIONS.map(m => resolveAssetUrl(missionIconPath(m.iconFile))),
    ]);
    this._resolvedMapUrl = mapUrl;
    this._resolvedCompassUrl = compassUrl;
    this._resolvedPanelUrl = panelUrl;
    this._resolvedFrameUrl = frameUrl;
    for (let i = 0; i < MISSIONS.length; i++) {
      this._resolvedIconUrls.set(MISSIONS[i]!.id, missionIconUrls[i] ?? '');
    }

    const root = document.createElement('div');
    root.setAttribute(MAP_OVERLAY_ATTR, '');
    root.className = 'grim-map-root';
    root.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10065;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #050508;
      box-sizing: border-box;
      user-select: none;
      overflow: hidden;
    `;

    const mapWrap = document.createElement('div');
    mapWrap.style.cssText = `
      position: relative;
      width: min(96vw, 140vh * 1.45);
      max-height: 96vh;
      aspect-ratio: 1.45 / 1;
    `;

    const mapImg = document.createElement('div');
    mapImg.style.cssText = `
      position: absolute;
      inset: 0;
      background-image: url("${this._resolvedMapUrl}");
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
    `;
    mapWrap.appendChild(mapImg);

    const vignette = document.createElement('div');
    vignette.className = 'grim-map-vignette';
    mapWrap.appendChild(vignette);

    const scanlines = document.createElement('div');
    scanlines.className = 'grim-map-scanlines';
    mapWrap.appendChild(scanlines);

    const markersLayer = document.createElement('div');
    markersLayer.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
    `;

    MISSIONS.forEach((mission, index) => {
      markersLayer.appendChild(this._createMarker(mission, index));
    });
    mapWrap.appendChild(markersLayer);

    const compass = document.createElement('div');
    compass.className = 'grim-map-compass';
    compass.style.cssText = `
      position: absolute;
      left: 2%;
      bottom: 4%;
      width: clamp(56px, 8vw, 88px);
      height: clamp(56px, 8vw, 88px);
      background-image: url("${this._resolvedCompassUrl}");
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      pointer-events: none;
      opacity: 0.95;
    `;
    mapWrap.appendChild(compass);

    root.appendChild(mapWrap);
    gameContainer.appendChild(root);
    this._root = root;

    MapUI._injectStyles(gameContainer);
    MapMusicActor.ensurePlaying(this._world);

    const introCover = gameContainer.querySelector(
      `[${GRIM_INTRO_BLACK_COVER_ATTR}]`,
    ) as HTMLElement | null;
    if (introCover) {
      introCover.style.transition = 'opacity 0.52s ease';
    }

    fadeInElement(root, 480);
    void fadeOutIntroBlackCover(this._world, 520);
  }

  private _createMarker(mission: MissionDef, markerIndex: number): HTMLDivElement {
    const wrap = document.createElement('div');
    const iconResolved = this._resolvedIconUrls.get(mission.id) ?? '';
    const selectable = mission.selectable;

    wrap.className = 'grim-map-marker-enter';
    wrap.style.cssText = `
      position: absolute;
      left: ${mission.mapX * 100}%;
      top: ${mission.mapY * 100}%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: clamp(4px, 0.5vw, 8px);
      pointer-events: auto;
      cursor: ${selectable ? 'pointer' : 'not-allowed'};
      z-index: 3;
      max-width: min(40vw, 320px);
      opacity: 0;
      animation: grim-map-marker-in 0.5s ease forwards;
      animation-delay: ${120 + markerIndex * 70}ms;
    `;

    const iconEl = document.createElement('div');
    iconEl.setAttribute('role', selectable ? 'button' : 'img');
    iconEl.setAttribute('aria-label', mission.mapTitle);
    iconEl.style.cssText = `
      flex-shrink: 0;
      width: clamp(72px, 12vw, 140px);
      height: clamp(40px, 7vw, 72px);
      background-image: ${iconResolved ? `url("${iconResolved}")` : 'none'};
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      pointer-events: none;
      opacity: 0.95;
      filter: ${selectable ? 'none' : 'grayscale(0.85) brightness(0.55)'};
      transition: transform 0.2s ease, filter 0.2s ease;
    `;
    if (selectable) {
      iconEl.className = 'grim-map-icon-pulse';
    }
    wrap.appendChild(iconEl);

    const plaque = document.createElement('div');
    plaque.style.cssText = `
      position: relative;
      background: rgba(12, 14, 18, 0.92);
      border: 1px solid rgba(120, 140, 160, 0.45);
      padding: 6px 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.6);
      pointer-events: none;
    `;

    const title = document.createElement('div');
    title.textContent = mission.mapTitle;
    title.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(0.45rem, 1.1vw, 0.62rem);
      letter-spacing: 0.08em;
      color: rgba(220, 228, 236, 0.95);
      line-height: 1.2;
    `;

    const tagline = document.createElement('div');
    tagline.textContent = mission.mapTagline;
    tagline.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 600;
      font-size: clamp(0.38rem, 0.9vw, 0.5rem);
      letter-spacing: 0.04em;
      color: rgba(160, 170, 180, 0.88);
      margin-top: 2px;
      line-height: 1.25;
    `;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      margin-top: 4px;
      padding: 2px 6px;
      background: rgba(0, 0, 0, 0.75);
      border: 1px solid rgba(0, 220, 255, 0.35);
      font-family: Montserrat, system-ui, sans-serif;
      font-size: clamp(0.4rem, 0.85vw, 0.5rem);
      letter-spacing: 0.12em;
      color: rgba(160, 245, 255, 0.95);
      white-space: nowrap;
      text-align: center;
      opacity: 0;
      max-height: 0;
      overflow: hidden;
      transition: opacity 0.15s ease, max-height 0.15s ease, margin-top 0.15s ease;
    `;
    tooltip.textContent = selectable ? 'SELECT' : 'COMING SOON';

    plaque.appendChild(title);
    plaque.appendChild(tagline);
    plaque.appendChild(tooltip);
    wrap.appendChild(plaque);

    wrap.addEventListener('mouseenter', () => {
      tooltip.style.opacity = '1';
      tooltip.style.maxHeight = '24px';
      tooltip.style.marginTop = '4px';
      if (selectable) {
        iconEl.style.transform = 'scale(1.1)';
        iconEl.style.filter = 'brightness(1.15) drop-shadow(0 0 12px rgba(0, 220, 255, 0.5))';
        iconEl.classList.remove('grim-map-icon-glitch');
        void iconEl.offsetWidth;
        iconEl.classList.add('grim-map-icon-glitch');
      }
    });
    wrap.addEventListener('mouseleave', () => {
      tooltip.style.opacity = '0';
      tooltip.style.maxHeight = '0';
      tooltip.style.marginTop = '0';
      if (selectable) {
        iconEl.style.transform = 'scale(1)';
        iconEl.style.filter = 'none';
      }
    });

    if (selectable) {
      wrap.addEventListener('click', () => {
        this._showBriefing(mission);
      });
    }

    return wrap;
  }

  private _showBriefing(mission: MissionDef): void {
    const gameContainer = this._gameContainer();
    if (!gameContainer || !mission.selectable) {
      return;
    }

    this._closeBriefing();

    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10070;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(5, 5, 8, 0.75);
      padding: clamp(12px, 3vw, 28px);
      box-sizing: border-box;
    `;

    const frameStyle = this._resolvedFrameUrl
      ? `
        background-image: url("${this._resolvedFrameUrl}");
        background-size: 100% 100%;
        background-repeat: no-repeat;
        background-position: center;
      `
      : `
        background: #0d1117;
        border: 2px solid rgba(100, 160, 200, 0.25);
      `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: relative;
      width: min(480px, 92vw);
      box-sizing: border-box;
      ${frameStyle}
      padding: clamp(36px, 5vh, 48px) clamp(24px, 4vw, 36px) clamp(28px, 4vh, 36px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    const heading = document.createElement('h2');
    heading.textContent = mission.name;
    heading.style.cssText = `
      margin: 0;
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 800;
      font-size: clamp(1rem, 2.4vw, 1.35rem);
      letter-spacing: 0.12em;
      color: rgba(160, 245, 255, 0.98);
      text-align: center;
      text-shadow: 0 0 18px rgba(0, 220, 255, 0.45);
    `;

    const sub = document.createElement('p');
    sub.textContent =
      mission.briefingSubline ?? `${mission.subtitle} · ${mission.difficulty}`;
    sub.style.cssText = `
      margin: 0;
      text-align: center;
      font-family: Montserrat, system-ui, sans-serif;
      font-size: clamp(0.65rem, 1.4vw, 0.78rem);
      letter-spacing: 0.14em;
      color: rgba(200, 210, 220, 0.85);
    `;

    const desc = document.createElement('p');
    desc.textContent = mission.description;
    desc.style.cssText = `
      margin: 8px 0 0;
      font-family: Montserrat, system-ui, sans-serif;
      font-size: clamp(0.7rem, 1.5vw, 0.82rem);
      line-height: 1.45;
      color: rgba(180, 190, 200, 0.9);
      text-align: center;
    `;

    const objList = document.createElement('ul');
    objList.style.cssText = `
      margin: 8px 0 0;
      padding: 0 0 0 1.2em;
      font-family: Montserrat, system-ui, sans-serif;
      font-size: clamp(0.62rem, 1.3vw, 0.75rem);
      color: rgba(160, 170, 180, 0.9);
      line-height: 1.5;
    `;
    for (const obj of mission.objectives) {
      const li = document.createElement('li');
      li.textContent = obj;
      objList.appendChild(li);
    }

    const btnRow = document.createElement('div');
    btnRow.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 16px;
      align-items: center;
    `;

    btnRow.appendChild(this._createPanelButton('START', () => {
      this._confirmMission(mission);
    }, true));

    btnRow.appendChild(this._createPanelButton('BACK', () => {
      this._closeBriefing();
    }, false));

    panel.appendChild(heading);
    panel.appendChild(sub);
    panel.appendChild(desc);
    if (mission.objectives.length > 0) {
      panel.appendChild(objList);
    }
    panel.appendChild(btnRow);
    backdrop.appendChild(panel);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this._closeBriefing();
      }
    });

    gameContainer.appendChild(backdrop);
    this._briefing = backdrop;
  }

  private _createPanelButton(
    label: string,
    onClick: () => void,
    highlight: boolean,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position: relative;
      width: min(280px, 78%);
      aspect-ratio: 3.4 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s ease, filter 0.2s ease;
    `;
    if (this._resolvedPanelUrl) {
      wrap.style.backgroundImage = `url("${this._resolvedPanelUrl}")`;
      wrap.style.backgroundSize = '100% auto';
      wrap.style.backgroundRepeat = 'no-repeat';
      wrap.style.backgroundPosition = 'center';
    }

    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: ${highlight ? 800 : 700};
      font-size: clamp(0.65rem, 1.7vw, 0.88rem);
      letter-spacing: 0.22em;
      color: ${highlight ? 'rgba(160, 245, 255, 0.98)' : 'rgba(220, 228, 236, 0.92)'};
      text-shadow: ${highlight
        ? '0 0 18px rgba(0, 220, 255, 0.55), 0 2px 4px rgba(0,0,0,0.95)'
        : '0 1px 3px rgba(0,0,0,0.95)'};
      pointer-events: none;
    `;
    wrap.appendChild(text);
    wrap.addEventListener('click', withMenuSelectSound(this._world, onClick));
    wrap.addEventListener('mouseenter', () => {
      wrap.style.transform = 'scale(1.03)';
    });
    wrap.addEventListener('mouseleave', () => {
      wrap.style.transform = 'scale(1)';
    });
    return wrap;
  }

  private _confirmMission(mission: MissionDef): void {
    const cb = this._onMissionStart;
    this.destroy();
    cb?.(mission);
  }

  private _closeBriefing(): void {
    this._briefing?.remove();
    this._briefing = null;
  }

  public destroy(): void {
    this._closeBriefing();
    if (this._root?.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
    MapUI.byWorld.delete(this._world);
    MapMusicActor.stopAll(this._world);
  }

  private static _injectStyles(container: HTMLElement): void {
    const id = 'grim-map-ui-styles';
    if (container.querySelector(`#${id}`)) {
      return;
    }
    const st = document.createElement('style');
    st.id = id;
    st.textContent = `
      @keyframes grim-map-pulse {
        0%, 100% { filter: brightness(1) drop-shadow(0 0 6px rgba(0, 220, 255, 0.35)); }
        50% { filter: brightness(1.12) drop-shadow(0 0 14px rgba(0, 220, 255, 0.65)); }
      }
      @keyframes grim-map-marker-in {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      @keyframes grim-map-compass-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes grim-map-icon-glitch {
        0%, 100% { transform: scale(1.1) translateX(0); }
        25% { transform: scale(1.1) translateX(-3px); }
        75% { transform: scale(1.1) translateX(3px); }
      }
      .grim-map-icon-pulse {
        animation: grim-map-pulse 2s ease-in-out infinite;
      }
      .grim-map-icon-glitch {
        animation: grim-map-icon-glitch 0.14s ease-out 1;
      }
      .grim-map-compass {
        animation: grim-map-compass-spin 90s linear infinite;
        transform-origin: 50% 55%;
      }
      .grim-map-vignette {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(ellipse at 50% 45%, transparent 35%, rgba(0,0,0,0.55) 100%);
        z-index: 1;
      }
      .grim-map-scanlines {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
        opacity: 0.07;
        background: repeating-linear-gradient(
          0deg,
          transparent,
          transparent 2px,
          rgba(0, 220, 255, 0.15) 2px,
          rgba(0, 220, 255, 0.15) 3px
        );
      }
    `;
    container.appendChild(st);
  }
}
