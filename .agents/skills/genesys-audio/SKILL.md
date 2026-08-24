---
name: genesys-audio
description: Sound, audio, music, SFX, ambient sound, and spatial (3D positional) audio in Genesys. Covers SoundNode playback, SoundResource clip properties, looping/autoplay, volume and pitch control, audio buses (Music/SFX/Voice/Ambience), one-shot procedural sounds, and loading sound assets. Use when adding, playing, mixing, or debugging any sound effect, music track, or ambient audio.
---

# Audio

Engine audio lives in `.engine/src/nodes/audio/` (`SoundNode`, `SoundResource`) and `.engine/src/utils/GlobalAudioManager.ts` / `AudioBus.ts`. Read source for exact signatures — this skill maps what exists and flags non-obvious pitfalls.

## Mental model

- `SoundNode` — a `SceneNode` that owns one or more named `SoundResource` clips, loads them, and plays/stops/loops them. Attach one to any node whose lifetime should own the sound (a torch, a weapon, an ambient marker).
- `SoundResource` — describes one clip: file path, volume, and spatial falloff params. Not playable by itself; `SoundNode` turns each one into a `THREE.Audio` or `THREE.PositionalAudio`.
- `GlobalAudioManager` — singleton (`world.globalAudioManager` or `ENGINE.GlobalAudioManager.getInstance()`) for fire-and-forget one-shots that don't need a dedicated node, plus the bus mixer. See [one-shot-sfx](references/one-shot-sfx.md).
- Every sound is routed through a named bus (`Master`, `SFX`, `Music`, `Voice`, `Ambience` by default), so a bus volume change (ducking, mute) affects every sound on it at once. See [mixing-and-filters](references/mixing-and-filters.md).

## Methodology

1. Sound tied to a node's lifetime — footsteps, engine hum, weapon fire/reload, a looping ambience — attach a `SoundNode` to that node.
2. One-shot SFX at a position or globally, not owned by a node you control (impact at a raycast hit, a UI click) — use `GlobalAudioManager.playSoundAtPosition` / `playGlobalSound`.
3. Need mixing (music ducking, mute SFX, a master volume slider) or WebAudio filters (lowpass, reverb) — read [mixing-and-filters](references/mixing-and-filters.md).
4. Always reference clips through `@project/...` / `@engine/...` asset paths, never raw URLs or relative paths — same convention used for textures and models.

## SoundNode

Create with `ENGINE.SoundNode.create({ ...options })`, then `parentNode.add(soundNode)`.

| Option | Default | Notes |
| --- | --- | --- |
| `sounds` | `[]` | `SoundResource[]`; each needs a unique `name` used as the playback key |
| `loop` | `false` | Applied to every clip on load |
| `positional` | `false` | `true` → 3D `PositionalAudio`; `false` → non-attenuated `Audio` |
| `autoPlay` | `false` | Plays once loading finishes in `beginPlay()` |
| `autoPlayClipKey` | first clip | Which clip `autoPlay` plays |
| `bus` | `'SFX'` | Bus name to route through (`Master`/`SFX`/`Music`/`Voice`/`Ambience`, or a custom bus) |

| Method | Notes |
| --- | --- |
| `play(key, volume?, forceRestart?)` | Stops the current clip and plays `key`. No-ops if something is already playing unless `forceRestart: true`. |
| `stop()` / `stopAll()` | Stop the current clip / stop every clip on this node |
| `pause()` / `resume()` | Pause/resume the current clip |
| `isSoundPlaying()` | Whether the current clip is playing (not the node's play-lifecycle `isPlaying`) |
| `setVolume(key, v)` / `setVolumeAll(v)` | `v` clamped to `0..1` |
| `setLoop(key, loop)` | Per-clip loop toggle |
| `getAudio(key)` | Raw `THREE.Audio`/`PositionalAudio` for direct WebAudio access (pitch, custom nodes) |
| `getAudioContext()` | The listener's `AudioContext`, for building filters |
| `setFilter` / `setFilters` / `getFilters` | WebAudio filter chain per clip — see [mixing-and-filters](references/mixing-and-filters.md) |
| `onEnded` | Public field: one callback for the whole node, fires whenever the current clip ends |

## SoundResource

| Property | Default | Notes |
| --- | --- | --- |
| `name` | `''` | Playback key passed to `SoundNode.play(name)` |
| `audioPath` | `''` | Asset path (`AudioPath`), e.g. `'@project/assets/sounds/Explosion.wav'` |
| `volume` | `1.0` | `0..1` |
| `refDistance` | `1.0` | Spatial only |
| `maxDistance` | `10000` | Spatial only |
| `distanceModel` | `'inverse'` | `'linear' \| 'inverse' \| 'exponential'`, spatial only |
| `rolloffFactor` | `1.0` | Spatial only |

The `refDistance`/`maxDistance`/`distanceModel`/`rolloffFactor` fields are only applied when the owning `SoundNode` has `positional: true` — they're silently ignored on non-positional clips.

## Spatial vs non-spatial

- `positional: true` → `THREE.PositionalAudio` parented to the `SoundNode`; falls off with distance from it per the resource's spatial params. Use for anything with a world position (a weapon, a door, a character, a torch).
- `positional: false` (default) → plain `THREE.Audio`, same volume regardless of listener distance. Use for music, UI sounds, voice-over.
- The world's `AudioListener` (`world.audioListener`) is synced to the active camera every tick, so spatial falloff is relative to the camera, not necessarily the player pawn's body.

## Loading sounds

- Reference clips with `@project/...` / `@engine/...` asset paths — see this project's asset-path conventions for the full pattern.
- Two ways to attach clips: construct `SoundResource` instances inline and pass `sounds: [...]` to `SoundNode.create(...)` (see example below), or point at a serialized sound-resource asset file and pass its path string — `SoundNode.beginPlay()` resolves string entries via `resourceManager.loadResource(AssetPath.fromString(path))`.
- Loading happens asynchronously inside `beginPlay()`, not the constructor or `initialize()` — see Footguns.

## Volume and pitch

- Volume: `soundNode.setVolume(key, 0..1)` / `setVolumeAll(...)`. For group volume or ducking, adjust the bus instead (see [mixing-and-filters](references/mixing-and-filters.md)).
- Pitch: `SoundNode` has no pitch/playback-rate wrapper. Get the raw sound via `soundNode.getAudio(key)` and call its native `setPlaybackRate(rate)` / `setDetune(cents)`.

## Example: looping ambient positional sound

```typescript
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class Torch extends ENGINE.SceneNode {
  private soundNode!: ENGINE.SoundNode;

  public override initialize(options?: ENGINE.SceneNodeOptions): void {
    super.initialize(options);

    const crackle = new ENGINE.SoundResource();
    crackle.name = 'crackle';
    crackle.audioPath = '@project/assets/sounds/torch_crackle.wav';
    crackle.volume = 0.6;
    crackle.refDistance = 2;
    crackle.maxDistance = 15;

    this.soundNode = ENGINE.SoundNode.create({
      name: 'Sound',
      sounds: [crackle],
      positional: true, // 3D — falls off with distance from this torch
      loop: true,
      autoPlay: true,
      bus: 'Ambience',
    });
    this.add(this.soundNode);
    // No manual stop() needed on removal — SoundNode.endPlay() calls stopAll().
  }
}
```

## Footguns

- Autoplay / browser gesture restriction — a suspended `AudioContext` cannot resume without a user gesture. `SoundNode.play()` tries `context.resume()` and, if the browser still blocks it, queues the sound to start on the next user interaction instead of failing — this is expected, not a bug; don't assume a sound that doesn't start immediately failed to load.
- Calling `play()` right after creating a node races the load — clip loading is fired-and-forgotten inside `beginPlay()` (not awaited), so a `play(key)` called immediately after `.create()`/`.add()` can log `Sound with key "..." not found` if loading hasn't finished. Prefer `autoPlay`, or `await soundNode.waitForLoad()` before calling `play()`.
- Spatial params ignored on non-positional clips — setting `refDistance`/`maxDistance`/etc. on a `SoundResource` does nothing unless the owning `SoundNode` has `positional: true`.
- Only one "current" sound per `SoundNode` — `play()` stops whatever was previously current. Rapid, overlapping one-shots (gunfire, footsteps) need either `forceRestart: true` (still serialized to one voice) or `GlobalAudioManager.playSoundAtPosition`/`playGlobalSound`, which spins up an independent `Audio` object per call.
- Not disposing looping sounds — a `SoundNode` stops its sounds automatically in `endPlay()`, but a looping `GlobalAudioManager` one-shot (`loop: true`) is never auto-cleaned; keep its `SoundHandle` and call `stopSound(handle)` yourself or it plays forever.
- SFX spam — nothing pools or rate-limits one-shot calls; spawning one per frame (e.g. every physics tick of a scraping collision) will pile up overlapping voices. Throttle at the call site.

## Source index

| File | Contents |
| --- | --- |
| `.engine/src/nodes/audio/SoundNode.ts` | Node-attached clip playback, buses, filters |
| `.engine/src/nodes/audio/SoundResource.ts` | Clip definition and spatial params |
| `.engine/src/utils/GlobalAudioManager.ts` | Singleton one-shot playback and bus registry |
| `.engine/src/utils/AudioBus.ts` | Bus gain-node wrapper (`connect`, `setVolume`, `getInput`) |

## References

- [one-shot-sfx](references/one-shot-sfx.md): `GlobalAudioManager` one-shot playback, handles, and cleanup, for sounds not owned by a `SoundNode`.
- [mixing-and-filters](references/mixing-and-filters.md): The bus graph, custom buses, ducking, and WebAudio filter chains.

Related: combining sound with particle effects — see the `genesys-vfx` skill.
