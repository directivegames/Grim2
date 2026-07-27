# actor-pool

Designed from Grim2's `ZombieHordeManager` pooling pattern (`src/actors/ZombieHordeManager.ts`).

## Why pool actors at all

Creating an `Actor` in Genesys involves world registration, physics body setup, GLTF load, animation state initialisation, and NPC graph boot. For enemy types, all of this takes 10–50ms depending on the model. At 60 kills per minute in a horde game, allocating a new actor per death causes GC spikes every few seconds that are perceptible as framerate hitches.

The pool front-loads all of this cost at spawn time (first wave, scene load) and reuses the same objects for the rest of the session. After the initial fill, zero allocations happen on the hot path.

## Why an idle pool separate from the respawn queue

The queue tracks actors cooling down after death (respawnDelaySec). The idle pool tracks actors that are parked and immediately available — actors returned from a `reset()` call between missions, or actors returned by `returnToIdle()` when no valid position existed.

This separation means `reset()` between missions does not lose the actors — they move to the idle pool. The next `spawn()` call immediately reuses them without GLTF load or world registration. `destroy()` clears the idle pool entirely for full session end.

## Why tickAndCollectReady returns actors rather than auto-respawning

Grim's `ZombieHordeManager` auto-respawns queued enemies when capacity is available because it controls the position source internally. A generic pool doesn't know where to spawn — that's the developer's responsibility (nav markers, waypoints, random ring, etc.). Returning the ready actors and letting the developer choose the position keeps the pool decoupled from spawn position logic.

## Why softReset is called inside the GLTF reveal callback

Unhiding an actor before its mesh is renderable shows an invisible physics body. `softReset` must not be called until the mesh is confirmed. The pool calls it inside `onReady` of `revealActorWhenVisualReady`, which guarantees the mesh is present. The position is captured in a closure so it is available when the async callback fires.

## Difference from Grim's ZombieHordeManager

Grim's manager:
- Is tightly coupled to `NewZombieActor` and the `HordeEnemyType` elite registry
- Controls wave timing, kill thresholds, and difficulty scaling itself
- Has platform-specific caps baked in

`ActorPool` is only the pool. Wave timing, kill thresholds, difficulty, position selection, and elite registries are the developer's responsibility. This makes `ActorPool` useful for enemies, projectiles, particles as actors, collectibles, or any other frequently spawned/destroyed actor type.
