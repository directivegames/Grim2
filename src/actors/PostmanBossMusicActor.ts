/**
 * PostmanBossMusicActor — loops postmanhell.wav during boss-fight missions only.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { gameSettings } from '../utils/game-settings.js';

const BASE_VOLUME = 0.52;
const BOSS_TRACK = '@project/assets/sounds/postmanhell.mp3';

@ENGINE.GameClass()
export class PostmanBossMusicActor extends ENGINE.Actor {
  private _sound: ENGINE.SoundComponent | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;
  private _stopped = false;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this._stopped = false;

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'postmanBossMusic';
    soundResource.audioPath = BOSS_TRACK;
    soundResource.volume = BASE_VOLUME * gameSettings.musicVolume;

    this._sound = ENGINE.SoundComponent.create({
      loop: true,
      autoPlay: false,
      positional: false,
      bus: 'Music',
      sounds: [soundResource],
    });

    this.addComponent(this._sound);

    void this._sound.waitForLoad().then(async () => {
      if (this._stopped || !this._sound) return;
      const ctx = this._sound.getAudioContext();
      if (ctx?.state === 'suspended') {
        try { await ctx.resume(); } catch { /* blocked without user gesture */ }
      }
      if (this._stopped || !this._sound) return;
      void this._sound.play('postmanBossMusic');
    });
    return true;
  }

  public stopNow(): void {
    this._stopped = true;
    this._sound?.stopAll();
  }

  public setMusicVolume(scale: number): void {
    this._musicVolumeScale = Math.max(0, Math.min(1, scale));
    this._sound?.setVolumeAll(BASE_VOLUME * this._musicVolumeScale);
  }

  public static stopAll(world: ENGINE.World): void {
    const toRemove: PostmanBossMusicActor[] = [];
    for (const actor of world.getActors()) {
      if (actor instanceof PostmanBossMusicActor) {
        actor.stopNow();
        toRemove.push(actor);
      }
    }
    if (toRemove.length > 0) {
      world.removeActors(...toRemove);
    }
  }

  public static ensurePlaying(world: ENGINE.World): PostmanBossMusicActor {
    PostmanBossMusicActor.stopAll(world);

    const actor = PostmanBossMusicActor.create({ name: 'PostmanBossMusicActor' });
    world.addActor(actor);
    return actor;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._stopped = true;
    this._sound?.stopAll();
    return true;
  }
}
