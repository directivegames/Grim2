# music-player

A looping background music actor with slomo-aware pitch shifting, mute/unmute, and user-settings volume control. The playback rate lerps smoothly when slomo begins or ends so the pitch change is perceptible but not jarring. Multiple music actors (gameplay, menu, cutscene) can coexist — a single `applyMusicVolume` call updates all of them at once.

---

## How it works

`MusicPlayerActor` wraps a single looping `SoundComponent`. It reads `world.slomo` each tick and lerps the audio source's playback rate toward a target. The lerp uses wall-clock (unscaled) delta time so the transition feels the same speed regardless of how extreme the slomo is.

---

## 1. Create and start

```ts
import { MusicPlayerActor } from './assets/MusicPlayerActor.js';

// Spawn once, store reference
const music = MusicPlayerActor.create({
  audioPath: '@project/assets/sounds/MyTrack.mp3',
  baseVolume: 0.5,
  bus: 'Music',
});
world.addActor(music);
music.start();
```

Or use the static helper (spawns if not already present):

```ts
const music = MusicPlayerActor.ensurePlaying(world, '@project/assets/sounds/MyTrack.mp3');
```

---

## 2. Stop / mute / unmute

```ts
music.stop();    // stops playback; start() resumes it
music.mute();    // silences without stopping (good for pause menus)
music.unmute();  // restores previous volume
```

---

## 3. Volume from settings

```ts
music.setMusicVolume(gameSettings.musicVolume); // call on settings change and startup
```

To update all music actors in the world at once (useful for a volume slider):

```ts
import { applyMusicVolumeToAll } from './assets/MusicPlayerActor.js';
applyMusicVolumeToAll(world, 0.7);
```

This iterates all `MusicPlayerActor` instances in the world and calls `setMusicVolume` on each.

---

## 4. Slomo pitch shift

By default the actor shifts pitch to `0.42×` when `world.slomo` drops to `0.15` or below. This is gentler than the game's slomo (which may go to `0.12×`) so the track stays audible and recognisable.

Tune the constants at the top of `MusicPlayerActor.ts`:

```ts
const SLOMO_MUSIC_RATE    = 0.42;  // target rate during slomo
const SLOMO_THRESHOLD     = 0.15;  // world.slomo value that triggers the shift
const RATE_LERP_SPEED     = 14;    // higher = faster transition
```

To disable slomo pitch entirely (e.g. for an ambient track that should not shift), set `SLOMO_MUSIC_RATE = 1.0`.

---

## 5. Multiple music actors

Each game context (gameplay, menu, cutscene, boss fight) can have its own `MusicPlayerActor`. They are independent actors — start/stop them as the game transitions between states.

Keep at most one playing at a time to avoid overlap. Stop the outgoing track before starting the incoming one:

```ts
menuMusic.stop();
gameplayMusic.start();
```

`applyMusicVolumeToAll` updates every `MusicPlayerActor` in the world, so the volume slider works without knowing which tracks are active.

---

## Constraints

- The Web Audio context starts suspended in most browsers until a user gesture. `start()` waits for the `SoundComponent` to load and then resumes the context — but if no user gesture has happened yet, the `resume()` call may be silently blocked. Trigger `start()` from a button click or other user interaction.
- Do not call `start()` before `beginPlay` fires. The `SoundComponent` is created in `doBeginPlay`.
- `mute()` sets volume to 0 but does not pause the audio clock. Unmuting resumes from the current track position.
- The actor uses wall-clock delta time for rate lerping via `getUnscaledDeltaTime`. Import this from the `slomo-manager` skill if you are using that skill, or implement your own unscaled dt.
