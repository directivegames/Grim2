import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class BackgroundMusicActor extends ENGINE.Actor {
  private soundComponent: ENGINE.SoundComponent | null = null;
  private _isMuted = false;
  private _previousVolume = 0.25;

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
