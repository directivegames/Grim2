# SoundNode and SoundResource

Source: `.engine/src/nodes/audio/SoundNode.ts`, `.engine/src/nodes/audio/SoundResource.ts`.

## Mental model

- `SoundNode` — a `SceneNode` that owns one or more named `SoundResource` clips, loads them, and plays, stops, or loops them. Attach it to the node whose lifetime should own the sound (a torch, a weapon, a vehicle, an ambient marker).
- `SoundResource` — one clip: file path, volume, and spatial falloff. Not playable by itself; `SoundNode` turns each into a `THREE.Audio` or `THREE.PositionalAudio`.
- `GlobalAudioManager` — singleton (`world.globalAudioManager` or `ENGINE.GlobalAudioManager.getInstance()`) for one-shots that need no node, plus the bus mixer ([one-shot-sfx](one-shot-sfx.md)).
- Every sound routes through a named bus (`Master`, `SFX`, `Music`, `Voice`, `Ambience`), so a bus volume change affects every sound on it at once ([mixing-and-filters](mixing-and-filters.md)).

## SoundNode options

Create with `ENGINE.SoundNode.create({ ...options })`, then `parentNode.add(soundNode)`.

| Option | Default | Notes |
| --- | --- | --- |
| `sounds` | `[]` | `SoundResource[]`; each needs a unique `name`, used as the playback key. String entries are treated as serialized sound-resource asset paths and loaded with `resourceManager.loadResource` |
| `loop` | `false` | Applied to every clip on load |
| `positional` | `false` | `true` → 3D `PositionalAudio`; `false` → non-attenuated `Audio` |
| `autoPlay` | `false` | Plays once loading finishes in `beginPlay()` |
| `autoPlayClipKey` | first clip | Which clip `autoPlay` plays |
| `bus` | `'SFX'` | `Master` / `SFX` / `Music` / `Voice` / `Ambience`, or a custom bus |

## SoundNode methods

| Method | Notes |
| --- | --- |
| `play(key, volume?, forceRestart = false)` | Returns `Promise<boolean>`. No-ops (returns `false`) if a sound is already playing unless `forceRestart`; otherwise stops the current clip and plays `key`. Tries `context.resume()` first |
| `stop()` / `stopAll()` | Stop the current clip / every clip on this node |
| `pause()` / `resume()` | Pause / resume the current clip |
| `isSoundPlaying()` | Whether the current clip plays (not the node's lifecycle `isPlaying`) |
| `setVolume(key, v)` / `setVolumeAll(v)` | `v` clamped to `0..1` |
| `setLoop(key, loop)` | Per-clip loop |
| `getAudio(key)` | Raw `THREE.Audio` / `PositionalAudio` (pitch, custom WebAudio) |
| `getAudioContext()` | The listener's `AudioContext`, for filters; `undefined` when headless |
| `setFilter` / `setFilters` / `getFilters` | Per-clip WebAudio filter chain ([mixing-and-filters](mixing-and-filters.md)) |
| `waitForLoad()` / `isLoading()` | Await clip loading before `play()` |
| `onEnded` | Public field: one callback for the whole node, fires when the current clip ends |

`endPlay()` calls `stopAll()`, so removing the node stops its sounds.

## SoundResource fields

| Property | Default | Notes |
| --- | --- | --- |
| `name` | `''` | Playback key for `SoundNode.play(name)` |
| `audioPath` | `''` | Asset path, e.g. `'@project/assets/audio/explosion.wav'` |
| `volume` | `1.0` | `0..1` |
| `refDistance` | `1.0` | Spatial only |
| `maxDistance` | `10000` | Spatial only |
| `distanceModel` | `'inverse'` | `'linear' \| 'inverse' \| 'exponential'`, spatial only |
| `rolloffFactor` | `1.0` | Spatial only |

The spatial fields apply only when the owning `SoundNode` has `positional: true`; otherwise they are silently ignored.

## Spatial vs non-spatial

- `positional: true` → `PositionalAudio` parented to the `SoundNode`, falling off with distance per the resource. Use for anything with a world position.
- `positional: false` → plain `Audio`, same volume everywhere. Use for music, UI, voice-over.
- `world.audioListener` is synced to the active camera every tick, so falloff is relative to the camera, not the pawn's body. In a far third-person or top-down camera, raise `refDistance` so nearby sounds are not too quiet.

## Volume and pitch

- Volume: `setVolume(key, v)` / `setVolumeAll(v)`. Group volume and ducking go on the bus.
- Pitch: no wrapper. `soundNode.getAudio(key)?.setPlaybackRate(rate)` or `.setDetune(cents)`. A ±5 % random rate on repeated footsteps or shots hides repetition. `GlobalAudioManager` handles expose no audio object, so pitch variation needs a `SoundNode`.

## Load timing and the browser gesture

- Loading is fired (not awaited) inside `beginPlay()`. A `play(key)` right after `.create()` / `.add()` can log `Sound with key "..." not found`. Use `autoPlay` or `await soundNode.waitForLoad()`.
- A suspended `AudioContext` cannot resume without a user gesture. `SoundNode.play()` tries `context.resume()`; if the browser still blocks, `sound.play()` is called anyway and starts on the next interaction. That is expected, not a load failure.

## Example: looping positional ambience

Source: `.engine/src/nodes/audio/SoundNode.ts`, `.engine/src/nodes/audio/SoundResource.ts` — typechecked against 18.1.0-alpha.317
```typescript
@ENGINE.GameClass()
export class Torch extends ENGINE.SceneNode {
  private soundNode!: ENGINE.SoundNode;

  public override initialize(options?: ENGINE.SceneNodeOptions): void {
    super.initialize(options);
    const crackle = new ENGINE.SoundResource();
    crackle.name = 'crackle';
    crackle.audioPath = '@project/assets/audio/torch-crackle.wav';
    crackle.volume = 0.6;
    crackle.refDistance = 2;
    crackle.maxDistance = 15;
    this.soundNode = ENGINE.SoundNode.create({ name: 'Sound', sounds: [crackle], positional: true, loop: true, autoPlay: true, bus: 'Ambience' });
    this.add(this.soundNode);
  }
}
```

## Footsteps

One `SoundNode` with three synthesised takes (`synth.mjs sfx footstep` with `--seed 1/2/3`), a step every 0.45 s while the hero moves faster than 1 m/s (shorter when running), random take, ±5 % pitch. Attach the node to the hero pawn.

Source: `.engine/src/nodes/audio/SoundNode.ts` (`play(key, volume, forceRestart)`, `getAudio`) — typechecked against 18.1.0-alpha.317
```typescript
// Footsteps on the hero: one SoundNode with three takes, a step every 0.45 s while grounded and moving.
@ENGINE.GameClass()
export class Footsteps extends ENGINE.SceneNode {
  private steps: ENGINE.SoundNode | null = null;
  private timer = 0;
  private readonly last = new THREE.Vector3();

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const takes = ['@project/assets/audio/step-1.wav', '@project/assets/audio/step-2.wav', '@project/assets/audio/step-3.wav'].map((p, i) => {
      const r = new ENGINE.SoundResource(); r.name = `s${i}`; r.audioPath = p; r.volume = 0.4; r.refDistance = 3; r.maxDistance = 30; return r;
    });
    this.steps = ENGINE.SoundNode.create({ sounds: takes, positional: true, bus: 'SFX' });
    this.add(this.steps);
    this.getWorldPosition(this.last);
    return true;
  }

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    const pos = this.getWorldPosition(new THREE.Vector3());
    const speed = Math.hypot(pos.x - this.last.x, pos.z - this.last.z) / Math.max(dt, 1e-3);
    this.last.copy(pos);
    this.timer -= dt;
    if (speed < 1 || this.timer > 0 || !this.steps) return;   // add the pawn's grounded check here
    this.timer = 0.45 * Math.min(1, 4 / speed);               // faster steps when running
    const key = `s${Math.floor(Math.random() * 3)}`;
    this.steps.getAudio(key)?.setPlaybackRate(0.95 + Math.random() * 0.1);
    void this.steps.play(key, undefined, true);
  }
}
```

Gate it on the movement component's grounded state (`genesys-movement`) so jumps and falls are silent.

## Ambience placed in the scene

A waterfall, campfire, or wind at a cliff edge belongs to the level, so it is editor state.

**Route A — `SoundNode` through MCP.** `query_editor(operation="getState")` → `action_node(action="add", className="ENGINE.SoundNode")` at the source's position → `query_node(operation="getEditableProperties", …)` to read the exact paths → `action_node(action="setProperties", …)` with `loop: true`, `positional: true`, `autoPlay: true`, `bus: "Ambience"`, and one entry in `soundResources` (`name`, `audioPath` `"@project/assets/audio/wind.wav"`, `volume` 0.3, `refDistance` 5, `maxDistance` 40) → `action_scene(action="save")` → re-query. `soundResources` is an array of `SoundResource` objects (`@property({ type: 'array', child: { type: 'resource', resourceType: 'SoundResource' } })`); a string entry is read as the path of a saved sound-resource asset. Nested objects set through MCP can read back fine and not persist: after saving, re-query the node and check that `soundResources[0].audioPath` survived; verify in Play that it sounds.

**Route B — a placeable class** when route A does not persist. Its clip is a plain string property, which always saves; the class builds the `SoundNode` at `beginPlay`, so nothing extra is serialized. Build it (`genesys-game-boot` build sequence), then place it with `action_node(action="add", className="GAME.AmbientSound")` and set `clip`, `volume`, `radius`.

Source: `.engine/src/nodes/audio/SoundNode.ts`, `.engine/src/nodes/audio/SoundResource.ts`, `.engine/src/nodes/gameplay/PickupNode.ts` (`type: 'audioPath'` property) — typechecked against 18.1.0-alpha.317
```typescript
// A placeable ambience emitter whose clip is a plain string property (strings persist through MCP and save).
@ENGINE.GameClass()
export class AmbientSound extends ENGINE.SceneNode {
  @ENGINE.property({ type: 'audioPath', description: 'Looping ambience clip' })
  public clip = '';
  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.05 })
  public volume = 0.3;
  @ENGINE.property({ type: 'number', min: 1, max: 200 })
  public radius = 25;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    if (!this.clip) return true;
    const res = new ENGINE.SoundResource();
    res.name = 'bed';
    res.audioPath = this.clip;
    res.volume = this.volume; res.refDistance = Math.max(1, this.radius * 0.2); res.maxDistance = this.radius;
    this.add(ENGINE.SoundNode.create({ sounds: [res], positional: true, loop: true, autoPlay: true, bus: 'Ambience' }));
    return true;
  }
}
```

Weather and room tone that are everywhere (rain over the whole level) are non-positional: `positional: false`, started once from the GameMode with `playGlobalSound(clip, { loop: true, volume: 0.25, bus: 'Ambience' })`, handle kept and stopped on result.

## Source index

| File | Contents |
| --- | --- |
| `.engine/src/nodes/audio/SoundNode.ts` | Node-attached clip playback, buses, filters |
| `.engine/src/nodes/audio/SoundResource.ts` | Clip definition and spatial params |
| `.engine/src/utils/GlobalAudioManager.ts` | Singleton one-shot playback and bus registry |
| `.engine/src/utils/AudioBus.ts` | Bus gain-node wrapper (`connect`, `setVolume`, `getInput`) |

## Traps

The common traps are in [SKILL.md → Traps](../SKILL.md#traps).

- `Sound with key "..." not found` → `play()` raced the async load in `beginPlay`. Use `autoPlay`, or `await soundNode.waitForLoad()` first.
- `refDistance` / `maxDistance` change nothing → the `SoundNode` is not `positional: true`.
