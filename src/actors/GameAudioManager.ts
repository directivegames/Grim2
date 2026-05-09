/**
 * GameAudioManager — singleton audio controller for all game SFX.
 *
 * Pre-loads all sounds at startup for instant playback with zero latency.
 * Any actor can access: `world.getActors().find(a => a instanceof GameAudioManager)`
 */
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class GameAudioManager extends ENGINE.Actor {
  private _sounds = new Map<string, ENGINE.SoundComponent>();

  // Sound file paths — all WAV files are in assets/sounds/
  private static readonly SOUND_PATHS: Record<string, { path: string; volume: number }> = {
    bladeSwing:      { path: '@project/assets/sounds/bladesing.wav', volume: 0.1 },
    bladeSwing2:     { path: '@project/assets/sounds/bladeswing2.wav', volume: 0.1 },
    spinBlade:       { path: '@project/assets/sounds/spinblade.wav', volume: 0.12 },
    fistImpact:      { path: '@project/assets/sounds/fistsoundeffect.wav', volume: 0.18 },
    zombieHit1:      { path: '@project/assets/sounds/zombiehit1.wav', volume: 0.12 },
    zombieHit2:      { path: '@project/assets/sounds/zombiehit2.wav', volume: 0.12 },
    zombieDeath:     { path: '@project/assets/sounds/zombiedeath.wav', volume: 0.18 },
  };

  public override initialize(options?: ENGINE.ActorOptions): void {
    super.initialize(options);
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    // Pre-load all sounds at startup — each gets its own SoundComponent
    for (const [key, config] of Object.entries(GameAudioManager.SOUND_PATHS)) {
      const soundResource = new ENGINE.SoundResource();
      soundResource.name = key;
      soundResource.audioPath = config.path;
      soundResource.volume = config.volume;

      const soundComponent = ENGINE.SoundComponent.create({
        sounds: [soundResource],
        positional: false,
        loop: false,
      });

      this._sounds.set(key, soundComponent);
      this.addComponent(soundComponent);
    }
  }

  /**
   * Play a pre-loaded sound by key.
   * @param key — sound identifier from SOUND_PATHS
   * @param volumeScale — optional multiplier (0-1) for distance attenuation
   * @param forceRestart — restart even if already playing
   */
  public play(key: string, volumeScale = 1.0, forceRestart = false): void {
    const sound = this._sounds.get(key);
    if (!sound) {
      console.warn(`[GameAudioManager] Sound not found: ${key}`);
      return;
    }

    const clampedVolume = Math.max(0, Math.min(1, volumeScale));

    // Apply volume scale for distance attenuation
    if (clampedVolume < 1.0) {
      sound.setVolumeAll(clampedVolume);
    }

    void sound.play(key, undefined, forceRestart);

    // Reset volume back to default after playing
    if (clampedVolume < 1.0) {
      // Small delay to let play start, then restore
      setTimeout(() => {
        const defaultVolume = this.getDefaultVolume(key);
        sound.setVolumeAll(defaultVolume);
      }, 50);
    }
  }

  /**
   * Play a sound with calculated distance attenuation.
   * @param key — sound identifier
   * @param sourcePos — 3D position where sound originates
   * @param listenerPos — 3D position of listener (player)
   * @param maxDistance — distance at which volume hits minimum
   * @param minVolume — minimum audible volume (never silent)
   */
  public playAtDistance(
    key: string,
    sourcePos: { x: number; y: number; z: number },
    listenerPos: { x: number; y: number; z: number },
    maxDistance = 25,
    minVolume = 0.15,
  ): void {
    const dx = sourcePos.x - listenerPos.x;
    const dz = sourcePos.z - listenerPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Linear falloff with minimum floor
    const volumeScale = Math.max(minVolume, 1 - distance / maxDistance);

    this.play(key, volumeScale, true);
  }

  private getDefaultVolume(key: string): number {
    const config = GameAudioManager.SOUND_PATHS[key];
    return config?.volume ?? 1.0;
  }

  /**
   * Utility: spawn the audio manager if not already present.
   * Call from your game's startup (e.g., GameMode or postStart).
   */
  public static ensureExists(world: ENGINE.World): GameAudioManager {
    const existing = world.getActors().find(
      (a): a is GameAudioManager => a instanceof GameAudioManager
    );
    if (existing) return existing;

    const manager = GameAudioManager.create();
    world.addActor(manager);
    return manager;
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Sound';
  }
}
