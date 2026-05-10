import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class BackgroundMusicActor extends ENGINE.Actor {
  private soundComponent: ENGINE.SoundComponent | null = null;
  private _isMuted = false;
  private _previousVolume = 0.25;
  private _currentPlaybackRate = 1.0;
  private _targetPlaybackRate = 1.0;

  constructor() {
    super();
  }

  protected override doBeginPlay(): void {
    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'backgroundMusic';
    soundResource.audioPath = '@project/assets/sounds/gravedusttango.wav';
    soundResource.volume = 0.5;

    this.soundComponent = ENGINE.SoundComponent.create({
      loop: true,
      autoPlay: true,
      autoPlayClipKey: 'backgroundMusic',
      positional: false,
      bus: 'Music',
      sounds: [soundResource],
    });

    this.addComponent(this.soundComponent);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    // Match music playback rate to world slomo for that cinematic time-warp feel
    // Only for kill streak slomo (<= 0.15), not fist slomo (0.30)
    const world = this.getWorld();
    if (world && this.soundComponent) {
      const slomo = (world as unknown as { slomo: number }).slomo ?? 1.0;
      // Only slow music during kill streak slomo (0.12), not fist slomo (0.30)
      const targetRate = slomo <= 0.15 ? Math.max(0.05, slomo) : 1.0;
      // Smoothly interpolate to target rate (don't snap instantly)
      const rateSpeed = 3.0 * deltaTime; // gentle lerp speed
      this._currentPlaybackRate = THREE.MathUtils.lerp(this._currentPlaybackRate, targetRate, rateSpeed);

      // Apply to the underlying audio source
      const audio = this.soundComponent.getAudio('backgroundMusic');
      if (audio && Math.abs(audio.playbackRate - this._currentPlaybackRate) > 0.001) {
        audio.setPlaybackRate(this._currentPlaybackRate);
      }
    }
  }

  /** Mute the background music. */
  public mute(): void {
    if (this._isMuted) return;
    this._isMuted = true;
    this._previousVolume = 0.25;

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

  protected override doEndPlay(): void {
    if (this.soundComponent) {
      this.soundComponent.stopAll();
    }
  }
}
