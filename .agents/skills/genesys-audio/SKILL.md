---
name: genesys-audio
description: "Sound and music: SoundNode, one-shots, buses, spatial audio, music crossfades, ambience loops, clip sources (project, engine, bundled synth), and the sound set every game ships. Use for any sound, music, SFX, footsteps, ambience, wind, rain, engine hum, 3D sound, volume, mute, ducking, a silent game. Not for the settings screen (use `genesys-ui`), Scenario audio (use `genesys-generated-assets`) or MP3 compression (use `genesys-asset-compiler`)."
metadata:
  tokens: 2988
---

# Audio

This skill owns playback (`SoundNode`, `GlobalAudioManager`), the bus mix, spatial audio, ambience, music switching, and the sound defaults every game ships. The one rule: every game has a music bed and a sound on the main action, UI confirm, hit, and death. A silent game, or a silent confirm, is a defect.

## Use another skill when
- Which route a clip takes, its Assets row, the size budget table → `genesys-assets`
- A clip generated with Scenario (only when the project's art routes name it) → `genesys-generated-assets`
- Which moments deserve a sound and how strong → `genesys-game-feel`
- The particle half of the same moment → `genesys-vfx`
- The settings screen, Music/Effects volume controls, mute toggle, hover and confirm wiring on widgets → `genesys-ui`
- Saving the volumes across sessions → `genesys-game-boot`
- Voice chat or who hears a networked sound → `genesys-multiplayer`
- Turning on MP3 transcoding at build → `genesys-asset-compiler`
- Placing an ambience emitter in the scene through MCP → `genesys-mcp-orchestrator` (the recipe is in [sound-node](references/sound-node.md))

## Decide

### The sound set every game ships

| Slot | Default | Bus | Volume |
|---|---|---|---|
| Music bed | One looping track, started on the title as soon as the game loads, kept across Start and Retry | `Music` | 0.3–0.4 |
| Main action (shoot, jump, swing, kick, place) | One-shot, preloaded, throttled | `SFX` | 0.6–0.8 |
| UI confirm (Start, Resume, Retry, Next) and hover | One-shot from the button's `onClick`; hover tick on menu buttons | `SFX` | 0.5 confirm, 0.2 hover |
| Hit (player hits or is hit) | One-shot at the hit point | `SFX` | 0.7–0.9 |
| Death / fail | One-shot, loudest event | `SFX` | 1.0 |
| Pickup / score | Short one-shot | `SFX` | 0.6 |
| Footsteps (walking heroes) | `SoundNode` on the pawn, played on a step timer, ±5 % pitch | `SFX` | 0.3–0.5 |
| Ambience (wind, rain, fire, hum, birds) | Looping `SoundNode`, positional at its source or non-positional for weather | `Ambience` | 0.2–0.4 |

The music bed is never an open item. The engine ships no music track, so it is a project file or a `synth.mjs` loop, which always reaches it (Scenario only when the project's art routes name it). A game with sound also ships Music and Effects volume controls (`genesys-ui`).

### Where each clip comes from

In order ([clip-sources](references/clip-sources.md)):
1. **Project files** the user has → under `assets/audio/`, as `@project/assets/audio/<file>`.
2. **Engine sounds** in `@engine/assets/sounds/`: `laser.mp3`, `game-gun-short.mp3`, `explosion.mp3`, `pickup.mp3`, `tuba.mp3` (fail sting), `birds.mp3` (ambience). No music, footsteps, UI click or weather loops.
3. **Synthesised**, offline and free: `node .agents/skills/genesys-audio/scripts/synth.mjs list`, then `sfx <preset> assets/audio/<name>.wav [--seed N --pitch 0.9 --loop]` or `music <mood> assets/audio/<name>.wav [--bars 16 --key D]`. Ambience presets (wind, rain, hum, fire) render seamless loops; moods are dark, tense, heroic, upbeat, calm, mystic, picked from the art direction. Vary `--seed` / `--pitch` so no two sounds share a clip. Use the exact `@project/...` path each run prints, and tell the user which clips are synthesised (you cannot hear them).
4. **Scenario**, only when the art routes include it → `genesys-generated-assets`, then wire it here.

**Size.** Synth WAV is ~86 KB/s and ships raw unless audio compression is on (then MP3, ~16 KB/s). For synthesised music, turn compression on (`genesys-asset-compiler`) or keep the bed under the 1.5 MB budget: 8 bars at 110 bpm or faster.

Write asset paths as string literals. Never build them from variables. Never play game sound through an `<audio>` element or a URL loader, and never create or touch an `<audio>` element per frame: it stutters while moving and ignores the buses.

### Which API

| Job | API |
|---|---|
| Sound owned by a node (engine hum, torch, footsteps, a weapon's reload) | `SoundNode` child of that node |
| Ambience placed in the level (a waterfall, a fire, wind at a cliff) | A `SoundNode` placed through MCP, or a small placeable class ([sound-node](references/sound-node.md)) |
| One-shot at a point (impact, explosion, pickup) | `world.globalAudioManager.playSoundAtPosition` |
| Non-spatial one-shot or loop (UI, music, stingers) | `world.globalAudioManager.playGlobalSound` |
| Group volume, mute, ducking, settings | `getBus(name).setVolume(v)` |
| Music switching (title → combat → boss) | Crossfade between two child buses ([mixing-and-filters](references/mixing-and-filters.md)) |
| Lowpass, reverb-like filtering | `SoundNode.setFilter` / `setFilters` |

Spatial (`positional: true`) for anything with a world position; non-spatial for music, UI, weather beds, and voice-over. The listener follows the active camera, not the pawn's body.

## Build

### Music bed

Start the bed on the title, not on the Start click: the title is the first thing the player hears. `playGlobalSound` resumes the `AudioContext`.

Source: `.engine/src/utils/GlobalAudioManager.ts` (`playGlobalSound`, `stopSound`); `.engine/src/game/World.ts` (`audioListener`) — typechecked against 18.1.0-alpha.317
```ts
// GameMode, once the screens are mounted and the Title state is shown.
if (!this.music) {
  this.music = await world.globalAudioManager.playGlobalSound('@project/assets/audio/music-loop.wav',
    { loop: true, volume: 0.35, bus: 'Music' });
}
// Start and Retry keep the same handle. To stop early (world end stops it for you):
if (this.music) { world.globalAudioManager.stopSound(this.music); this.music = null; }
```

A second track (combat, boss, result) crossfades in over 1–2 s instead of cutting: [mixing-and-filters](references/mixing-and-filters.md) → *Music switching*.

### One-shots with a cooldown and a voice cap

Each `playSoundAtPosition` or `playGlobalSound` call makes a new audio object. There is no voice pool. Skip a repeat of the same clip inside 40–80 ms, and cap concurrent one-shots with `getPlayingSoundCount()`.

Source: `.engine/src/utils/GlobalAudioManager.ts` (`playSoundAtPosition`, `playGlobalSound`, `getPlayingSoundCount`); the throttle is game code — typechecked against 18.1.0-alpha.317
```ts
const lastPlayed = new Map<string, number>();
export function playSfx(world: ENGINE.World, clip: string, at?: THREE.Vector3, volume = 0.8, minGapMs = 60): void {
  const now = performance.now();
  if (now - (lastPlayed.get(clip) ?? 0) < minGapMs) return;   // per-clip cooldown
  const audio = world.globalAudioManager;
  if (audio.getPlayingSoundCount() >= 24) return;
  lastPlayed.set(clip, now);
  void (at ? audio.playSoundAtPosition(clip, at, { volume, bus: 'SFX' })
           : audio.playGlobalSound(clip, { volume, bus: 'SFX' }));
}
```

Preload the main-action clips in `beginPlay` with `await world.globalAudioManager.loadSound(name, clip)` so the first shot is not the first decode.

### Sound owned by a node

Source: `.engine/src/nodes/audio/SoundNode.ts`, `.engine/src/nodes/audio/SoundResource.ts` — typechecked against 18.1.0-alpha.317
```ts
const hum = new ENGINE.SoundResource();
hum.name = 'hum';
hum.audioPath = '@project/assets/audio/engine-hum.wav';
hum.volume = 0.5; hum.refDistance = 2; hum.maxDistance = 25;
const sound = ENGINE.SoundNode.create({ sounds: [hum], positional: true, loop: true, autoPlay: true, bus: 'Ambience' });
this.add(sound); // endPlay() stops it; no manual cleanup
```

Tables, pitch, footsteps, the load race, ambience placed in the scene: [sound-node](references/sound-node.md).

## Limitations
- A wall of noise in a big fight → no cooldown or cap. Throttle per clip (40–80 ms) and cap concurrent voices.
- Hard music cuts between tracks (no built-in crossfade): [mixing-and-filters](references/mixing-and-filters.md#limitations).

## Traps
- No music in Play → the music bed was never added. Add one; the engine has no track, so import or synthesise (`synth.mjs music`).
- Start, Resume, or Retry is silent, or menus have no hover tick → play the one-shots from the widget (`genesys-ui` → *Sound on UI*).
- Music only starts after Start is pressed → the bed was started from the Start click → start it on the title (*Music bed*).
- Rapid fire cuts its own tail off → `SoundNode` has one current sound; `play()` no-ops while it plays unless `forceRestart`. Use `GlobalAudioManager` one-shots for overlapping shots.
- A looping one-shot never stops → keep its `SoundHandle` and call `stopSound(handle)`.
- A projectile's sound stays where it was fired → `playSoundAtPosition` is a snapshot. Attach a `SoundNode` to the moving node.
- Music hides the main action → lower the `Music` bus or clip volume. Never delete the action sound.
- First shot is late → preload with `loadSound`.
- Stutter that appears only during movement and doesn't change with quality settings → audio, not rendering: an `<audio>` element created or seeked every frame. Use `SoundNode` or `GlobalAudioManager`.
- `SoundNode` load race and `refDistance`: [sound-node](references/sound-node.md#traps). Bus fades, server worlds: [mixing-and-filters](references/mixing-and-filters.md#traps). Loop clicks, WAV size, synth `WARN`: [clip-sources](references/clip-sources.md#traps).

## Done
- In Play the music bed is audible on the title and keeps playing through Start and Retry without a second copy; a track change crossfades.
- The main action, a hit, a death, a pickup (if any), and every confirm button make a sound; menu buttons tick on hover.
- Holding fire for 10 s gives steady shots without clipping, and after a 2-minute run every sound effect still plays.
- Spatial sounds get quieter with distance from the camera; ambience loops play without an audible seam.
- Moving the Music and Effects volumes in settings changes what you hear (`genesys-ui`).
- Every clip path is a literal `@project/assets/...` or `@engine/assets/...` that exists on disk, and `node .agents/skills/genesys-assets/scripts/asset-check.mjs` passes with no unreferenced audio.
- Synthesised music either ships compressed (the synth printed `ships as MP3`) or is under the 1.5 MB music budget raw.

## References
- [clip-sources](references/clip-sources.md) — project, engine, synth (presets, flags, measured loop lengths and sizes), Scenario; choosing a clip per slot; clip traps
- [sound-node](references/sound-node.md) — `SoundNode` options and methods, `SoundResource` fields, spatial vs non-spatial, pitch, footsteps, load timing, ambience placed through MCP, traps
- [one-shot-sfx](references/one-shot-sfx.md) — `GlobalAudioManager` playback, handles, cleanup, preloading
- [mixing-and-filters](references/mixing-and-filters.md) — bus graph, custom buses, ducking, mute, settings volumes, music crossfades, WebAudio filters, mix limitations and traps
