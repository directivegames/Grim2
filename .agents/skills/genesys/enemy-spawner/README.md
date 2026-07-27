# enemy-spawner

Built from Grim2's `ZombieHordeManager` system.

## Why marker-based spawn positions

Early versions used a random ring around the player (min/max radius). This caused enemies to spawn inside geometry on maps with walls, buildings, or elevation changes — the nav snap would fail and spawns would silently drop. Designer-placed `EnemySpawnPointActor` markers give level designers control over where the horde appears and guarantee spawns land on navigable ground. The manager picks randomly among the 8 closest enabled markers rather than a single closest one, which spreads the horde around the player naturally.

## Why no new actor allocations after initial pool fill

Creating a new `Actor` requires world registration, GLTF load, physics body setup, and animation state initialisation. Doing this for every enemy death at 60 kills/minute causes GC spikes that are noticeable even on desktop. The respawn queue reuses the same actors — a dead zombie is hidden, parked off-screen, and revived at a new position. After the first wave fills the pool, zero allocations happen for the rest of the session.

## Why a separate idle pool across missions

`resetForMissionStart` parks actors in an idle pool rather than destroying them. The next mission pulls from that pool before allocating anything new. This means replaying the same mission or starting the next rank has instant enemy availability — no GLTF cold-start on the first spawn. `resetForMainMenu` destroys the pool because a session end is the right time to free that memory.

## Why the elite registry is a separate file

`ZombieHordeManager` is responsible for spawn timing, pooling, and lifecycle. `HordeEnemyRegistry` is responsible for which enemy types exist. Keeping them separate means adding a new enemy type is a one-file change that doesn't require understanding the manager internals. It also makes the manager testable in isolation.

## Why platform caps are hard-coded per device class

iOS WebKit kills tabs that exceed a memory/watchdog threshold silently. The caps are set conservatively based on testing real devices — they are not theoretical. Raising them above `IOS_MAX_ACTIVE_ZOMBIES = 14` risks tab crashes on low-memory iPhones. The caps are applied automatically; do not override them via `applyMissionRisk` on iOS.

## Why GLTF readiness is checked before reveal

Unhiding an actor before its mesh is attached causes a single frame where the physics body moves but nothing renders — a visible pop-in. `revealActorWhenVisualReady` polls up to 8 times at 16ms intervals. If the mesh is ready it fires `onReady` immediately. If the model hasn't loaded after the retries, `onFailed` re-queues the actor rather than silently losing a spawn slot.

## Planned features (not yet implemented)

These are designed but not in the codebase:

- Pressure modes: `constant`, `low`, `high`, `escalating` — control spawn intensity curve over time
- Time-based activation: `spawnDelayMinutes` — delay first wave until N minutes of gameplay
- Boss/elite triggers: fire a boss spawn when kills of a specific type reach a threshold

To implement any of these: add `@ENGINE.property()` fields to `ZombieHordeManager`, wire up the logic in `tickPrePhysics` and `spawnWave`.
