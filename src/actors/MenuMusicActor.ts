import * as ENGINE from '@gnsx/genesys.js';
import { gameSettings } from '../utils/game-settings.js';

const BASE_MENU_MUSIC_VOLUME = 0.5;

const MENU_TRACKS = [
  '@project/assets/sounds/Menumusic.wav',
  '@project/assets/sounds/menumusic2.wav',
] as const;

@ENGINE.GameClass()
export class MenuMusicActor extends ENGINE.Actor {
  private _sound: ENGINE.SoundComponent | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const pick = MENU_TRACKS[Math.floor(Math.random() * MENU_TRACKS.length)] ?? MENU_TRACKS[0];

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'menuMusic';
    soundResource.audioPath = pick;
    soundResource.volume = BASE_MENU_MUSIC_VOLUME * gameSettings.musicVolume;

    this._sound = ENGINE.SoundComponent.create({
      loop: true,
      autoPlay: true,
      autoPlayClipKey: 'menuMusic',
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
    this._sound?.setVolumeAll(BASE_MENU_MUSIC_VOLUME * this._musicVolumeScale);
  }

  public static stopAll(world: ENGINE.World): void {
    const toRemove: MenuMusicActor[] = [];
    for (const a of world.getActors()) {
      if (a instanceof MenuMusicActor) {
        a.stopNow();
        toRemove.push(a);
      }
    }
    if (toRemove.length > 0) {
      world.removeActors(...toRemove);
    }
  }

  public static ensureExists(world: ENGINE.World): MenuMusicActor {
    const existing = world.getActors().find(a => a instanceof MenuMusicActor);
    if (existing instanceof MenuMusicActor) {
      return existing;
    }
    const actor = MenuMusicActor.create({ name: 'MenuMusicActor' });
    world.addActor(actor);
    return actor;
  }

  protected override doEndPlay(): void {
    this._sound?.stopAll();
    super.doEndPlay();
  }
}

