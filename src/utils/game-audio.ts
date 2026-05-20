import * as ENGINE from '@gnsx/genesys.js';

import { GameAudioManager } from '../actors/GameAudioManager.js';

let cached: GameAudioManager | null = null;

/** Cached singleton lookup — avoids O(n) `world.getActors().find` on hot paths. */
export function getGameAudioManager(world: ENGINE.World): GameAudioManager {
  if (cached?.getWorld() === world) {
    return cached;
  }
  cached = GameAudioManager.ensureExists(world);
  return cached;
}
