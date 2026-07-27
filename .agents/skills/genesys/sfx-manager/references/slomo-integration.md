# Slomo Integration

## How playback rate is resolved

Each time `play()` is called, `_rateForKey` reads `world.slomo` (a number the slomo manager writes to the world object, default 1.0). If slomo is below 0.9, the rate is clamped to `max(0.05, slomo)`. The minimum of 0.05 prevents audio sources from effectively pausing.

Keys in `NORMAL_RATE_KEYS` bypass this and always play at 1.0. Use this for:
- Voice lines (pitch-shifting speech sounds wrong)
- UI confirmation sounds
- Music (handled separately by the music-player skill)

## Resetting rates when slomo exits

When your slomo manager restores time to 1.0, call `syncPlaybackRates(1.0)`. This iterates every pooled source and resets its rate. Without this call, sounds that were loaded during slomo keep their slowed rate until the next play.

```ts
// In your slomo exit callback:
getGameSfx(world).syncPlaybackRates(1.0);
```

## Rate clamping

The 0.05 minimum exists because `AudioBufferSourceNode.playbackRate` values near zero cause some browsers to produce audible artefacts or silence. At 0.05× (5% speed) the sound is an extremely low rumble — effectively inaudible but stable.

## Combining with the slomo-manager skill

The slomo-manager skill provides `SlomoManager` with `onSlomoStart` and `onSlomoEnd` callbacks. Wire `syncPlaybackRates` into the end callback:

```ts
slomoManager.onSlomoEnd = () => {
  getGameSfx(world).syncPlaybackRates(1.0);
};
```
