/**
 * Resolve, cache, and preload @project UI images so menus/HUD can mount instantly.
 */
import { resolveProjectAssetUrl } from './resolve-project-asset.js';
import { isMobileDevice } from './mobile-device.js';

/** Shared menu chrome used by start/pause/options/mission UIs. */
export const UI_MENU_PANEL = '@project/assets/UI/menuelement.webp';
export const UI_OPTIONS_FRAME = '@project/assets/UI/optionsbackground.webp';
export const UI_OPTIONS_LOGO = '@project/assets/UI/Options.webp';
export const UI_START_BG = '@project/assets/UI/grimtitle.webp';

/** Width / height for layout reservation before decode (Options.webp is 1536×1024). */
export const UI_OPTIONS_LOGO_ASPECT = 1536 / 1024;

/** Every UI raster referenced at runtime — preloaded during warmup. */
export const UI_ASSET_PATHS: readonly string[] = [
  UI_START_BG,
  UI_MENU_PANEL,
  UI_OPTIONS_FRAME,
  UI_OPTIONS_LOGO,
  '@project/assets/UI/Burdenvillemaponly.webp',
  '@project/assets/UI/compass.webp',
  '@project/assets/UI/ComboBG.webp',
  '@project/assets/UI/Combo-10x.webp',
  '@project/assets/UI/Combo-20x.webp',
  '@project/assets/UI/Combo-30x.webp',
  '@project/assets/UI/Combo-40x.webp',
  '@project/assets/UI/Combo-50x.webp',
  '@project/assets/UI/Combo-75x.webp',
  '@project/assets/UI/Combo-100x.webp',
  '@project/assets/UI/Combo-150x.webp',
  '@project/assets/UI/Combo-200x.webp',
  '@project/assets/UI/Combo-250x.webp',
  '@project/assets/UI/Combo-500x.webp',
  '@project/assets/UI/Combo-999x.webp',
  '@project/assets/UI/Shopbackground.webp',
  '@project/assets/UI/Upgradewindow.webp',
  '@project/assets/UI/shopwindow.webp',
  '@project/assets/UI/Boneshard.webp',
  '@project/assets/UI/cursedvial.webp',
  '@project/assets/UI/soulcrystal.webp',
  '@project/assets/UI/grimember.webp',
  '@project/assets/UI/voidrelic.webp',
  '@project/assets/UI/brutecore.webp',
  '@project/assets/UI/HitNumbersBG.webp',
  '@project/assets/UI/KO-sign.webp',
  '@project/assets/UI/Helpme.webp',
  '@project/assets/UI/SpeakerUI.webp',
  '@project/assets/UI/HealthBG.webp',
  '@project/assets/UI/HealthBar.webp',
  '@project/assets/UI/SoulsBG.webp',
  '@project/assets/UI/noise.webp',
  '@project/assets/UI/fistofa.webp',
  '@project/assets/UI/TutSoul.webp',
  '@project/assets/UI/ShopC.webp',
  '@project/assets/UI/Cinema.webp',
  '@project/assets/UI/sub.webp',
  '@project/assets/UI/underworld.webp',
  '@project/assets/UI/hosptial.webp',
  '@project/assets/UI/factory.webp',
  '@project/assets/UI/police.webp',
];

/** Menu-boot subset on phones — full HUD/map assets load on demand later. */
export const MOBILE_UI_PRELOAD_PATHS: readonly string[] = [
  UI_START_BG,
  UI_MENU_PANEL,
  UI_OPTIONS_FRAME,
  UI_OPTIONS_LOGO,
];

export function getUiPreloadPaths(): readonly string[] {
  return isMobileDevice() ? MOBILE_UI_PRELOAD_PATHS : UI_ASSET_PATHS;
}

const resolvedUrls = new Map<string, string>();
const pendingResolves = new Map<string, Promise<string>>();
let warmupPromise: Promise<void> | null = null;

function preloadImage(url: string, timeoutMs = 12_000): Promise<boolean> {
  if (!url) {
    return Promise.resolve(false);
  }
  if (typeof Image === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) {
        return;
      }
      done = true;
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      finish(true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };
    img.src = url;
  });
}

/** Synchronous lookup — empty string until resolve/preload completes. */
export function getCachedUiImageUrl(projectPath: string): string {
  return resolvedUrls.get(projectPath) ?? '';
}

/** Resolve one UI asset, decode in browser, and cache the URL. */
export async function resolveAndCacheUiImage(projectPath: string): Promise<string> {
  const cached = resolvedUrls.get(projectPath);
  if (cached) {
    return cached;
  }

  let pending = pendingResolves.get(projectPath);
  if (!pending) {
    pending = (async () => {
      const url = await resolveProjectAssetUrl(projectPath);
      if (url) {
        await preloadImage(url);
        resolvedUrls.set(projectPath, url);
      }
      pendingResolves.delete(projectPath);
      return url;
    })();
    pendingResolves.set(projectPath, pending);
  }

  return pending;
}

/** Resolve and decode specific UI assets (e.g. before opening a menu). */
export async function ensureUiImagesReady(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map(path => resolveAndCacheUiImage(path)));
}

export type UiPreloadProgressCallback = (loaded: number, total: number) => void;

/** Preload all UI images (safe to call multiple times). */
export function preloadUiImages(onProgress?: UiPreloadProgressCallback): Promise<void> {
  const paths = getUiPreloadPaths();
  if (!warmupPromise) {
    const total = paths.length;
    let loaded = 0;
    warmupPromise = Promise.all(
      paths.map(async path => {
        await resolveAndCacheUiImage(path);
        loaded += 1;
        onProgress?.(loaded, total);
      }),
    ).then(() => undefined);
  } else if (onProgress) {
    onProgress(paths.length, paths.length);
  }
  return warmupPromise;
}

/** Apply a cached or freshly resolved background-image without blocking mount. */
export function applyBackgroundImageWhenReady(
  element: HTMLElement,
  projectPath: string,
  style: Partial<Pick<CSSStyleDeclaration, 'backgroundSize' | 'backgroundRepeat' | 'backgroundPosition'>> = {},
): void {
  const apply = (url: string) => {
    if (!url || !element.isConnected) {
      return;
    }
    element.style.backgroundImage = `url("${url}")`;
    if (style.backgroundSize) {
      element.style.backgroundSize = style.backgroundSize;
    }
    if (style.backgroundRepeat) {
      element.style.backgroundRepeat = style.backgroundRepeat;
    }
    if (style.backgroundPosition) {
      element.style.backgroundPosition = style.backgroundPosition;
    }
  };

  const cached = getCachedUiImageUrl(projectPath);
  if (cached) {
    apply(cached);
    return;
  }

  void resolveAndCacheUiImage(projectPath).then(apply);
}

/** Set img src from cache or resolve asynchronously; reserves aspect-ratio to avoid CLS. */
export function applyImgSrcWhenReady(
  img: HTMLImageElement,
  projectPath: string,
  aspectRatio?: number,
): void {
  if (aspectRatio && aspectRatio > 0) {
    img.style.aspectRatio = String(aspectRatio);
  }

  const apply = (url: string) => {
    if (!url || !img.isConnected) {
      return;
    }
    img.src = url;
  };

  const cached = getCachedUiImageUrl(projectPath);
  if (cached) {
    apply(cached);
    return;
  }

  void resolveAndCacheUiImage(projectPath).then(apply);
}
