import * as ENGINE from '@gnsx/genesys.js';

import { killStreakTracker, slomoManager } from '../actors/KillStreakTracker.js';
import { GameAudioManager } from '../actors/GameAudioManager.js';

let cached: GameAudioManager | null = null;

/** Cached singleton lookup — avoids O(n) `world.getRootNodes().find` on hot paths. */
export function getGameAudioManager(world: ENGINE.World): GameAudioManager {
  if (cached?.getWorld() === world) {
    return cached;
  }
  cached = GameAudioManager.ensureExists(world);
  return cached;
}

/**
 * Clear slomo/kill-streak state and reset pooled SFX playback before gameplay unlock.
 * Call at the end of Ready To Reap / mission intro.
 */
export function resetGameplayAudioState(world: ENGINE.World): void {
  slomoManager.forceReset(world);
  killStreakTracker.reset();

  const w = world as unknown as { slomo?: number };
  w.slomo = 1;

  getGameAudioManager(world).syncPlaybackRates(1);
}
