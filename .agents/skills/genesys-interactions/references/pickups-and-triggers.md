# Pickups and triggers

Source: `.engine/src/nodes/gameplay/PickupNode.ts` (`PickupNode`, `HealthPickupNode`, `PickupSpawnerNode`) and `TriggerZoneNode.ts`.

## `PickupNode`

Overlap-based collection on a trigger primitive.

| Option | Default | Notes |
|---|---|---|
| `sound.pickupSoundUrl` | none | Played with `world.globalAudioManager.playGlobalSound` (non-spatial). |
| `sound.volume` | `0.5` | |
| `sound.maxDistance` | `10` | Stored; the global sound is not spatial. |

Lifecycle:
1. `beginPlay` schedules `findTriggerComponent()` for the next tick and again on each `ModelMeshNode.onMeshLoaded` under the root.
2. It picks the first `PrimitiveNode` under the root whose physics options have `generateCollisionEvents` and whose physics state `isTrigger` is true. A collider is a trigger (sensor) when its collision profile is query-only, such as `DefaultCollisionProfile.Trigger`.
3. On `onOverlapWith`, it takes the other node's root and, if `canPickup(root)`, fires `onPickup(pickupRoot, collector)` and then `onPickupInternal(collector)`.
4. Default `onPickupInternal` plays the sound and destroys the pickup root.

Overridable: `canPickup(actor)` (default: `actor instanceof Pawn`), `onPickupInternal(collector)`. Delegate: `onPickup`.

Trigger mesh pattern (side-scroller demo): a `ModelMeshNode` with `physicsOptions: { enabled: true, motionType: Static, generateCollisionEvents: true, collisionMeshType: ENGINE.CollisionMeshType.ConvexHull, collisionProfile: ENGINE.DefaultCollisionProfile.Trigger }`, plus the pickup node as a sibling under one root.

Bob and spin: the demo moves the root in `tickPrePhysics` with `Math.sin(gameTime × speed) × amplitude` and adds `rotationSpeed × dt` to `rotation.y`. A looping `TweenMovementNode` restarts from the start pose each loop, so a sine in code reads smoother for bobbing.

Collect feel: 50–100 ms scale pop, sparkle VFX at the pickup position, a short bright sound, and a HUD counter tick (`genesys-game-feel`, `genesys-vfx`, `genesys-audio`). Optional magnet: within 2 m, move the pickup toward the player over 0.15–0.25 s before collecting (pack-wide default; `genesys-game-feel`).

## `HealthPickupNode`

Extends `PickupNode`. `healAmount` default `25`. Engine assets: model `@engine/assets/models/PickupActors/SM_Pickup_Health.glb` (the side-scroller demo's `const.ts` points at a `PickupNodes/` folder that does not ship; use `PickupActors/`), and prefab `@engine/assets/prefabs/actors/demo_health_pickup.prefab.json` (a `PrimitiveNode` root holding that model at scale 2 on the Trigger profile and a `HealthPickupNode` with `healAmount` 50; no pickup sound). `canPickup` also requires a `CharacterStatsNode` on the collector. `onPickupInternal` calls `heal(healAmount)`, then the base behavior. It still collects at full health (heals 0); override `canPickup` to refuse when `getCurrentHealth() >= getMaxHealth()` if the design wants that.

## `PickupSpawnerNode`

Options: `spawnPrefabPath` (default `@engine/assets/prefabs/actors/demo_health_pickup.prefab.json`), `spawnInterval` (s, default `5.0`, `-1` = once), `spawnOffset` (default `(0, 2, 0)`), `sound.spawnSoundUrl`, `sound.volume` (`0.5`), `sound.maxDistance` (`15`). Methods: `manualSpawn()`, `getCurrentPickup()`.

`spawnPickup` spawns `spawnPrefabPath` at `spawnOffset` and adds it to the world. After a collection, a `spawnInterval` of 0 or more schedules the next spawn. `-1` spawns once. `manualSpawn()` spawns when no pickup is active. The spawned prefab still needs its own trigger `PickupNode`; the spawner does not collect by itself.

To place a prefab that is not on a spawner:

Source: .engine/src/utils/Spawn.ts, .engine/demos/examples/fps-advanced/pickups.ts
```ts
const pickup = await ENGINE.spawnAsync<ENGINE.SceneNode>(
  '@project/assets/prefabs/coin.prefab.json', { position });
world.add(pickup);
```

Respawning pickups (fps-advanced weapon pickup): instead of destroying, hide the root (`visible = false`), disable physics (`root.overridePhysicsOptions({ enabled: false })`), and re-enable both after `world.timerSystem.setTimeout(cb, respawnSeconds)`. Override `onPickupInternal` without calling `super` to skip the destroy.

Weapon pickups: create the weapon with `WeaponClass.create()` and attach it to the collector (`genesys-combat`).

## `TriggerZoneNode`

Extends `CollisionShapeNode` (an invisible `MeshNode`). Detects roots entering and leaving a volume.

| Option | Default | Notes |
|---|---|---|
| `physicsOptions` | `Static`, `Trigger` profile, collision events | Only applied when you pass no `physicsOptions`. A different profile adds a configuration warning. |
| `geometry` | `BoxGeometry(1, 1, 1)` | Size comes from `scale`. |
| `scale` | `(2, 2, 2)` | |
| `enableDebugVisualization` | `false` | |
| `filter` | `TriggerFilter.All` | `All`, `PlayerOnly` (`isPlayerControlled()`), `PawnsOnly` (`instanceof Pawn`), `Custom` |
| `enableStayEvents` | `false` | Raises `onActorStay` every tick for each actor inside; can be toggled during play. The zone only ticks while it is on. |

Delegates: `onActorEntered(actor, zone)`, `onActorExited(actor, zone)`, `onActorStay(actor, zone)`. Queries: `getActorsInZone()`, `isActorInZone(actor)`, `getActorCount()`. They use `SceneNode` roots despite the "Actor" names.

Engine limits:
- `TriggerFilter.Custom` takes its function from the `customFilter` creation option or `setCustomFilter(fn)`. The function is not saved, so a zone loaded from a scene rejects everything until game code calls `setCustomFilter` (for example where it finds the zone to bind `onActorEntered`). An actor that entered always gets `onActorExited`, even if the filter rejects it by then.

Source: .engine/src/nodes/gameplay/TriggerZoneNode.ts
```ts
const lava = ENGINE.TriggerZoneNode.create({
  position: new THREE.Vector3(0, 0.5, -10), scale: new THREE.Vector3(6, 1, 6),
  filter: ENGINE.TriggerFilter.PlayerOnly,
  enableStayEvents: true,
});
lava.onActorStay.add((actor) => { /* damage on a 0.5 s cooldown (genesys-combat) */ void actor; });
world.add(lava);
```
- It logs every enter and exit to the console.

## Common trigger recipes

| Recipe | Setup |
|---|---|
| Checkpoint | `PlayerOnly`; on enter, store the zone position as the respawn point, play a chime, flash a "Checkpoint" toast. Fire once. |
| Level exit / goal | `PlayerOnly`; on enter, tell the GameMode to open the result or load the next level (`genesys-game-boot`). |
| Hazard (lava, spikes) | `PlayerOnly`; on enter, `takeDamage` and knock back; repeat damage needs stay events (above) or a timer while inside. I-frames on the receiver (`genesys-combat`). |
| Kill plane | A wide flat zone below the level, `All`; respawn the player, destroy anything else. |
| Ambush / cutscene | `PlayerOnly`, one-shot; spawn the wave or start the camera move, then disable. |
| Tower-defense goal | `PawnsOnly`; each creep that enters costs base HP and is removed. |
| Music or ambience zone | `PlayerOnly`; crossfade on enter and exit (`genesys-audio`). |

## Traps

- NPCs and props fire the zone → default `TriggerFilter.All` → use `PlayerOnly` or `PawnsOnly`.
- `TriggerFilter.Custom` never fires on a zone placed in the scene → the filter function is not saved with the scene → call `zone.setCustomFilter(fn)` from game code before play reaches the zone.
- `onActorStay` never fires → `enableStayEvents` is off (default false) → pass `enableStayEvents: true`, or set it during play.
