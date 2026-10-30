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

Source: `.engine/src/utils/GlobalAudioManager.ts` (`getBus`, `addBus`) — typechecked against 18.1.0-alpha.317
```typescript
const audio = ENGINE.GlobalAudioManager.getInstance();

const sfxBus = audio.getBus('SFX');       // undefined if audio not yet initialized
sfxBus?.setVolume(0.5);                    // duck all SFX to 50%

const reverbBus = audio.addBus('Reverb', 'SFX'); // get-or-create, parented under SFX
```

- `getBus(name)` / `addBus(name, parentBusName?)` both lazily initialize the bus graph first, so they're safe to call as soon as a world exists — no need to wait for a specific lifecycle hook.
- `createBus(name, parentBusName?)` is the lower-level primitive `addBus` calls; it throws if there's no `AudioContext` yet (headless world, or called before the listener exists). Prefer `addBus`.
- The object returned by `getBus`/`addBus` wraps a WebAudio `GainNode`: `connect(destination)`, `disconnect(destination?)`, `setVolume(value, duration?)`, `getVolume()`, `getInput()` (the raw `GainNode`, for connecting your own WebAudio sources).
- `setVolume(value, duration?)` sets the level at once, or ramps linearly from the current level when `duration` is a positive number of seconds from now (not an `AudioContext` timestamp). `setVolume(0, 1.5)` fades out over 1.5 s.
- The bus graph is rebuilt for each Play session (`setWorld` tears it down). Apply saved volumes at `beginPlay`, not once per page load.

Both `SoundNode` clips and `GlobalAudioManager` one-shots are routed onto their
bus at playback time. Muting or ducking a bus (e.g. `getBus('Music')?.setVolume(0.1)`
while a cutscene plays) therefore affects every sound already routed to it,
immediately, without touching individual `SoundNode`/`SoundHandle` volumes.

## WebAudio filters on a SoundNode clip

Source: `.engine/src/nodes/audio/SoundNode.ts` (`getAudioContext`, `setFilter`, `setFilters`) — typechecked against 18.1.0-alpha.317
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

## Common mix moves

Source: `.engine/src/utils/AudioBus.ts` (`setVolume(value, duration?)`), `.engine/src/utils/GlobalAudioManager.ts` (`getBus`) — typechecked against 18.1.0-alpha.317
```typescript
const audio = world.globalAudioManager;
// Music on/off from a pause-menu Toggle (genesys-ui):
const musicToggle = new ENGINE.Toggle(world.uiManager, { on: true, onChange: (on) => audio.getBus('Music')?.setVolume(on ? 1 : 0) });
// Duck music under the result screen, then restore on Retry:
audio.getBus('Music')?.setVolume(0.4);
audio.getBus('Music')?.setVolume(1);
```

- Bus volume multiplies the clip volume. Keep buses at 1 and set per-clip levels (see the sound-set table in `genesys-audio`); use the bus for mute, ducking, and the settings volumes. The settings screen and its `(v / 100) ** 2` mapping are in `genesys-ui` (`references/settings-and-style.md`).
- `Voice` is the bus for voice-over clips. It is not voice chat; the engine has no voice chat (`genesys-multiplayer`).
- Music and effects always sit on different buses (`Music`, `SFX`). A loud loop that hides the main action is a mix defect: lower the loop, never delete the action sound.

## Music switching (crossfade)

Title → play → boss → result can each have a track. Swap with a 1–2 s crossfade, never a hard stop and play. Two child buses under `Music` carry the outgoing and incoming tracks; the settings' Music volume still applies on top, because both children feed `Music`.

Source: `.engine/src/utils/GlobalAudioManager.ts` (`addBus`, `playGlobalSound`, `stopSound`), `.engine/src/utils/AudioBus.ts` (`setVolume`) — typechecked against 18.1.0-alpha.317
```typescript
// Music switching with a crossfade: two child buses under Music, one track on each.
// AudioBus.setVolume(v, duration) ramps from the current level over `duration` seconds.
function rampBus(world: ENGINE.World, name: string, to: number, seconds: number): void {
  if (!world.audioListener) return;                   // headless: no audio graph
  world.globalAudioManager.addBus(name, 'Music').setVolume(to, seconds);   // get-or-create
}

export class MusicDeck {
  private live: 'MusicA' | 'MusicB' = 'MusicA';
  private handle: ENGINE.SoundHandle | null = null;
  constructor(private readonly world: ENGINE.World) {}

  public async play(clip: string, volume = 0.35, fadeSeconds = 1.5): Promise<void> {
    if (!this.world.audioListener) return;            // headless server
    const audio = this.world.globalAudioManager;
    const next = this.live === 'MusicA' ? 'MusicB' : 'MusicA';
    audio.addBus(next, 'Music').setVolume(0);
    const nextHandle = await audio.playGlobalSound(clip, { loop: true, volume, bus: next });
    rampBus(this.world, next, 1, fadeSeconds);
    rampBus(this.world, this.live, 0, fadeSeconds);
    const old = this.handle;
    setTimeout(() => { if (old) audio.stopSound(old); }, fadeSeconds * 1000 + 100);
    this.handle = nextHandle;
    this.live = next;
  }
}
```

- One `MusicDeck` per game, created in the GameMode. `play()` the title bed on the title, the run track on Start, the boss track when the boss appears; calling it with the clip that is already playing restarts it, so guard with the current clip name.
- Ducking for a stinger or a result screen: ramp `Music` to 0.4 over 0.3 s with `setVolume(0.4, 0.3)`, and back to 1 after.
- Verify in Play that the fade is audible and the old track stops after it (the ramp shape is WebAudio behaviour, not engine code).

## Limitations

- Music cuts hard from title to combat → two tracks swapped with stop/play. Crossfade between two child buses.

## Traps

The common traps are in [SKILL.md → Traps](../SKILL.md#traps).

- Bus or filter calls fail on the server → headless worlds have no `audioListener`. Guard with a null check.
- `getBus(...).setVolume(0)` cuts instead of fading → pass a duration in seconds: `setVolume(0, 1.5)` ramps over 1.5 s (*Common mix moves*).
