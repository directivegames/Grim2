# Elite enemy registry

## How it works

Every wave slot rolls a weighted random between a normal enemy and any eligible elite type. The roll uses `HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT = 10` as the base weight for normal enemies. Elite types are eligible if:

- `totalKills >= killsToUnlock`
- `missionRiskLevel >= minRiskLevel`
- active count of that type < `maxActive`

If no elite is eligible (or the roll falls below the normal weight), a normal pooled enemy spawns.

## HordeEnemyType interface

```ts
interface HordeEnemyType {
  readonly id: string;               // unique key for tracking active counts
  readonly killsToUnlock: number;    // total kills before this type enters the pool
  readonly spawnWeight: number;      // weight vs HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT (10)
  readonly maxActive: number;        // max alive simultaneously
  readonly minRiskLevel: RiskLevel;  // 1–5, minimum mission risk required
  readonly modelUrl?: ENGINE.ModelPath; // optional GLB to preload at horde start
  create(world: ENGINE.World, position: THREE.Vector3): ENGINE.Actor;
  hookDeath(actor: ENGINE.Actor, onDied: () => void): void;
  clearDeathHook(actor: ENGINE.Actor): void;
}
```

## Adding a new elite type

Add an entry to `createDefaultHordeEnemyTypes()` in `src/horde/HordeEnemyRegistry.ts`:

```ts
{
  id: 'my_elite',
  killsToUnlock: 50,
  spawnWeight: 2,      // rare — vs normal weight of 10
  maxActive: 1,
  minRiskLevel: 3,
  modelUrl: MY_ELITE_MODEL_URL,
  create(world, position) {
    const actor = MyEliteActor.create({ position: position.clone() });
    world.addActor(actor);
    return actor;
  },
  hookDeath(actor, onDied) {
    if (actor instanceof MyEliteActor) actor.onDied = onDied;
  },
  clearDeathHook(actor) {
    if (actor instanceof MyEliteActor) actor.onDied = null;
  },
},
```

## Elite idle pooling

Elite actors are pooled between missions just like normal enemies, but only for types that the manager explicitly supports in `_returnEliteToIdlePool`. Currently `BigUndeadActor` and `DemonboxActor` are pooled; other types are destroyed via `destroyActorWhenGltfIdle` on death. To enable idle pooling for your elite type, add it to the pool-return check in `_returnEliteToIdlePool`.

## Spawn weight tuning

With `HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT = 10` and two elite types at weights 2 and 3, the total weight is 15. Each slot has:

- 10/15 (~67%) chance of a normal enemy
- 2/15 (~13%) chance of elite type A
- 3/15 (~20%) chance of elite type B

`applyMissionRisk` adds `eliteSpawnWeightBonus` to each elite type's weight, shifting the ratio toward elites at higher difficulty.
