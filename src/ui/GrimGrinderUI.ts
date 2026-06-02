/**
 * Grim Grinder transformation overlays — fade + fullscreen image sequence on black.
 */
import * as ENGINE from '@gnsx/genesys.js';

const BLACK_ATTR = 'data-grim-grinder-black';
const TRANSFORM_ATTR = 'data-grim-grinder-transform';
const FADE_MS = 450;

const GRIM_BECOMES_WEBP = '@project/assets/UI/grimbecomes.webp';
const GRIM_CAR_WEBP = '@project/assets/UI/grimcar.webp';
const GRIM_GRINDER_TITLE_WEBP = '@project/assets/UI/grimgrinder.webp';
const GRIM_BECOMES_PNG = '@project/assets/UI/grimbecomes.png';
const GRIM_CAR_PNG = '@project/assets/UI/grimcar.png';
const GRIM_GRINDER_TITLE_PNG = '@project/assets/UI/grimgrinder.png';

const BECOMES_HOLD_MS = 750;
const CAR_HOLD_MS = 850;
const GRINDER_HOLD_MS = 900;
const FINAL_HOLD_MS = 350;
const IMAGE_FADE_MS = 280;

/** Above map / shop UI so transform art is visible. */
const TRANSFORM_Z = 10300;

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

function getContainer(world: ENGINE.World): HTMLElement | null {
  return (world as GameContainerWorld).gameContainer ?? null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function ensureBlack(gc: HTMLElement): HTMLDivElement {
  let el = gc.querySelector(`[${BLACK_ATTR}]`) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.setAttribute(BLACK_ATTR, '');
    el.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: ${TRANSFORM_Z - 1};
      background: #050508;
      opacity: 0;
      pointer-events: none;
      transition: opacity ${FADE_MS * 0.001}s ease;
    `;
    gc.appendChild(el);
  }
  return el;
}

async function resolveImageUrl(webpPath: string, pngPath: string): Promise<string> {
  const tryResolve = async (path: string): Promise<string> => {
    const resolved = (await ENGINE.resolveAssetPathsInText(path)).trim();
    if (!resolved || resolved.includes('@project')) {
      throw new Error(`Unresolved: ${path}`);
    }
    return resolved;
  };

  try {
    const webp = await tryResolve(webpPath);
    await loadImage(webp);
    return webp;
  } catch {
    const png = await tryResolve(pngPath);
    await loadImage(png);
    return png;
  }
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = new Image();
    probe.onload = () => resolve();
    probe.onerror = () => reject(new Error(`Image failed: ${url}`));
    probe.src = url;
  });
}

export class GrimGrinderUI {
  public static fadeToBlack(world: ENGINE.World, durationMs = FADE_MS): Promise<void> {
    const gc = getContainer(world);
    if (!gc) {
      return Promise.resolve();
    }
    const cover = ensureBlack(gc);
    cover.style.transition = `opacity ${durationMs * 0.001}s ease`;
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        cover.style.opacity = '1';
        window.setTimeout(resolve, durationMs + 40);
      });
    });
  }

  public static fadeFromBlack(world: ENGINE.World, durationMs = FADE_MS): Promise<void> {
    const gc = getContainer(world);
    if (!gc) {
      return Promise.resolve();
    }
    gc.querySelector(`[${TRANSFORM_ATTR}]`)?.remove();

    const cover = gc.querySelector(`[${BLACK_ATTR}]`) as HTMLDivElement | null;
    if (!cover) {
      return Promise.resolve();
    }
    cover.style.transition = `opacity ${durationMs * 0.001}s ease`;
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        cover.style.opacity = '0';
        window.setTimeout(() => {
          cover.remove();
          resolve();
        }, durationMs + 40);
      });
    });
  }

  /**
   * On black: grimbecomes → grimcar → grimgrinder title art, then caller fades back in.
   */
  public static async showTransformSequence(world: ENGINE.World): Promise<void> {
    const gc = getContainer(world);
    if (!gc) {
      return;
    }

    gc.querySelector(`[${BLACK_ATTR}]`)?.remove();

    let overlay = gc.querySelector(`[${TRANSFORM_ATTR}]`) as HTMLDivElement | null;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute(TRANSFORM_ATTR, '');
      overlay.style.cssText = `
        position: absolute;
        inset: 0;
        z-index: ${TRANSFORM_Z};
        background: #050508;
        pointer-events: none;
        overflow: hidden;
      `;
      gc.appendChild(overlay);
    }

    const img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    img.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center;
      display: block;
      opacity: 0;
      transition: opacity ${IMAGE_FADE_MS * 0.001}s ease;
    `;
    overlay.replaceChildren(img);

    let becomesUrl = '';
    let carUrl = '';
    let grinderUrl = '';
    try {
      [becomesUrl, carUrl, grinderUrl] = await Promise.all([
        resolveImageUrl(GRIM_BECOMES_WEBP, GRIM_BECOMES_PNG),
        resolveImageUrl(GRIM_CAR_WEBP, GRIM_CAR_PNG),
        resolveImageUrl(GRIM_GRINDER_TITLE_WEBP, GRIM_GRINDER_TITLE_PNG),
      ]);
    } catch (err) {
      console.warn('[GrimGrinderUI] Transform images failed to load:', err);
      overlay.remove();
      return;
    }

    const showBeat = async (src: string, holdMs: number): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const onReady = (): void => {
          img.removeEventListener('error', onError);
          requestAnimationFrame(() => {
            img.style.opacity = '1';
          });
          resolve();
        };
        const onError = (): void => {
          img.removeEventListener('load', onReady);
          reject(new Error(`Failed to display ${src}`));
        };
        img.addEventListener('load', onReady, { once: true });
        img.addEventListener('error', onError, { once: true });
        img.style.opacity = '0';
        img.src = src;
        if (img.complete && img.naturalWidth > 0) {
          onReady();
        }
      });
      await delay(holdMs);
    };

    try {
      await showBeat(becomesUrl, BECOMES_HOLD_MS);
      img.style.opacity = '0';
      await delay(IMAGE_FADE_MS);
      await showBeat(carUrl, CAR_HOLD_MS);
      img.style.opacity = '0';
      await delay(IMAGE_FADE_MS);
      await showBeat(grinderUrl, GRINDER_HOLD_MS);
      await delay(FINAL_HOLD_MS);
    } catch (err) {
      console.warn('[GrimGrinderUI] Transform sequence beat failed:', err);
    }

    img.style.opacity = '0';
    await delay(IMAGE_FADE_MS);
    overlay.remove();
  }
}
