# Where clips come from

Order: a project file the user has → an engine sound that fits → a clip from the bundled synth (`scripts/synth.mjs`) → Scenario, only when the project's art-routes line names it. Every clip is referenced by a literal asset path. The music bed is never left open: the synth always reaches it.

## Project files

- Clips live under `assets/audio/` and are referenced as `@project/assets/audio/<file>`.
- A clip the user supplies is copied into `assets/audio/` first. A file outside the project is not playable.
- WAV, FLAC, AIFF, OGG and M4A ship as they are unless the asset compiler's audio compression is on; then the build makes MP3 and remaps the path (`genesys-asset-compiler`). AAC always ships as it is.

## Engine sounds

The engine package ships six sound files in `node_modules/@gnsx/genesys.js/assets/sounds/`. Reference them as `@engine/assets/sounds/<file>`.

| File | Length | Good for |
|---|---|---|
| `laser.mp3` | 1.1 s | Sci-fi shot, zap, beam, energy cast |
| `game-gun-short.mp3` | 1.9 s | Gunshot, blaster; the engine FPS and VR demos use it |
| `explosion.mp3` | 2.1 s | Explosion, death burst, heavy impact |
| `pickup.mp3` | 0.5 s | Pickup, coin, score tick, UI confirm fallback |
| `tuba.mp3` | 4.1 s | Comic fail or game-over sting |
| `birds.mp3` | 5.0 s | Outdoor daytime ambience loop |

There is no engine music track, footstep set, UI click, hurt sound, or wind, rain, fire or hum loop. Those come from the project or the synth. Check the folder again after an engine upgrade.

## The synth (`scripts/synth.mjs`)

Offline, no network, no credits. Writes mono 16-bit 44.1 kHz WAV (about 86 KB per second).

```bash
node .agents/skills/genesys-audio/scripts/synth.mjs list
node .agents/skills/genesys-audio/scripts/synth.mjs sfx <preset> assets/audio/<name>.wav [--seed 1] [--pitch 1.0] [--length 1.0] [--volume 0.9] [--loop]
node .agents/skills/genesys-audio/scripts/synth.mjs music <mood> assets/audio/<name>.wav [--bpm N] [--bars 16] [--key A] [--seed 1]
```

- **SFX presets** (one-shots): hit 0.22 s, hurt 0.30, death 0.90, pickup 0.25, coin 0.35, powerup 0.60, jump 0.28, land 0.18, footstep 0.12, shoot 0.25, laser 0.30, cast 0.55, magic 1.0, explosion 1.4, whoosh 0.45, click 0.05, confirm 0.32, cancel 0.30, door 0.90, alarm 1.0. `--length` scales them.
- **Ambience presets** (always seamless loops): wind 8 s, rain 6 s, hum 4 s, fire 6 s. The tail is crossfaded into the head, so the file repeats without a click; play it with `loop: true` on the `Ambience` bus.
- **`--loop`** renders any SFX preset the same seamless way (a 4 s `whoosh --loop --length 4` makes a 1.8 s air loop).
- **Music moods**: dark, tense, heroic, upbeat, calm, mystic. A loop is exactly `bars × 4 × 60 / bpm` seconds; the reverb and delay tail wraps back to the start, so it loops without a click. `--bars` must be a whole number. Keys: C C# D D# E F F# G G# A A# B (flats Db Eb Gb Ab Bb also work).
- **Variation.** Change `--seed` for a different take and `--pitch` (0.8–1.2) for size; two sounds in one game are never the same clip.
- **Errors, not guesses.** An unknown preset, mood, key, or flag, a flag that does not apply to the command, or a non-number value stops with exit 2 and the list of valid values.
- **The printed path.** Each run prints `WAV <path>  <seconds> s  <KB> KB  ->  @project/assets/audio/<name>.wav`, computed from the game project that contains the file (the folder with the `.genesys-project`), whatever the shell's working directory. Use that exact printed path in code and in the Assets row. A `WARN` line means the file is outside the project's `assets/` and the game cannot load it.
- **Compression note.** Each run also prints `NOTE ships as MP3 …` or `NOTE ships as this raw WAV …` from the project's `assetCompiler` setting, and warns when a raw music bed is over the 1.5 MB music budget.

Measured music loops (default bpm, mono WAV):

| Mood | bpm | 16 bars | 8 bars |
|---|---|---|---|
| upbeat | 128 | 30.0 s, 2.6 MB | 15.0 s, 1.3 MB |
| tense | 120 | 32.0 s, 2.8 MB | 16.0 s, 1.4 MB |
| heroic | 110 | 34.9 s, 3.0 MB | 17.5 s, 1.5 MB |
| mystic | 84 | 45.7 s, 3.9 MB | 22.9 s, 2.0 MB |
| calm | 80 | 48.0 s, 4.1 MB | 24.0 s, 2.1 MB |
| dark | 70 | 54.9 s, 4.7 MB | 27.4 s, 2.4 MB |

With audio compression on (MP3 at the default 128 kbps, about 16 KB per second) every 16-bar bed fits the 1.5 MB music budget (0.5–0.9 MB). With it off, only 8-bar beds at 110 bpm or faster fit. When you add synthesised music, turn audio compression on (`genesys-asset-compiler`) or keep the bed short. `--bpm` raises the tempo and shortens the loop.

You cannot hear the result. Tell the user which clips are synthesised so they can judge them, and name them in the Assets table as synthesised.

## Scenario (only when the art routes name it)

When the project's art-routes line in the custom `AGENTS.md` names Scenario, a music bed, stinger, or SFX the project lacks can be generated through `genesys-generated-assets`: one credit allowance per batch, asked once and early, never a price check per asset. The generated file lands under `assets/audio/` and is wired here. A generated file sitting in `assets/` and never played is not done. With Scenario off, the synth covers every slot.

## Choosing per slot

| Slot | First choice | Fallback |
|---|---|---|
| Music bed | A project loop, seamless | `synth.mjs music <mood>` (mood from the art direction); never left open |
| Main action | Project clip, under 0.5 s attack | `synth.mjs sfx shoot` / `laser` / `jump` / `whoosh`, or `laser.mp3` (energy) / `game-gun-short.mp3` (ballistic) |
| UI confirm and hover | Short click, under 0.2 s | `synth.mjs sfx confirm` (0.5) and `click` (hover, 0.2) |
| Hit | Short thud or crack | `synth.mjs sfx hit`, or `game-gun-short.mp3` at lower volume |
| Hurt (player hit) | Short, distinct from the enemy hit | `synth.mjs sfx hurt` |
| Death / fail | Explosion or sting | `synth.mjs sfx death`, `explosion.mp3`, or `tuba.mp3` for a comic tone |
| Pickup | Bright chime | `synth.mjs sfx pickup` / `coin`, or `pickup.mp3` |
| Footsteps | Project set | `synth.mjs sfx footstep` × 3 seeds, played with ±5 % pitch |
| Ambience | Matching loop | `synth.mjs sfx wind` / `rain` / `fire` / `hum`, or `birds.mp3` outdoors |

An engine fallback is a placeholder when it does not fit the game's tone. Name it as one in the game's status notes until a fitting clip replaces it.

## Traps

The common traps are in [SKILL.md → Traps](../SKILL.md#traps).

- An ambience loop clicks every few seconds → the clip is not a seamless loop. Render it with `synth.mjs` (ambience presets or `--loop`), or crossfade the file's tail into its head.
- The build is several MB of WAV → audio compression is off. Turn it on (`genesys-asset-compiler`) or shorten the music bed.
- `synth.mjs` printed a `WARN … outside assets/` line → the file is not loadable; write it under the game's `assets/audio/` and use the printed path.
