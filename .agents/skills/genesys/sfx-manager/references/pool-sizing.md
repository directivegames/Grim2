# Pool Sizing Reference

## What poolSize controls

`poolSize` sets how many `SoundComponent` instances are created for a given key. The round-robin cursor cycles through them, so `poolSize = 2` allows two overlapping instances of the same sound before the oldest slot is reused.

## Guidelines

poolSize 1 — one-shot UI sounds, voice clips, anything that must not overlap itself (menu confirm, reward jingle). The track restarts on the next play.

poolSize 2 — most SFX. Melee hits, blade swings, impacts. Two instances allow tight combos to overlap without cutting each other off.

poolSize 3–4 — death sounds, explosions, anything that may fire several times within a fraction of a second across multiple simultaneous actors (e.g. horde deaths on a large AoE kill).

## Why not a single pool size for everything

More instances = more AudioNode objects in the browser's audio graph. For 30 distinct sounds at poolSize 4 that is 120 AudioNode chains, which can stress lower-end devices. Keep poolSize at 1 for anything that is never concurrent.

## Pre-warming

On desktop the manager builds all pools eagerly in `beginPlay`. On mobile (lazy mode) the first play of a key has a small latency while the pool is built. Pre-warm any sounds that must be instant on mobile by calling `_buildPool(key)` explicitly during a loading screen:

```ts
// During loading screen, before gameplay starts
const sfx = SfxManagerActor.ensureExists(world);
// Access private method if needed by extending the class,
// or make a public warmUp(keys) method
```
