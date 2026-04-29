import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class BackgroundMusicActor extends ENGINE.Actor {
  private soundComponent: ENGINE.SoundComponent | null = null;

  constructor() {
    super();
  }

  protected override doBeginPlay(): void {
    const soundResource = new ENGINE.SoundResource();
    soundResource.name = 'backgroundMusic';
    soundResource.audioPath = '@project/assets/sounds/Porchlight Synapse.mp3';
    soundResource.volume = 0.25;

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

  protected override doEndPlay(): void {
    if (this.soundComponent) {
      this.soundComponent.stopAll();
    }
  }
}
