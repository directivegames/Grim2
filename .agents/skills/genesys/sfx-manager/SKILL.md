# sfx-manager

A pooled sound effects manager for a Genesys game. Each sound key maps to a pool of `SoundComponent` instances that are played round-robin so the same sound can overlap itself without restarting. Supports distance attenuation, global SFX volume scaling, slomo-aware playback rate, and an optional per-key cooldown to prevent audio spam.

---

## How it works

At startup the manager creates `poolSize` `SoundComponent` instances per sound key and attaches them as components. A round-robin cursor picks the next slot on each `play()` call. On mobile it lazy-creates pools on first use to avoid blocking startup.

Playback rate is synced to the world's slomo value. A set of exempt keys (voice lines, UI sounds) always play at normal speed. When slomo ends, `syncPlaybackRates()` resets all pooled sources at once.

---

## 1. Define your sound registry

Copy `SfxManager.ts` from this skill's assets. Edit `SOUND_DEFS` at the top to list your project's sounds:

```ts
const SOUND_DEFS: Record<string, SoundDef> = {
  swordSwing:  { path: '@project/assets/sounds/sword.wav',  volume: 0.14, poolSize: 2 },
  explosion:   { path: '@project/assets/sounds/boom.wav',   volume: 0.5,  poolSize: 3 },
  menuSelect:  { path: '@project/assets/sounds/select.wav', volume: 0.4,  poolSize: 1 },
};
```

`poolSize` — how many simultaneous overlapping instances to allow. 2 is enough for most SFX. Set 1 for one-shot sounds that should not overlap.

Add keys that must always play at normal speed (voice, UI) to `NORMAL_RATE_KEYS`:

```ts
const NORMAL_RATE_KEYS = new Set(['menuSelect', 'voiceLine']);
```

---

## 2. Spawn the manager

Spawn once at game startup, before any SFX are needed:

```ts
const sfx = SfxManager.ensureExists(world);
```

Or place `SfxManagerActor` in your scene.

---

## 3. Play sounds

```ts
// Basic play (full volume)
sfx.play('swordSwing');

// Play with volume scale (e.g. 0.6 = 60% of default)
sfx.play('explosion', 0.6);

// Force restart even if already playing
sfx.play('menuSelect', 1.0, true);

// Distance attenuation — volume falls off linearly up to maxDistance
sfx.playAtDistance('explosion', sourcePos, playerPos, maxDistance, minVolume);
```

`playAtDistance` computes `scale = max(minVolume, 1 - dist / maxDistance)` and calls `play` with that scale.

---

## 4. Global volume

Apply a 0–1 scale from your settings slider:

```ts
sfx.applySfxVolume(gameSettings.sfxVolume); // call on settings change and on startup
```

---

## 5. Slomo integration

The manager reads `world.slomo` each time a sound is played and sets the audio source's playback rate to match. Keys in `NORMAL_RATE_KEYS` are exempt.

When slomo ends, reset all pooled rates at once:

```ts
sfx.syncPlaybackRates(1.0);
```

Call this from your slomo manager's exit callback.

---

## 6. Per-key cooldown (spam prevention)

Add a cooldown check before calling `play` for sounds that fire rapidly:

```ts
private _lastHitTime = 0;
private static readonly HIT_COOLDOWN_MS = 80;

onEnemyHit(): void {
  const now = performance.now();
  if (now - this._lastHitTime < SfxManagerActor.HIT_COOLDOWN_MS) return;
  this._lastHitTime = now;
  sfx.play('enemyHit');
}
```

This prevents 20 simultaneous hit sounds firing in one frame during dense combat.

---

## 7. Debug logging

Enable per-play console logging at runtime:

```ts
window.__SFX_DEBUG = true; // or whatever global key you wire in
```

---

## Constraints

- Spawn the manager before any code calls `play`. The easiest guarantee is to spawn it in `GameMode.postStart` or your game's startup flow.
- Do not call `play` from `endPlay` — the audio context may already be closing.
- `SoundComponent` is non-positional by default. For 3D positional audio set `positional: true` on the component — but for top-down or isometric games flat volume-scaled audio is usually sufficient.
- Mobile lazy-loading means the first play of each sound has a small latency. Pre-warm critical sounds (melee hits, death) by calling `_ensureSoundPool(key)` explicitly on gameplay start.
