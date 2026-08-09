import * as ENGINE from '@gnsx/genesys.js';

import { BackgroundMusicActor } from '../actors/BackgroundMusicActor.js';
import { CutsceneMusicActor } from '../actors/CutsceneMusicActor.js';
import { MapMusicActor } from '../actors/MapMusicActor.js';
import { MenuMusicActor } from '../actors/MenuMusicActor.js';
import { PostmanBossMusicActor } from '../actors/PostmanBossMusicActor.js';

/** Apply music volume (0–1) to every active music actor in the world. */
export function applyMusicVolumeToWorld(world: ENGINE.World, scale: number): void {
  const clamped = Math.max(0, Math.min(1, scale));

  for (const actor of world.getRootNodes()) {
    if (actor instanceof BackgroundMusicActor) {
      actor.setMusicVolume(clamped);
    } else if (actor instanceof PostmanBossMusicActor) {
      actor.setMusicVolume(clamped);
    } else if (actor instanceof MenuMusicActor) {
      actor.setMusicVolume(clamped);
    } else if (actor instanceof CutsceneMusicActor) {
      actor.setMusicVolume(clamped);
    } else if (actor instanceof MapMusicActor) {
      actor.setMusicVolume(clamped);
    }
  }
}
