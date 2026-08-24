# One-Shot and Procedural SFX

For sounds that aren't tied to a node you already control — an impact at a raycast hit point, a UI click, a pickup chime — use `GlobalAudioManager` instead of building a `SoundNode`. Source: `.engine/src/utils/GlobalAudioManager.ts`.

## Getting the manager

```typescript
const audio = this.getWorld()?.globalAudioManager; // bound to the current world
// or, equivalently, the singleton itself:
const audio = ENGINE.GlobalAudioManager.getInstance();
```

Both return the same instance — the world calls `setWorld(this)` on it during startup and `setWorld(null)` on teardown, which is what wires it to the current `AudioListener`/`AudioContext` and resets its buses between play sessions.

## Playing

```typescript
// Positional — snapshots `position` once; does not track a moving emitter.
const handle = await audio.playSoundAtPosition('@project/assets/sounds/impact.wav', hitPoint, {
  volume: 0.8,
  maxDistance: 20,
  bus: 'SFX',
});

// Non-positional — same volume everywhere.
const musicHandle = await audio.playGlobalSound('@project/assets/sounds/theme.mp3', {
  loop: true,
  bus: 'Music',
});
```

`GlobalSoundOptions`: `volume`, `loop`, `maxDistance`, `distanceModel`, `rolloffFactor`, `bus` (defaults to `'SFX'`). Both calls resolve to a `SoundHandle` (`{ id, audioUrl, isPositional }`) or `null` if there was no audio listener yet or the buffer failed to load.

Each call creates a brand-new `THREE.Audio`/`PositionalAudio` object — there is no pooling. That's what makes this the right tool for many simultaneous overlapping one-shots (unlike `SoundNode.play()`, which only ever has one "current" sound). It also means spawning one per frame in a tight loop (e.g. every tick of a scraping collision) will pile up concurrent voices — throttle at the call site.

`playSoundAtPositionSync` / `playGlobalSoundSync` are just aliases for the async methods (still return a `Promise`) — kept for call-site convenience, not a synchronous fast path.

## Stopping and cleanup

- Non-looping one-shots clean themselves up automatically when the clip's `onEnded` fires.
- Looping one-shots do not clean themselves up. Keep the returned `SoundHandle` and call `audio.stopSound(handle)` yourself, or it plays forever (and leaks the underlying `AudioBufferSourceNode`/`PositionalAudio`).
- `audio.stopAllSounds()` stops and cleans up everything tracked by the manager — useful on a scene/level transition. `world.destroy()`/end-play already calls this for you.
- `audio.isSoundPlaying(handle)`, `getPlayingSoundCount()`, `getPlayingSounds()` for introspection.

## Preloading

`await audio.loadSound(key, url)` warms the `resourceManager` cache ahead of time (`key` is only used for logging — the cache itself is keyed by URL). `isSoundLoaded(url)` / `getLoadedSounds()` check cache state. `unloadSound` / `unloadAllSounds` are thin logging wrappers — actual cache eviction is `resourceManager`'s responsibility (`unloadAllSounds` calls `resourceManager.clearCachedResources()`, which clears *all* cached resource types, not just sounds).

## Footgun: position is a snapshot, not tracking

`playSoundAtPosition` places a one-shot `PositionalAudio` at a fixed point and adds it directly to the world root — it does not parent to, or follow, any node. If a sound needs to move with something (a projectile whizzing past, an NPC's footsteps), attach a `SoundNode` to that node instead.
