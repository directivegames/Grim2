import * as ENGINE from '@gnsx/genesys.js';
import { gameSettings } from '../utils/game-settings.js';

const BASE_MENU_MUSIC_VOLUME = 0.5;

const MENU_TRACKS = [
  '@project/assets/sounds/Menumusic.mp3',
  '@project/assets/sounds/menumusic2.mp3',
] as const;

@ENGINE.GameClass()
export class MenuMusicActor extends ENGINE.Actor {
  private _sound: ENGINE.SoundComponent | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;
  private _stopped = false;

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }this._stopped = false;

    const pick = MENU_TRACKS[Math.floor(Math.random() * MENU_TRACKS.length)] ?? MENU_TRACKS[0];

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'menuMusic';
    soundResource.audioPath = pick;
    soundResource.volume = BASE_MENU_MUSIC_VOLUME * gameSettings.musicVolume;

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
      void this._sound.play('menuMusic');
    });
  
    return true;
  }

  public stopNow(): void {
    this._stopped = true;
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

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._stopped = true;
    this._sound?.stopAll();
    return true;
  }
}

