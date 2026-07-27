/**
 * MusicPlayerActor.ts
 *
 * Looping background music actor with:
 *   - Slomo-aware pitch shift (smooth lerp, wall-clock time)
 *   - Mute / unmute
 *   - Per-actor and world-wide volume control
 *   - Safe AudioContext resume (handles browser auto-play policy)
 *
 * Usage:
 *   const music = MusicPlayerActor.ensurePlaying(world, '@project/assets/sounds/Track.mp3');
 *   music.setMusicVolume(settings.musicVolume);
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// ─── Config ───────────────────────────────────────────────────────────────────

/** Base volume before user settings scale (0–1). */
const BASE_MUSIC_VOLUME = 0.5;

/**
 * Target playback rate when slomo is active.
 * Gentler than full game slomo (which may go to 0.12×) so the track stays audible.
 */
const SLOMO_MUSIC_RATE = 0.42;

/** world.slomo value at or below which slomo rate kicks in. */
const SLOMO_THRESHOLD = 0.15;

/**
 * Wall-clock lerp speed for rate transitions.
 * 14 ≈ reaches target in ~0.12 s. Increase for snappier, decrease for smoother.
 */
const RATE_LERP_SPEED = 14;

// ─── Options ─────────────────────────────────────────────────────────────────

export interface MusicPlayerOptions extends ENGINE.ActorOptions {
  /** Path to the audio file. Use @project/... or @engine/... prefix. */
  audioPath?: string;
  /** Base volume before user settings scale. Default: 0.5. */
  baseVolume?: number;
  /** Audio bus name. Default: 'Music'. */
  bus?: string;
}

// ─── MusicPlayerActor ────────────────────────────────────────────────────────

@ENGINE.GameClass()
export class MusicPlayerActor extends ENGINE.Actor {
  private _soundComponent:   ENGINE.SoundComponent | null = null;
  private _audioPath         = '@project/assets/sounds/music.mp3';
  private _baseVolume        = BASE_MUSIC_VOLUME;
  private _bus               = 'Music';

  private _isMuted           = false;
  private _previousVolume    = BASE_MUSIC_VOLUME;
  private _musicVolumeScale  = 1.0;
  private _started           = false;

  private _currentRate       = 1.0;
  private _targetRate        = 1.0;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  public override initialize(options?: MusicPlayerOptions): void {
    super.initialize(options);
    if (options?.audioPath   !== undefined) this._audioPath   = options.audioPath;
    if (options?.baseVolume  !== undefined) this._baseVolume  = options.baseVolume;
    if (options?.bus         !== undefined) this._bus         = options.bus;
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const res        = new ENGINE.SoundResource();
    res.name         = 'track';
    res.audioPath    = this._audioPath;
    res.volume       = this._baseVolume * this._musicVolumeScale;

    this._soundComponent = ENGINE.SoundComponent.create({
      loop:            true,
      autoPlay:        false,
      autoPlayClipKey: 'track',
      positional:      false,
      bus:             this._bus,
      sounds:          [res],
    });

    this.addComponent(this._soundComponent);
  }

  protected override doEndPlay(): void {
    this._soundComponent?.stopAll();
    super.doEndPlay();
  }

  // ── Playback ─────────────────────────────────────────────────────────────

  /** Start looping playback. Safe to call repeatedly. */
  public start(): void {
    if (!this._soundComponent || this._started) return;
    this._started = true;

    void this._soundComponent.waitForLoad().then(async () => {
      if (!this._started || !this._soundComponent) return;

      const ctx = this._soundComponent.getAudioContext();
      if (ctx?.state === 'suspended') {
        try { await ctx.resume(); } catch { /* blocked without user gesture */ }
      }

      if (!this._started || !this._soundComponent) return;
      void this._soundComponent.play('track');
    });
  }

  /** Stop playback. Call start() to resume. */
  public stop(): void {
    this._started = false;
    this._soundComponent?.stopAll();
  }

  // ── Volume ───────────────────────────────────────────────────────────────

  /** Apply user settings volume scale (0–1). */
  public setMusicVolume(scale: number): void {
    this._musicVolumeScale = Math.max(0, Math.min(1, scale));
    if (this._isMuted || !this._soundComponent) return;

    const vol = this._baseVolume * this._musicVolumeScale;
    this._previousVolume = vol;
    this._soundComponent.setVolumeAll(vol);
  }

  /** Silence without stopping the clock. Unmute resumes from current position. */
  public mute(): void {
    if (this._isMuted) return;
    this._isMuted       = true;
    this._previousVolume = this._baseVolume * this._musicVolumeScale;
    this._soundComponent?.setVolumeAll(0);
  }

  /** Restore volume after mute. */
  public unmute(): void {
    if (!this._isMuted) return;
    this._isMuted = false;
    this._soundComponent?.setVolumeAll(this._previousVolume);
  }

  public isMuted(): boolean { return this._isMuted; }

  // ── Tick — slomo pitch ────────────────────────────────────────────────────

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);

    const world = this.getWorld();
    if (!world || !this._soundComponent) return;

    const slomo = (world as unknown as { slomo?: number }).slomo ?? 1.0;
    const target = slomo <= SLOMO_THRESHOLD ? SLOMO_MUSIC_RATE : 1.0;

    if (target !== this._targetRate) {
      this._targetRate = target;
    }

    // Use wall-clock delta so the lerp speed is independent of slomo magnitude.
    const realDt = this._unscaledDt(world, dt);
    const t = Math.min(1, RATE_LERP_SPEED * realDt);
    this._currentRate = THREE.MathUtils.lerp(this._currentRate, this._targetRate, t);

    const audio = this._soundComponent.getAudio('track');
    if (audio && Math.abs(audio.playbackRate - this._currentRate) > 0.001) {
      audio.setPlaybackRate(this._currentRate);
    }
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  /**
   * Spawn the actor (if not already present) and start playback.
   * Only one `MusicPlayerActor` with the given path will exist at a time.
   */
  public static ensurePlaying(
    world: ENGINE.World,
    audioPath: string,
    options: Omit<MusicPlayerOptions, 'audioPath'> = {},
  ): MusicPlayerActor {
    const existing = world.getActors().find(
      (a): a is MusicPlayerActor =>
        a instanceof MusicPlayerActor && (a as unknown as { _audioPath: string })._audioPath === audioPath,
    );

    if (existing instanceof MusicPlayerActor) {
      existing.start();
      return existing;
    }

    const actor = MusicPlayerActor.create({ ...options, audioPath, name: 'MusicPlayer' });
    world.addActor(actor);
    actor.start();
    return actor;
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Sound';
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Wall-clock (unscaled) delta time.
   * If you use the slomo-manager skill, replace this with getUnscaledDeltaTime(world, dt).
   */
  private _unscaledDt(world: ENGINE.World, scaledDt: number): number {
    const slomo = (world as unknown as { slomo?: number }).slomo ?? 1.0;
    return slomo > 0 ? scaledDt / slomo : scaledDt;
  }
}

// ─── World-wide volume helper ─────────────────────────────────────────────────

/**
 * Apply a volume scale (0–1) to every MusicPlayerActor currently in the world.
 * Wire this to your settings volume slider.
 */
export function applyMusicVolumeToAll(world: ENGINE.World, scale: number): void {
  const clamped = Math.max(0, Math.min(1, scale));
  for (const actor of world.getActors()) {
    if (actor instanceof MusicPlayerActor) {
      actor.setMusicVolume(clamped);
    }
  }
}
