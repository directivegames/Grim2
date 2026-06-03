import * as ENGINE from '@gnsx/genesys.js';
import { gameSettings } from '../utils/game-settings.js';

const BASE_MAP_MUSIC_VOLUME = 0.5;
const MAP_TRACK = '@project/assets/sounds/Mapmusic.mp3';

@ENGINE.GameClass()
export class MapMusicActor extends ENGINE.Actor {
  private _sound: ENGINE.SoundComponent | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'mapMusic';
    soundResource.audioPath = MAP_TRACK;
    soundResource.volume = BASE_MAP_MUSIC_VOLUME * gameSettings.musicVolume;

    this._sound = ENGINE.SoundComponent.create({
      loop: true,
      autoPlay: true,
      autoPlayClipKey: 'mapMusic',
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
    this._sound?.setVolumeAll(BASE_MAP_MUSIC_VOLUME * this._musicVolumeScale);
  }

  public static stopAll(world: ENGINE.World): void {
    const toRemove: MapMusicActor[] = [];
    for (const a of world.getActors()) {
      if (a instanceof MapMusicActor) {
        a.stopNow();
        toRemove.push(a);
      }
    }
    if (toRemove.length > 0) {
      world.removeActors(...toRemove);
    }
  }

  public static ensurePlaying(world: ENGINE.World): void {
    const existing = world.getActors().find(a => a instanceof MapMusicActor);
    if (existing instanceof MapMusicActor) {
      return;
    }
    const actor = MapMusicActor.create({ name: 'MapMusicActor' });
    world.addActor(actor);
  }

  protected override doEndPlay(): void {
    this._sound?.stopAll();
    super.doEndPlay();
  }
}
