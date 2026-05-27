import * as ENGINE from '@gnsx/genesys.js';

import { ITEMS, itemIconProjectPath } from '../data/items.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

type CacheState = {
  host: HTMLDivElement;
  urlsByItemId: Map<string, string>;
  warmPromise: Promise<void> | null;
};

/**
 * Off-screen item icon warmup cache.
 *
 * Warm during active gameplay (IsometricPlayerPawn) when asset resolution works,
 * same as FistAbilityHUDUI / HealthBarUI. Map shop reads cached URLs.
 * dispose() drops hidden DOM only; resolved URL strings are kept.
 */
export class ItemIconCache {
  private static readonly byWorld = new Map<ENGINE.World, CacheState>();

  public static getUrl(world: ENGINE.World, itemId: string): string {
    return ItemIconCache.byWorld.get(world)?.urlsByItemId.get(itemId) ?? '';
  }

  public static warm(world: ENGINE.World): Promise<void> {
    const w = world as GameContainerWorld;
    const gc = w.gameContainer;
    if (!gc) {
      return Promise.resolve();
    }

    let state = ItemIconCache.byWorld.get(world);
    if (!state) {
      const host = document.createElement('div');
      host.setAttribute('data-grim-item-icon-cache', '');
      host.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
        overflow: hidden;
      `;
      gc.appendChild(host);

      state = {
        host,
        urlsByItemId: new Map<string, string>(),
        warmPromise: null,
      };
      ItemIconCache.byWorld.set(world, state);
    }

    if (state.warmPromise) {
      return state.warmPromise;
    }

    const allCached = ITEMS.every((item) => state.urlsByItemId.has(item.id));

    state.warmPromise = (async () => {
      if (!allCached) {
        const resolves = await Promise.all(
          ITEMS.map(async (item) => {
            const projectPath = itemIconProjectPath(item.iconFile);
            const url = (await ENGINE.resolveAssetPathsInText(projectPath)).trim();
            return { id: item.id, url };
          }),
        );

        for (const { id, url } of resolves) {
          if (!url) continue;
          state.urlsByItemId.set(id, url);
        }
      }

      if (!state.host.isConnected) {
        gc.appendChild(state.host);
      }
      state.host.replaceChildren();

      for (const item of ITEMS) {
        const url = state.urlsByItemId.get(item.id);
        if (!url) continue;

        const img = document.createElement('img');
        img.alt = item.id;
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = url;
        state.host.appendChild(img);
      }

      const imgs = Array.from(state.host.querySelectorAll('img'));
      await Promise.allSettled(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if ((img as HTMLImageElement).complete) {
                resolve();
                return;
              }
              const done = () => resolve();
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
              window.setTimeout(done, 1500);
            }),
        ),
      );
    })();

    return state.warmPromise;
  }

  /** Drop off-screen preload DOM; keep resolved URLs for shop reuse. */
  public static dispose(world: ENGINE.World): void {
    const state = ItemIconCache.byWorld.get(world);
    if (!state) return;
    state.host.remove();
    state.warmPromise = null;
  }
}

