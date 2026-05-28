/**
 * PostmanBossMusicActor — loops postmanhell.wav during boss-fight missions only.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { gameSettings } from '../utils/game-settings.js';

const BASE_VOLUME = 0.52;
const BOSS_TRACK = '@project/assets/sounds/postmanhell.wav';

@ENGINE.GameClass()
export class PostmanBossMusicActor extends ENGINE.Actor {
  private _sound: ENGINE.SoundComponent | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'postmanBossMusic';
    soundResource.audioPath = BOSS_TRACK;
    soundResource.volume = BASE_VOLUME * gameSettings.musicVolume;

    this._sound = ENGINE.SoundComponent.create({
      loop: true,
      autoPlay: true,
      autoPlayClipKey: 'postmanBossMusic',
      positional: false,
      bus: 'Music',
      sounds: [soundResource],
    });

    this.addComponent(this._sound);
  }

  public stopNow(): void {
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

  protected override doEndPlay(): void {
    this._sound?.stopAll();
    super.doEndPlay();
  }
}
