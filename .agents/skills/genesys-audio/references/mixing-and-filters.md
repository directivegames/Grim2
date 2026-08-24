# Mixing: Buses and Filters

Source: `.engine/src/utils/GlobalAudioManager.ts` (bus registry), `.engine/src/utils/AudioBus.ts` (bus implementation), `.engine/src/nodes/audio/SoundNode.ts` (per-clip filters).

## The bus graph

Every sound — whether from a `SoundNode` or a `GlobalAudioManager` one-shot — is routed through a named bus, not directly to the listener. Five buses are created automatically the first time the audio system initializes (when a world with a non-null `audioListener` exists):

```
Master  ← SFX
        ← Music
        ← Voice
        ← Ambience
```

`Master` connects to the `AudioListener`'s input; the other four default-connect to `Master` unless you specify a different parent. `SoundNode.bus` (default `'SFX'`) and `GlobalSoundOptions.bus` (default `'SFX'`) both select which bus a sound's gain node is routed through.

## Getting and creating buses

```typescript
const audio = ENGINE.GlobalAudioManager.getInstance();

const sfxBus = audio.getBus('SFX');       // undefined if audio not yet initialized
sfxBus?.setVolume(0.5);                    // duck all SFX to 50%

const reverbBus = audio.addBus('Reverb', 'SFX'); // get-or-create, parented under SFX
```

- `getBus(name)` / `addBus(name, parentBusName?)` both lazily initialize the bus graph first, so they're safe to call as soon as a world exists — no need to wait for a specific lifecycle hook.
- `createBus(name, parentBusName?)` is the lower-level primitive `addBus` calls; it throws if there's no `AudioContext` yet (headless world, or called before the listener exists). Prefer `addBus`.
- The object returned by `getBus`/`addBus` wraps a WebAudio `GainNode`: `connect(destination)`, `disconnect(destination?)`, `setVolume(value, time?)` (pass `time` for a linear ramp via `linearRampToValueAtTime`), `getVolume()`, `getInput()` (the raw `GainNode`, for connecting your own WebAudio sources).

Both `SoundNode` clips and `GlobalAudioManager` one-shots are routed onto their
bus at playback time. Muting or ducking a bus (e.g. `getBus('Music')?.setVolume(0.1)`
while a cutscene plays) therefore affects every sound already routed to it,
immediately, without touching individual `SoundNode`/`SoundHandle` volumes.

## WebAudio filters on a SoundNode clip

```typescript
const ctx = soundNode.getAudioContext();
if (ctx) {
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 800;
  soundNode.setFilter('crackle', lowpass);       // single filter
  // or: soundNode.setFilters('crackle', [lowpass, otherNode]); // chained, in order
}
```

`getFilters(key)` returns the currently applied chain. `getAudioContext()` returns `undefined` if there's no `AudioListener` (headless world) — guard before constructing filter nodes.

## Footgun: no listener, no audio system

`createBus`, `getAudioContext`, and any `SoundNode` playback all depend on a live `THREE.AudioListener`, which only exists on a non-headless world. Server-only / headless game loops have `world.audioListener === null` — don't assume bus or filter calls succeed there; guard with `NetRuntime` checks or a null check as appropriate for the surrounding code.
