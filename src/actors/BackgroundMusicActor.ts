import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';
import { gameSettings } from '../utils/game-settings.js';

/** Base music volume before user settings scale. */
const BASE_MUSIC_VOLUME = 0.5;

/** Music slow-mo rate — less extreme than game slomo (0.12) so the track stays audible. */
const KILL_STREAK_MUSIC_RATE = 0.42;
/** Wall-clock lerp speed — reaches target in ~0.12s while staying synced on enter/exit. */
const MUSIC_RATE_LERP_SPEED = 14;

@ENGINE.GameClass()
export class BackgroundMusicActor extends GameRootNode {
  private soundComponent: ENGINE.SoundNode | null = null;
  private _isMuted = false;
  private _previousVolume = BASE_MUSIC_VOLUME;
  private _musicVolumeScale = gameSettings.musicVolume;
  private _currentPlaybackRate = 1.0;
  private _targetPlaybackRate = 1.0;
  private _started = false;

  constructor() {
    super();
  }

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'backgroundMusic';
    soundResource.audioPath = '@project/assets/sounds/NeonChapel.mp3';
    soundResource.volume = BASE_MUSIC_VOLUME * gameSettings.musicVolume;

    this.soundComponent = ENGINE.SoundNode.create({
      loop: true,
      autoPlay: false,
      autoPlayClipKey: 'backgroundMusic',
      positional: false,
      bus: 'Music',
      sounds: [soundResource],
    });

    this.add(this.soundComponent);
  
    return true;
  }

  /** Start playback (safe to call repeatedly). */
  public start(): void {
    if (!this.soundComponent || this._started) {
      return;
    }
    this._started = true;
    void this.soundComponent.waitForLoad().then(async () => {
      if (!this._started || !this.soundComponent) return;
      const ctx = this.soundComponent.getAudioContext();
      if (ctx?.state === 'suspended') {
        try { await ctx.resume(); } catch { /* blocked without user gesture */ }
      }
      if (!this._started || !this.soundComponent) return;
      void this.soundComponent.play('backgroundMusic');
    });
  }

  /** Stop playback (does not destroy the actor). */
  public stop(): void {
    this._started = false;
    this.soundComponent?.stopAll();
  }

  public static ensurePlaying(world: ENGINE.World): BackgroundMusicActor {
    const existing = world.getRootNodes().find(a => a instanceof BackgroundMusicActor);
    const actor = existing instanceof BackgroundMusicActor
      ? existing
      : BackgroundMusicActor.create({ name: 'BackgroundMusicActor' });

    if (!(existing instanceof BackgroundMusicActor)) {
      world.add(actor);
    }

    actor.start();
    return actor;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    // Kill-streak slomo: gentler rate than world.slomo; fast wall-clock lerp for audible warp.
    const world = this.getWorld();
    if (world && this.soundComponent) {
      const slomo = (world as unknown as { slomo: number }).slomo ?? 1.0;
      const targetRate = slomo <= 0.15 ? KILL_STREAK_MUSIC_RATE : 1.0;
      const realDt = getUnscaledDeltaTime(world, deltaTime);

      if (Math.abs(targetRate - this._targetPlaybackRate) > 0.001) {
        this._targetPlaybackRate = targetRate;
      }

      const lerpT = Math.min(1, MUSIC_RATE_LERP_SPEED * realDt);
      this._currentPlaybackRate = THREE.MathUtils.lerp(
        this._currentPlaybackRate,
        this._targetPlaybackRate,
        lerpT,
      );

      const audio = this.soundComponent.getAudio('backgroundMusic');
      if (audio && Math.abs(audio.playbackRate - this._currentPlaybackRate) > 0.001) {
        audio.setPlaybackRate(this._currentPlaybackRate);
      }
    }
  }

  /** Set music volume scale from settings (0-1). */
  public setMusicVolume(scale: number): void {
    this._musicVolumeScale = Math.max(0, Math.min(1, scale));
    if (this._isMuted || !this.soundComponent) {
      return;
    }

    const volume = BASE_MUSIC_VOLUME * this._musicVolumeScale;
    this._previousVolume = volume;
    this.soundComponent.setVolumeAll(volume);
  }

  /** Mute the background music. */
  public mute(): void {
    if (this._isMuted) return;
    this._isMuted = true;
    this._previousVolume = BASE_MUSIC_VOLUME * this._musicVolumeScale;

    if (this.soundComponent) {
      this.soundComponent.setVolumeAll(0);
    }
    console.log('[BackgroundMusic] Muted');
  }

  /** Unmute the background music. */
  public unmute(): void {
    if (!this._isMuted) return;
    this._isMuted = false;

    if (this.soundComponent) {
      this.soundComponent.setVolumeAll(this._previousVolume);
    }
    console.log('[BackgroundMusic] Unmuted');
  }

  /** Check if music is muted. */
  public isMuted(): boolean {
    return this._isMuted;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    if (this.soundComponent) {
      this.soundComponent.stopAll();
    }
  
    return true;
  }
}
