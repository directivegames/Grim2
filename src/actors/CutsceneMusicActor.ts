import * as ENGINE from '@gnsx/genesys.js';
import { gameSettings } from '../utils/game-settings.js';

const BASE_CUTSCENE_MUSIC_VOLUME = 0.5;
const CUTSCENE_TRACK = '@project/assets/sounds/cutscenemusic.wav';

@ENGINE.GameClass()
export class CutsceneMusicActor extends ENGINE.Actor {
  private _sound: ENGINE.SoundComponent | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'cutsceneMusic';
    soundResource.audioPath = CUTSCENE_TRACK;
    soundResource.volume = BASE_CUTSCENE_MUSIC_VOLUME * gameSettings.musicVolume;

    this._sound = ENGINE.SoundComponent.create({
      loop: true,
      autoPlay: true,
      autoPlayClipKey: 'cutsceneMusic',
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
    this._sound?.setVolumeAll(BASE_CUTSCENE_MUSIC_VOLUME * this._musicVolumeScale);
  }

  public static stopAll(world: ENGINE.World): void {
    const toRemove: CutsceneMusicActor[] = [];
    for (const a of world.getActors()) {
      if (a instanceof CutsceneMusicActor) {
        a.stopNow();
        toRemove.push(a);
      }
    }
    if (toRemove.length > 0) {
      world.removeActors(...toRemove);
    }
  }

  public static ensureExists(world: ENGINE.World): CutsceneMusicActor {
    const existing = world.getActors().find(a => a instanceof CutsceneMusicActor);
    if (existing instanceof CutsceneMusicActor) {
      return existing;
    }
    const actor = CutsceneMusicActor.create({ name: 'CutsceneMusicActor' });
    world.addActor(actor);
    return actor;
  }

  protected override doEndPlay(): void {
    this._sound?.stopAll();
    super.doEndPlay();
  }
}

