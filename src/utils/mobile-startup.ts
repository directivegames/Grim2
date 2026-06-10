/**
 * Hook before intro / mission start on mobile.
 * Awaits the background scene load (started fire-and-forget during the intro) so the
 * player never drops into a half-loaded world. Shows the existing LoadingScreenUI if
 * the load is still running when a mission is selected.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { isMobileDevice } from './mobile-device.js';
import { MobileSceneChunkLoaderActor } from '../actors/MobileSceneChunkLoaderActor.js';
import { LoadingScreenUI } from '../ui/LoadingScreenUI.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export async function prepareMobileForGameplay(world: ENGINE.World): Promise<void> {
  if (!isMobileDevice()) return;

  const loader = MobileSceneChunkLoaderActor.ensureExists(world);
  if (!loader) return;

  const bgPromise = loader.waitForBackgroundLoad();

  // Yield one macrotask — all pending microtasks (including any already-resolved
  // promise callbacks) will have settled, so `done` is reliable.
  let done = false;
  void bgPromise.then(() => { done = true; });
  await new Promise<void>(resolve => window.setTimeout(resolve, 0));
  if (done) return;

  // Background load is still running — show the loading overlay so the player
  // never drops into a half-loaded world.
  const gc = (world as GameContainerWorld).gameContainer;
  if (gc) {
    LoadingScreenUI.attach(gc);
    LoadingScreenUI.setProgress(0, 'Loading world…');
  }

  await bgPromise;

  LoadingScreenUI.setProgress(100, 'Ready');
  // Brief hold so the progress bar visually fills before dismissing.
  await new Promise<void>(resolve => window.setTimeout(resolve, 320));
  LoadingScreenUI.dismiss();
}
