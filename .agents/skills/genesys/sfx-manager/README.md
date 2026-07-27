# sfx-manager — Rationale

## Why a pool instead of creating a new source per play

Creating a new `SoundComponent` on every play call allocates a new AudioNode chain in the Web Audio API. For high-frequency SFX (melee hits, projectile impacts) this produces measurable GC pressure and can cause frame stutter. A fixed pool created once at startup eliminates per-play allocation. The round-robin cursor ensures even wear across slots without priority logic.

## Why a cached accessor

`world.getActors().find(a => a instanceof SfxManagerActor)` is O(n) across all actors. In a horde game where 20 hits land in a single frame, calling this 20 times is wasteful. The `getGameSfx(world)` wrapper caches the result and only invalidates when the world reference changes (i.e. on scene transition).

## Why not positional audio

Three.js positional audio uses the Web Audio API's `PannerNode` for head-related transfer function (HRTF) spatialization. For an isometric game with a fixed camera this adds complexity and overhead without perceptible benefit — the listener and source are always roughly coplanar. Linear distance-scaled volume (`playAtDistance`) achieves the same "sounds closer = louder" effect at negligible cost.

## Why the hit-sound cooldown pattern

In a single physics frame, 10–20 enemies can enter the melee hit radius simultaneously. Without a throttle, `play('hit')` fires 10–20 times within ~1 ms — the pool saturates, all slots start playing at once, and the result is a distorted burst rather than a single impact sound. A `performance.now()` gate of ~80ms ensures the player hears one clean hit sound per combo beat regardless of simultaneous hit count.

## Why exempt keys for slomo

Pitching down a character voice line during slomo breaks the illusion — the dialogue becomes incomprehensible at 0.12× speed. Separating "game-world sounds" (weapons, impacts) from "meta sounds" (UI, voice) keeps the slomo effect believable while ensuring critical communication stays clear.
