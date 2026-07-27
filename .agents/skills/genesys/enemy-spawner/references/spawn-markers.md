# Spawn markers

## How to set up

Place `EnemySpawnPointActor` actors in your scene. These are the only valid spawn positions for the horde manager. The manager will not fall back to a random ring position — if no markers are registered it logs a warning and skips the spawn.

Minimum recommended count: 4 markers spread around the playable area. 8–12 markers give the manager enough spread to avoid clustering during relocation.

## Placement rules

- Keep markers at least 4 units (XZ) from the player's typical patrol area. The manager enforces a minimum distance and falls back to the nearest marker if all are too close.
- Place markers on navigable ground — the marker's world position is used directly as the spawn position after a nav snap. A marker inside geometry or over a gap will produce failed spawns.
- Markers placed behind walls or in rooms the player cannot reach are valid and useful — the relocation system will teleport straggling enemies to them.

## How the manager picks markers

Two picking strategies are used depending on context:

`pickClosestEnemySpawnPoint` — used for normal spawns and respawns. Picks randomly among the 8 closest enabled markers (XZ distance) to the player. Prefers markers at least 4 units away; falls back to absolute closest if all are within 4 units.

`pickSpreadEnemySpawnPoint` — used for relocation only. Round-robin among the 8 closest, cycling the pick index on each call. This spreads multiple simultaneous relocations to different markers rather than sending all relocated enemies to the same spot.

## Disabling a marker at runtime

Set `marker.enabled = false` to remove it from consideration without removing it from the scene. Useful for blocking spawns in an area during a scripted sequence.

```ts
const markers = world.getActors().filter(a => a instanceof EnemySpawnPointActor);
for (const marker of markers) {
  marker.enabled = false; // block all spawns
}
```

## Registration

`EnemySpawnPointActor` registers itself in `doBeginPlay` and unregisters in `doEndPlay`. The registration is scene-global — the manager queries a module-level set. If you load multiple scenes simultaneously and want separate spawn domains, you will need to extend the registration system to be keyed by world.
