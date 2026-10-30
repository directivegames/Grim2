# World and SceneNode system

## World

The World is the runtime scene manager that owns the simulation. It coordinates the SceneNode tree, owns global systems, and runs each tick.

Source: .engine/src/game/World.ts

Responsibilities:
- Owns the Three.js scene (World extends `GenesysScene`; use `getRenderScene()` for background and environment).
- Manages node lifecycle (add, tick, destroy).
- Coordinates input, timers, tweens, UI, particles, and networking. Physics and navigation live on the game loop.
- Provides node queries: `getRootNodes(Type)`, `getNodes(Type)`, `getNode(Type)`, `getNodeByPath(path)`, `getPlayerControllerAt(i)`, `getPlayerControllerCount()`, `getFirstPlayerPawn()`.
- Handles level state serialization.
- `runInNextTick(fn)` schedules a callback at the start of the next tick.
- `getGameTime()` returns accumulated play time.

Key systems:
| Member | What |
|---|---|
| `world.inputManager` | Input routing ([input-handling](input-handling.md)) |
| `world.timerSystem` | Global timer events |
| `world.tweenManager` | Interpolations (`genesys-interactions`) |
| `world.uiManager` | UI elements and layouts (`genesys-ui`) |
| `world.globalParticleManager` | `spawnVFX` one-shots (`genesys-vfx`) |
| `world.gameContainer` | The game's HTML container; mount any raw HTML here |
| `world.gameLoop?.physicsEngine` | Physics backend (`genesys-physics`); nodes reach it with `node.getPhysicsEngine()` |
| `world.gameLoop?.navigationServer` | Navigation backend (`genesys-navigation`) |

`world.getRootNodes()` includes transient system roots. Filter with `!node.isTransient()` for authored, outliner-style views. For every node recursively, use `world.getNodes(Type)`.

## SceneNode tree

Placeable objects are SceneNodes or subclasses. A placeable is its own transform root. There is no Actor shell and no nested `rootComponent`.

- Semantic roots set `isRoot`. Custom root classes set `this.isRoot = true` in the constructor.
- Children attach with `children` options or `add(...)`.
- Supports serialization and prefabs.
- Networked roots use `isRoot && replicated` (see `genesys-multiplayer`).

Lifecycle:
1. `MyNode.create(options)` — factory creation.
2. `world.add(node)` — entry; `beginPlay()` runs.
3. `tickPrePhysics(deltaTime)` — update before physics.
4. `tickPostPhysics(deltaTime)` — update after physics.
5. `node.destroy()` — exit; `endPlay()` runs.

| Use case | Prefer |
|---|---|
| Behaviour / lifecycle / tags | `SceneNode` |
| Placeable + physics | `PrimitiveNode` |
| Mesh or model as the placeable | `MeshNode` / `ModelMeshNode` with `isRoot: true` |

Source: .engine/src/nodes/SceneNode.ts, .engine/src/nodes/PrimitiveNode.ts

## Node types

- **SceneNode** — transform, lifecycle hooks, tags, ownership (`getRoot()`), child discovery (`getNode` / `getNodes`).
- **PrimitiveNode** — extends SceneNode with physics options (`motionType`, density, `collisionProfile`, `contributeToParentCollider`) and collision/overlap delegates. Profiles, channels and responses: `genesys-physics` → `references/collision-profiles.md`. The default `Character` profile ignores the `Pawn` channel (`.engine/src/systems/collision/CollisionConfig.ts`), so classic character pawns never block each other: enemies pass through each other and through the player body.
- **Specialized nodes** under `.engine/src/nodes/`: `MeshNode` / `ModelMeshNode` (rendering), lights (`nodes/lights/`), `ViewTargetCameraNode`, movement nodes (`nodes/movement/`), gameplay nodes (`nodes/gameplay/`), `SoundNode` (`nodes/audio/`), `CharacterStatsNode`, `FollowNode`. The "Engine already has it" table in `SKILL.md` maps them to owners.

## Tick order

Source: .engine/src/game/World.ts (`tick`)

Each tick is skipped unless play state is Playing, the world is not paused, and `deltaTime > 0`. `deltaTime` is scaled by the `slomo` console multiplier.

1. Next-tick functions (`runInNextTick`).
2. Timer system.
3. Tween manager.
4. Pre-physics tick (nodes).
5. Physics step (`gameLoop.physicsEngine.tick`).
6. Post-physics tick (nodes).
7. Network tick (replication).
8. Audio listener syncs to the active camera.

## Active camera

`world.getActiveCamera()` resolves the view in this order:
1. The top of the view-target stack (`pushViewTargetCamera(camera)` / `removeViewTargetCamera(camera)`).
2. The possessed pawn's camera, found by `SceneNode.getCamera()` (depth-first in the pawn's subtree) on the first player controller's pawn.
3. Null — the engine shows a camera warning and uses a fallback.

Camera layouts, spring arms, and handoffs are owned by `genesys-camera`.

## Removed

`ENGINE.Actor` is removed, with the compat World APIs (`addActor`, `addActors`, `removeActor`, `getActors*`). Use `SceneNode` / `PrimitiveNode` subclasses with `isRoot`, `world.add`, and `getNodes*`. Migration: `engine-upgrades` (`18-19`).
