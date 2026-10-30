# Spawning and waves

The short version is in [SKILL.md → Spawning](../SKILL.md#spawning).

## Spawn APIs

| Way | Call | Use for |
|---|---|---|
| By class | `const e = Enemy.create({ position }); world.add(e);` | Enemies built in code (fps-advanced `spawnEnemies`). |
| By prefab | `const e = await ENGINE.spawnAsync<ENGINE.SceneNode>('@project/assets/prefabs/x.prefab.json', { position, rotation, scale }); world.add(e);` | Enemies authored in the editor as Prefabs (`genesys-prefabs`). `spawnAsync` also accepts a class or a registered class name. It returns the node; you add it to the world. |
| Placed in the scene | MCP `action_node(add, className="GAME.Enemy")` (`genesys-mcp-orchestrator`) | Hand-placed enemies in a designed level. They begin play with the level. |
| Online | `MultiplayerSpawner` (`.engine/src/nodes/multiplayer/MultiplayerSpawner.ts`) | Server-spawned enemies that clients must see, including late joiners (`genesys-multiplayer`). |

`PickupSpawnerNode` is for pickups. Do not use it for enemies.

Source: .engine/src/utils/Spawn.ts
```ts
const enemy = await ENGINE.spawnAsync<ENGINE.SceneNode>(
  '@project/assets/prefabs/enemy.prefab.json',
  { position: new THREE.Vector3(4, 0, -10) },
);
world.add(enemy);
```

By class and by prefab side by side, with the kill count hooked for waves and score:

Source: .engine/src/utils/Spawn.ts (`spawnAsync`), .engine/demos/examples/fps-advanced/game-mode.ts
```ts
// By class (code-built enemy):
const e = Grunt.create({ position: spawnPoint.clone() });
world.add(e);
// By prefab (editor-authored enemy):
const p = await ENGINE.spawnAsync<ENGINE.SceneNode>(
  '@project/assets/prefabs/grunt.prefab.json', { position: spawnPoint.clone() });
world.add(p);
// Count kills for waves and score:
e.getNode(ENGINE.CharacterStatsNode)?.onDeath.add(() => this.onEnemyKilled());
```

## Spawn points

- Designed levels: place empty marker nodes (named `EnemySpawn_*`) in the scene through MCP, as part of the level (`genesys-level-authoring`). At wave start, collect their world positions. A spawn table in code that duplicates scene positions goes stale when the level changes.
- Arenas: a ring 8–15 units from the player, filtered to points outside the camera frustum, and on the navmesh for walkers (`getClosestPointOnNavigationMesh` or `getRandomReachablePoint`, `genesys-navigation`).
- Never spawn on top of the player. Keep at least 4 units of distance and reject points inside colliders.
- In-view spawns get a 0.4–0.8 s telegraph (flash, portal, dust, sound) before the enemy can act or be hit.

## Wave state

Waves live in the GameMode, inside the play state of the screen state machine (`genesys-game-boot`). Keep it small:

1. **WaveIntro**: 1.5 s banner "Wave N".
2. **Spawning**: the queue drains at an interval.
3. **Fighting**: while alive > 0.
4. **Breather**: 2–3 s, then the next WaveIntro.
5. After the last wave → Victory result. Player death at any point → Defeat result.

- Track `alive` from your own list of spawned roots. Decrement on `onDeath`, and also on removal for enemies that leave bounds or fall out of the world. A counter fed only by `onDeath` never reaches 0 when something despawns another way.
- Spawn from a queue at an interval (0.3–1.0 s) up to the alive cap, so a 40-enemy wave does not appear in one frame.
- Retry clears every spawned enemy, resets the wave index, and restarts from wave 1 in the same launch.
- Show the wave number and enemies left in the HUD (`genesys-ui`).

## Difficulty ramp (defaults)

| Knob | Wave 1 | Per wave | Cap |
|---|---|---|---|
| Enemy count | 6 | +25% | alive cap below |
| Enemy HP | base | +10% | 2.5× |
| Move speed | base | +5% | 1.5× |
| Attack cooldown | base | −5% | 0.6× |
| Spawn interval | 1.0 s | −0.1 s | 0.3 s |
| New enemy type | — | one new type every 2 waves | — |
| Alive at once | 6 | +2 | 12–20 walkers, 40–80 pattern movers |

A first slice ships 5 waves. Endless modes keep the curve and add a score multiplier. Survival-timer modes ramp on elapsed time instead of waves (every 30 s ≈ one wave step).

Fairness rules (`genesys-game-feel` owns the tuning):
- At most 2–3 enemies attack the player in the same second; others reposition.
- The first wave is a tutorial: one enemy type, slow, telegraphed.
- A difficulty spike follows a breather, never another spike.

## Performance

- Walkers cost path queries and physics. Stagger `BehaviorTreeNode.tickInterval` (default 0.1 s) with small per-enemy offsets, and keep the alive cap.
- Pattern movers are cheap until they shoot a lot. Put their bullets in the instanced field (`genesys-combat`).
- Measure at the cap with `genesys-profiler`, not at wave 1.

## Traps

- Wave never ends → a kill counter missed enemies destroyed another way (fell out of the world, despawned) → count on `onDeath` **and** on removal, or count live enemies from your own list.
- Frame drops at wave 6+ → no alive cap → cap alive count and queue the rest.
