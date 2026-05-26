import * as ENGINE from '@gnsx/genesys.js';

import { getGameAudioManager } from './game-audio.js';

/** UI click feedback — `selectsound.wav` via GameAudioManager. */
export function playMenuSelectSound(world: ENGINE.World): void {
  try {
    getGameAudioManager(world).play('menuSelect', 1.0, true);
  } catch {
    /* world may be tearing down */
  }
}

/** Wrap a menu click handler so select SFX plays first. */
export function withMenuSelectSound(world: ENGINE.World, handler: () => void): () => void {
  return () => {
    playMenuSelectSound(world);
    handler();
  };
}
