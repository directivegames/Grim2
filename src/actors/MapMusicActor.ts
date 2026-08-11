import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';
import { gameSettings } from '../utils/game-settings.js';

const BASE_MAP_MUSIC_VOLUME = 0.5;
const MAP_TRACK = '@project/assets/sounds/Mapmusic.mp3';

@ENGINE.GameClass()
export class MapMusicActor extends GameRootNode {
  private _sound: ENGINE.SoundNode | null = null;
  private _musicVolumeScale = gameSettings.musicVolume;
  private _stopped = false;

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }this._stopped = false;

    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'mapMusic';
    soundResource.audioPath = MAP_TRACK;
    soundResource.volume = BASE_MAP_MUSIC_VOLUME * gameSettings.musicVolume;

    this._sound = ENGINE.SoundNode.create({
      loop: true,
      autoPlay: false,
      positional: false,
      bus: 'Music',
      sounds: [soundResource],
    });

    this.add(this._sound);

    void this._sound.waitForLoad().then(async () => {
      if (this._stopped || !this._sound) return;
      const ctx = this._sound.getAudioContext();
      if (ctx?.state === 'suspended') {
        try { await ctx.resume(); } catch { /* blocked without user gesture */ }
      }
      if (this._stopped || !this._sound) return;
      void this._sound.play('mapMusic');
    });
  
    return true;
  }

  public stopNow(): void {
    this._stopped = true;
    this._sound?.stopAll();
  }

  public setMusicVolume(scale: number): void {
    this._musicVolumeScale = Math.max(0, Math.min(1, scale));
    this._sound?.setVolumeAll(BASE_MAP_MUSIC_VOLUME * this._musicVolumeScale);
  }

  public static stopAll(world: ENGINE.World): void {
    const toRemove: MapMusicActor[] = [];
    for (const a of world.getRootNodes()) {
      if (a instanceof MapMusicActor) {
        a.stopNow();
        toRemove.push(a);
      }
    }
    if (toRemove.length > 0) {
      world.remove(...toRemove);
    }
  }

  public static ensurePlaying(world: ENGINE.World): void {
    const existing = world.getRootNodes().find(a => a instanceof MapMusicActor);
    if (existing instanceof MapMusicActor) {
      return;
    }
    const actor = MapMusicActor.create({ name: 'MapMusicActor' });
    world.add(actor);
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
