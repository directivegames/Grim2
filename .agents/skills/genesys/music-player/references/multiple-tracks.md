# Multiple Track Actors

## Pattern

Each game context (gameplay, menu, map screen, boss fight, cutscene) owns its own `MusicPlayerActor`. They are normal actors — create them when the context starts and destroy or stop them when it ends.

```ts
// Game startup — create actors for each context upfront
const gameplayMusic  = MusicPlayerActor.create({ audioPath: '@project/assets/sounds/Game.mp3' });
const menuMusic      = MusicPlayerActor.create({ audioPath: '@project/assets/sounds/Menu.mp3' });
const bossMusic      = MusicPlayerActor.create({ audioPath: '@project/assets/sounds/Boss.mp3' });
world.addActor(gameplayMusic);
world.addActor(menuMusic);
world.addActor(bossMusic);
```

Only one plays at a time:

```ts
function enterGameplay(): void {
  menuMusic.stop();
  bossMusic.stop();
  gameplayMusic.start();
}

function enterBossFight(): void {
  gameplayMusic.stop();
  bossMusic.start();
}
```

## Volume slider covers all tracks

Because `applyMusicVolumeToAll` iterates every `MusicPlayerActor` in the world, a single settings call reaches all contexts:

```ts
// From settings screen:
applyMusicVolumeToAll(world, newMusicVolume);
```

## Crossfade (optional)

For smooth transitions, fade the outgoing track down before starting the incoming one. A simple approach using the tick loop:

```ts
class MusicCrossfader {
  private _outgoing: MusicPlayerActor | null = null;
  private _fadeTimer = 0;
  private static readonly FADE_DURATION = 1.5; // seconds

  transition(from: MusicPlayerActor, to: MusicPlayerActor, world: ENGINE.World): void {
    this._outgoing = from;
    this._fadeTimer = 0;
    to.start();
  }

  tick(dt: number): void {
    if (!this._outgoing) return;
    this._fadeTimer += dt;
    const t = Math.min(1, this._fadeTimer / MusicCrossfader.FADE_DURATION);
    this._outgoing.setMusicVolume(1 - t);
    if (t >= 1) {
      this._outgoing.stop();
      this._outgoing = null;
    }
  }
}
```

Note: `setMusicVolume` scales relative to `BASE_MUSIC_VOLUME × userVolumeScale`. The crossfader should restore the volume on the incoming track by calling `setMusicVolume(userVolumeScale)` once fully faded in.
