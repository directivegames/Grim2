---
name: genesys-engine
description: "Core engine API: SceneNode, World, pawns, controllers, avatars, input, spawn, serialization, asset paths, class registration, isRoot/getRoot, local vs world transforms, Delegate events and module contracts, and the \"engine already has it\" table. Use for engine API questions and code no subsystem skill owns (\"how do I spawn\", \"which class\", \"why can't it be hit\"). Not for deciding what to build or a new game (use `genesys-game-director`)."
metadata:
  tokens: 3258
---

# Genesys engine

This skill owns the core engine API and the rules every piece of game code follows. The most important rule: **search the engine before writing a system.** Genesys already ships movement, cameras, weapons, projectiles, health, VFX, sound, AI, tweens, interactions and navigation; hand-rolled copies are the most common defect.

The package is `@gnsx/genesys.js`, mirrored read-only at `.engine/src/`. That source is the authority. Read the shipped API digest first, then the source at the line ranges it gives ([Find an engine class](#find-an-engine-class)).

## Use another skill when

- New game, resumed session, what to build → `genesys-game-director`; `TECH.md`, contracts for a whole game → `genesys-tech-design`
- GameMode, `main()`, screens, `buildProject`, bundle proof, `src/const.ts`, persistence → `genesys-game-boot`
- A subsystem in the table below (movement, camera, combat, enemies, interactions, UI, VFX, audio) → its Owner column
- Touch → `genesys-touch-controls`; raycasts, joints, `CollisionConfig` → `genesys-physics`; lights → `genesys-lighting`; TSL materials → `webgpu-tsl-node-material-assets`
- Level → `genesys-level-authoring`; sky, terrain, water, foliage scatter, three.js addons as nodes → `genesys-world-building`; prefabs → `genesys-prefabs`; Poly Builder → `genesys-polybuilder`; asset sources → `genesys-assets`
- Replication, RPCs → `genesys-multiplayer`; live editor (MCP) → `genesys-mcp-orchestrator`; editor UI by hand → `genesys-editor-manual`
- Anonymous play, host sign-in, and features that need a registered player. Turn on Show Sign-in Bar for saved progress or multiplayer → `genesys-player-accounts`
- Compression → `genesys-asset-compiler`; asset packs → `asset-pack-authoring`; version migration → `engine-upgrades`; proof it works → `genesys-verification`

## Engine already has it

Check this table before writing a system; extend or configure what exists. Source paths: [find-engine-class](references/find-engine-class.md#engine-already-has-it-with-paths).

| Game need | Engine class | Owner |
|---|---|---|
| Walk, jump, fall | `CharacterMovementNode`, `GSSCharacterPawn` + `GSSNode` | `genesys-movement` |
| Fly, plane, spectator, NPC locomotion | `AerialMovementNode`, `AirplaneMovementNode`, `SpectatorMovementNode`, `NpcMovementNode`, `PathMovementNode` | `genesys-movement` |
| RTS camera pan and zoom (not a top-down hero) | `TopDownMovementNode` | `genesys-camera` |
| Car | `VehicleMovementNode` | `genesys-vehicles` |
| Third-person boom; cutscene camera | `SpringArmNode` (`CharacterPawn` builds it); `ViewTargetCameraNode`, `world.pushViewTargetCamera()` | `genesys-camera` |
| Gun, bullet | `ProjectileWeaponNode`, `ShotgunNode`, `InstantHitWeaponNode`; `Projectile` | `genesys-combat` |
| Health, damage, death | `CharacterStatsNode` (`takeDamage`, `heal`, `revive`, `getIsDead`) | `genesys-combat` |
| Fire / interact on the pawn | `GameplayPawn`, `DefaultCharacterPawn` | `genesys-combat` |
| Particles; sound | `VFXNode`, `world.globalParticleManager.spawnVFX()`; `SoundNode` | `genesys-vfx`; `genesys-audio` |
| Enemy brain; pathfinding | `BehaviorTreeNode`, `AIController`; `RecastNavigationServer`, `calculatePath` | `behavior-tree`, `genesys-creatures`; `genesys-navigation` |
| Moving platform, lift | `TweenMovementNode`, `world.tweenManager` | `genesys-interactions` |
| Pickup, door, switch, trigger | `PickupNode`, `HealthPickupNode`, `PickupSpawnerNode`, `DoorNode`, `SwitchNode`, `ProximityInteractableNode`, `InteractionNode`, `TriggerZoneNode` | `genesys-interactions` |
| Follow a target | `FollowNode` | `genesys-camera`, `genesys-creatures` |
| HUD widgets | `BaseUIComponent`: `StatBar`, `ProgressBar`, `NumberDisplay`, `Crosshair`, `Button`, `CenterMessage`, `AmmoCounter`, `Minimap` … | `genesys-ui` |
| Timers; events; pause one node | `world.timerSystem`; `Delegate`, `SinglecastDelegate`; `setTickEnabled`, `setTickInterval` | this skill ([contracts](references/contracts.md)); hitstop → `genesys-game-feel` |

## Find an engine class

When no row fits, or to check what a class can do. Run from the project root.

1. **Search the digest** (`node_modules/@gnsx/genesys.js/artifacts/classes/*.md`, one file per class: JSDoc, `@gotcha`s, signatures with source line ranges) with the need and its synonyms: `grep -il -E "follow|chase|pursu" node_modules/@gnsx/genesys.js/artifacts/classes/*.md`. One keyword rarely finds it.
2. **Read the class file** for each hit; check parent and siblings in `artifacts/class-hierarchy.xml`.
3. **Read the source only for the members you use**, at the given line ranges. A signature is not proof of behaviour: read the body of every method you call or override.
4. **Nothing in the digest?** Grep `.engine/src`, then the demos and `docs/`.

Commands, demo and doc locations, synonym list: [find-engine-class](references/find-engine-class.md). Prefer configuring or subclassing a hit. Write a custom class only when all of this comes up empty, and name in your report the engine class used, or the keywords searched and why none fit.

## Decide

| Question | Default |
|---|---|
| Player pawn | Solo humanoid that fires or interacts → `DefaultCharacterPawn` (fire and E-interact built in) + `DefaultPlayerController`. Online or GSS abilities → `GSSCharacterPawn` + `GSSPlayerController`. Top-down hero → a character pawn with a fixed camera. Walk-only → `CharacterPawn`. Flyers, vehicles → `MovementPawn` + a `movementNode`. Subclass `PlayerController` only for other keys. |
| Placeable base | `SceneNode` for behaviour; `PrimitiveNode` for physics; `MeshNode` / `ModelMeshNode` with `isRoot` when the mesh is the placeable. No `ActorNode`. |
| Where state lives | Per-instance scene values → MCP. Reusable logic, class defaults, runtime spawns → TypeScript. |
| File layout | One class per concern in its own module; no monolithic `game.ts`. Tunables in `src/const.ts`. Modules talk through a `Delegate` on the owner of the state ([contracts](references/contracts.md)). |

## Build

- **Imports.** `import * as ENGINE from '@gnsx/genesys.js'` and `import * as THREE from 'three'`; use the namespace (`ENGINE.PrimitiveNode`), explicit types, no `as any`.
- **Create, don't construct.** `MyNode.create(options)` runs the constructor then `initialize(options)`; `new MyNode()` skips `initialize`. By name: `ENGINE.spawn<Enemy>('GAME.Enemy', opts)` (the generic is required). Prefab: `await ENGINE.spawnAsync<T>('@project/assets/prefabs/….prefab.json', opts)`. None of these add to the world: call `world.add(node)`. Snippets: [scene-node](references/scene-node.md).
- **Register classes.** `@ENGINE.GameClass()` on every custom node or serializable class, never `@EngineClass`. Saved fields use `@ENGINE.property()` (lowercase); it needs the class decorator too.
- **Root classes.** A class that is always a placeable sets `this.isRoot = true` in the **constructor**; one-off built-ins use `.create({ isRoot: true })`. Every code-built gameplay root (enemy, pickup, crate, hazard) needs it: damage, pickups, triggers and projectiles find what they hit through `getRoot()`, the nearest `isRoot` ancestor. Example class: [scene-node → Placeable roots](references/scene-node.md#placeable-roots).
- **Lifecycle.** Override `beginPlay()` / `endPlay()`, call super, continue only when it returns `true`. `tickPrePhysics` / `tickPostPhysics`: super first, null-guard cached refs. `setLifeSpan(s)` auto-destroys; `destroy()` ends play; `removeFromParent()` only detaches.
- **Transforms.** `position` / `rotation` / `quaternion` are local. `forwardDirection()` / `rightDirection()` are world space (`false` for parent space). Pawn forward is −Z; three's `getWorldDirection()` on a non-camera node returns world **+Z**.
- **Query.** `world.getNodes(Type)`, `node.getNode(Type)`, `node.getRoot()`, `world.getNodesByTag('enemy')`, `world.getFirstPlayerPawn()` ([building-node-trees](references/building-node-trees.md#queries)).
- **Asset paths.** `@engine/assets/...` and `@project/assets/...` as full literals, never built from parts. Textures: `ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString('@project/assets/.../foo.png'))`, keeping the `.png` name even when baked to `.ktx2`. HTML strings: `await ENGINE.resolveAssetPathsInText(html)` ([asset-paths](references/asset-paths.md)).
- **HTML UI** through `genesys-ui`, mounted under `world.gameContainer`, never `document.body`.
- **Generated files.** `src/auto-imports.ts` and `src/game-data.ts` are written by the build; never edit them.
- **In the editor.** After TS edits: `pnpm build`, `pnpm lint`, then MCP `action_build(buildProject)`; confirm with `query_editor(getRegisteredClasses, filter=…)` before spawning by MCP. Bundle proof: `genesys-game-boot`.
- **Removed.** `ENGINE.Actor`, `SceneComponent`, `addActor`, `getActors*`, `rootComponent` are gone (`engine-upgrades`).

## Traps

- `new SomeNode()` → children and options missing. `@EngineClass('X')` → exported as `undefined` (`.engine/src/index.ts`).
- Field resets after save, prefab or reload → missing `@ENGINE.property()` (lowercase, not `@Property`) or `@ENGINE.GameClass()`.
- A colour, transform, material or mesh for one editor node written in `beginPlay` → the scene file never changes. Set it through MCP (`genesys-mcp-orchestrator`); class defaults in code are fine.
- Subclassing `GSSNode` or extending `MoverNode` → Mover was removed in engine 19; GSS modes are registered. Follow `genesys-movement`.
- Hand-rolled movement, camera boom, projectile or health → duplicated physics and replication bugs. Use the table above.
- Raw input in a pawn → input routes through the `PlayerController`; only `DefaultCharacterPawn` re-exposes raw `onKeyDown` / mouse / gamepad delegates, forwarded by `DefaultPlayerController` → put keys in a `PlayerController` subclass, or use those delegates on a `DefaultCharacterPawn`.
- `isRoot` set in `initialize` or via `super.initialize({ ...options, isRoot: true })` → set it in the constructor. A lone mesh wrapped in an empty `PrimitiveNode` → promote the mesh with `isRoot: true`.
- A code-built enemy, pickup or hazard takes no damage, is never collected, or never triggers → its top node lacks `isRoot`.
- Hitscan, melee box or projectile from a child fires behind → three's `getWorldDirection()` (+Z) or `forwardDirection(false)` → use `forwardDirection()`.
- HUD updates twice after Retry, or a destroyed node still reacts → a `Delegate` subscriber never `remove`d in `endPlay`. Keep one arrow-function reference.
- `setTickEnabled(true)` logs "has no effect" → the class sets `canEverTick = false`.
- `TextureLoader` on a `@project` path → breaks when baked to `.ktx2`; it is for external URLs only.
- `pnpm build` passed but Play is unchanged → typecheck does not rebuild `.dist/game.js` (`genesys-game-boot`).

## Done

- `pnpm build` and `pnpm lint` pass; `getRegisteredClasses` lists every new `GAME.*` class after `buildProject`.
- No `new` on a node class (`grep -rn "new [A-Z][A-Za-z]*Node(" src` is empty), no `@EngineClass`, no edits to `auto-imports.ts`, no constructed asset paths.
- Each new system was checked against "Engine already has it"; the report names the engine class used or why none fit.
- Every code-built gameplay root sets `isRoot`; aiming uses `forwardDirection()`, not three's `getWorldDirection()`.
- Behaviour is proven in Play per `genesys-verification`.

## References

- [find-engine-class](references/find-engine-class.md) — class paths, digest, commands, demos, synonyms
- [contracts](references/contracts.md) — `Delegate`, GameMode facade, `isRoot`, transforms, `setTickEnabled`
- [scene-node](references/scene-node.md), [building-node-trees](references/building-node-trees.md) — root classes, spawning, lifecycle, children
- [pawn-player-controller](references/pawn-player-controller.md), [avatars](references/avatars.md), [input-handling](references/input-handling.md) — pawns, possession, avatar appearance, input
- [world-scene-node-overview](references/world-scene-node-overview.md), [game-loop](references/game-loop.md), [project-structure](references/project-structure.md), [asset-paths](references/asset-paths.md), [property-serialization-system](references/property-serialization-system.md), [threejs-extension](references/threejs-extension.md)
