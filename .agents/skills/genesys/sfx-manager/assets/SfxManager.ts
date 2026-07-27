/**
 * SfxManager.ts
 *
 * Pooled sound effects manager with round-robin playback, distance attenuation,
 * global volume scaling, and slomo-aware playback rate.
 *
 * Usage:
 *   1. Edit SOUND_DEFS and NORMAL_RATE_KEYS for your project.
 *   2. Spawn SfxManagerActor once at startup: SfxManagerActor.ensureExists(world)
 *   3. Call play() / playAtDistance() from any actor via getGameSfx(world).
 */
import * as ENGINE from '@gnsx/genesys.js';

// ─── Sound definitions ────────────────────────────────────────────────────────

interface SoundDef {
  /** Asset path — use @project/... or @engine/... prefix. */
  path: string;
  /** Base volume 0–1. Scaled by global sfxVolume setting. */
  volume: number;
  /** How many overlapping instances to allow for this sound. */
  poolSize: number;
}

/**
 * Edit this table to register your project's sounds.
 * Keys are the string identifiers you pass to play().
 */
const SOUND_DEFS: Record<string, SoundDef> = {
  // ── Example entries — replace with your own ──
  // swordSwing: { path: '@project/assets/sounds/sword.wav',  volume: 0.14, poolSize: 2 },
  // explosion:  { path: '@project/assets/sounds/boom.wav',   volume: 0.5,  poolSize: 3 },
  // menuSelect: { path: '@project/assets/sounds/select.wav', volume: 0.4,  poolSize: 1 },
};

/**
 * Keys in this set always play at 1.0× rate — they are exempt from slomo.
 * Add voice lines, UI confirmation sounds, and any clip that must stay in pitch.
 */
const NORMAL_RATE_KEYS = new Set<string>([
  // 'menuSelect',
  // 'voiceLine',
]);

/** Enable `window.__SFX_DEBUG = true` in the browser console to log every play. */
const SFX_DEBUG_GLOBAL = '__SFX_DEBUG';

// ─── SfxManagerActor ─────────────────────────────────────────────────────────

@ENGINE.GameClass()
export class SfxManagerActor extends ENGINE.Actor {
  private _pools    = new Map<string, ENGINE.SoundComponent[]>();
  private _cursors  = new Map<string, number>();
  private _volScale = 1.0;
  private _lazyLoad = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    // On mobile, defer pool creation to first use to avoid blocking startup.
    // On desktop, pre-create all pools so rapid combat SFX have zero first-use latency.
    if (this._isLowMemoryDevice()) {
      this._lazyLoad = true;
    } else {
      for (const key of Object.keys(SOUND_DEFS)) {
        this._buildPool(key);
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Play a registered sound.
   * @param key         — key from SOUND_DEFS
   * @param volumeScale — 0–1 multiplier for this specific play (e.g. distance fade)
   * @param forceRestart — restart the source even if it is already playing
   */
  public play(key: string, volumeScale = 1.0, forceRestart = false): void {
    if (this._lazyLoad) {
      this._buildPool(key);
    }

    const sound = this._nextInPool(key);
    if (!sound) {
      console.warn(`[SfxManager] Unknown sound key: "${key}"`);
      return;
    }

    const def = SOUND_DEFS[key];
    const baseVol = (def?.volume ?? 1.0) * this._volScale;
    const vol = Math.max(0, Math.min(1, volumeScale * baseVol));

    if (vol < baseVol) {
      sound.setVolumeAll(vol);
    }

    void sound.play(key, undefined, forceRestart);
    sound.getAudio(key)?.setPlaybackRate(this._rateForKey(key));

    if (vol < baseVol) {
      // Restore default volume shortly after playback starts
      setTimeout(() => { sound.setVolumeAll(baseVol); }, 50);
    }

    this._debugLog(key);
  }

  /**
   * Play a sound with linear distance attenuation.
   * Volume = max(minVolume, 1 - distance / maxDistance).
   */
  public playAtDistance(
    key: string,
    sourcePos: { x: number; z: number },
    listenerPos: { x: number; z: number },
    maxDistance = 25,
    minVolume = 0.15,
  ): void {
    const dx = sourcePos.x - listenerPos.x;
    const dz = sourcePos.z - listenerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const scale = Math.max(minVolume, 1 - dist / maxDistance);
    this.play(key, scale, true);
  }

  /**
   * Apply a global volume scale (0–1) from user settings.
   * Call on settings change and once during startup.
   */
  public applySfxVolume(scale: number): void {
    this._volScale = Math.max(0, Math.min(1, scale));
    for (const [key, pool] of this._pools) {
      const def = SOUND_DEFS[key];
      const vol = (def?.volume ?? 1.0) * this._volScale;
      for (const sound of pool) {
        sound.setVolumeAll(vol);
      }
    }
  }

  /**
   * Reset all pooled audio sources to the given playback rate.
   * Call when slomo ends to snap everything back to 1.0×.
   */
  public syncPlaybackRates(rate = 1.0): void {
    for (const [key, pool] of this._pools) {
      if (NORMAL_RATE_KEYS.has(key)) continue;
      for (const sound of pool) {
        sound.getAudio(key)?.setPlaybackRate(rate);
      }
    }
  }

  /** Spawn or retrieve the singleton manager in this world. */
  public static ensureExists(world: ENGINE.World): SfxManagerActor {
    const existing = world.getActors().find(
      (a): a is SfxManagerActor => a instanceof SfxManagerActor,
    );
    if (existing) return existing;
    const actor = SfxManagerActor.create({ name: 'SfxManager' });
    world.addActor(actor);
    return actor;
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Sound';
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private _buildPool(key: string): void {
    if (this._pools.has(key)) return;

    const def = SOUND_DEFS[key];
    if (!def) return;

    const pool: ENGINE.SoundComponent[] = [];
    for (let i = 0; i < def.poolSize; i++) {
      const res = new ENGINE.SoundResource();
      res.name = key;
      res.audioPath = def.path;
      res.volume = def.volume * this._volScale;

      const comp = ENGINE.SoundComponent.create({
        sounds:    [res],
        positional: false,
        loop:       false,
      });

      pool.push(comp);
      this.addComponent(comp);
    }

    this._pools.set(key, pool);
    this._cursors.set(key, 0);
  }

  private _nextInPool(key: string): ENGINE.SoundComponent | null {
    const pool = this._pools.get(key);
    if (!pool || pool.length === 0) return null;

    const cursor = this._cursors.get(key) ?? 0;
    const sound  = pool[cursor]!;
    this._cursors.set(key, (cursor + 1) % pool.length);
    return sound;
  }

  private _rateForKey(key: string): number {
    if (NORMAL_RATE_KEYS.has(key)) return 1.0;

    const world = this.getWorld();
    const slomo = world ? ((world as unknown as { slomo?: number }).slomo ?? 1.0) : 1.0;
    return slomo < 0.9 ? Math.max(0.05, slomo) : 1.0;
  }

  private _debugLog(key: string): void {
    if (typeof globalThis !== 'undefined' &&
        (globalThis as Record<string, unknown>)[SFX_DEBUG_GLOBAL] === true) {
      const rate = this._rateForKey(key);
      console.log(`[SfxManager] play "${key}" rate=${rate.toFixed(3)}`);
    }
  }

  private _isLowMemoryDevice(): boolean {
    // Override with your own mobile/low-memory detection utility.
    return false;
  }
}

// ─── Cached world lookup ──────────────────────────────────────────────────────

let _cached: SfxManagerActor | null = null;

/**
 * Cached singleton accessor — avoids O(n) getActors().find() on every hot-path call.
 * Use this in actors that call play() frequently (combat, VFX).
 */
export function getGameSfx(world: ENGINE.World): SfxManagerActor {
  if (_cached?.getWorld() === world) return _cached;
  _cached = SfxManagerActor.ensureExists(world);
  return _cached;
}
