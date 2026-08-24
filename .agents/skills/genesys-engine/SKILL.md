---
name: genesys-engine
description: Core Genesys engine reference and the entry point for any game feature — SceneNode/PrimitiveNode/MeshNode placeables, World APIs, pawns and controllers, input, cameras, serialization, and project structure. Use when implementing game logic, exploring a Genesys project, or working with engine classes. Routes to the sibling skill that owns each subsystem (movement, physics, UI, audio, VFX, AI, navigation, multiplayer).
---

# Methodology

1. Read [project-structure](references/project-structure.md) for the folder layout and entry points.
2. Check Subsystem skills below. If another skill owns the area, load it instead of guessing.
3. Read the References that match the task.
4. Check Patterns for a matching implementation guide.
5. Continue with the gathered context.

# Genesys Engine Overview

- The engine package is `@gnsx/genesys.js`.
- Engine source is mirrored read-only at `.engine/src/` in the project root. This is the authoritative reference for class hierarchies, method signatures, and coding patterns — consult it before guessing.

## Core Coding Guidelines

- Import the engine with `import * as ENGINE from '@gnsx/genesys.js'` and access classes via the namespace (`ENGINE.Pawn`, `ENGINE.CharacterPawn`, `ENGINE.PrimitiveNode`). Import Three.js separately: `import * as THREE from 'three'`.
- Create node instances with the `.create(options)` factory. Do not call the constructor directly.
- Decorate every custom SceneNode subclass and serializable class with `@ENGINE.GameClass()`. Never use `@EngineClass` — it is engine-internal.
- Mark serializable fields with `@ENGINE.property()` (lowercase). The decorator only attaches metadata; the enclosing class still needs `@ENGINE.GameClass()` for dump/load/prefabs.
- Prefer SceneNode / PrimitiveNode / MeshNode / ModelMeshNode placeables. There is no ActorNode.
- For a custom class that is always a world/placeable root, set `this.isRoot = true` in the constructor — not in `initialize`, and not via options spread on that class. One-off built-ins may use `.create({ isRoot: true, ... })`.
- Add children with `children` in options or `this.add(...)` in `initialize`. Add placeables with `world.add(...)`. Query with `world.getNodes*` / `getRootNodes` / `getNode` / `getPlayerControllerAt`.
- For Playable lifecycle hooks, override `beginPlay()`/`endPlay()`, call super, and only run custom logic when the returned boolean is true.
- In tick handlers such as `tickPrePhysics`, null-guard cached node refs before using them.
- Prefer extending `ENGINE.CharacterPawn` for first/third-person player pawns; override its setup hooks (`createCollision`, `createMovementNode`, `getInitialCameraPositions`, `setupCamera`, `setupAnimationNode`, `setupVisualNode`) instead of replacing the class.
- Use explicit typing. Avoid `as any`.
- Run `pnpm build` and `pnpm lint` after code changes.

## Registering A Custom Class With The Editor

- After TypeScript edits, run `pnpm lint` and rebuild so the editor picks up newly registered `GAME.*` classes.
- When MCP is connected, use `action_build(action="buildProject")` to register the updated bundle in the running editor.
- `pnpm build` compiles project code but does not by itself refresh class registration in a running editor session.
- `pnpm build-project` talks to the SDK app file server and can fail from an agent shell; prefer MCP `action_build` for editor registration.
- Confirm availability before spawn actions with `query_editor(operation="getRegisteredClasses", filter="YourClass")`.

## Subsystem skills

Load the skill that owns the area rather than deriving it from engine source:

- `genesys-movement` — pawn locomotion, movement modes, MoverNode, vehicles, NPC movement.
- `genesys-physics` — raycasts, joints, impulses, collision-ignore pairs, vehicle physics.
- `genesys-navigation` — navmesh baking, pathfinding, path queries.
- `behavior-tree` — NPC AI, blackboards, custom actions and conditions.
- `genesys-ui-kit` — HUD, menus, and every screen-space widget. Use before writing raw HTML.
- `genesys-audio` — sound effects, music, spatial audio, buses.
- `genesys-vfx` — particles, explosions, trails, VFX definitions.
- `pickups-interactions-and-doors` — collectibles, usable objects, doors, switches, trigger volumes.
- `genesys-multiplayer` — replication, RPCs, server authority, GameMode.
- `webgpu-tsl-node-material-assets` — custom TSL node materials and `.material.json` assets.
- `asset-pack-authoring` — packaging classes, prefabs, and assets into a distributable pack.
- `engine-upgrades` — migrating game code across engine versions.
- `engine-search` / `engine-reference` — find an engine class by keyword, then read its source.
- `genesys-mcp-orchestrator` / `genesys-editor-manual` — driving the live editor via MCP, or teaching its UI.

## References

- [World and SceneNode Overview](references/world-scene-node-overview.md): World as a SceneNode tree and placeable roots.
- [SceneNode](references/scene-node.md): Create placeables, lifecycle, tags, and world entry.
- [Building Node Trees](references/building-node-trees.md): Children, discovery, and PrimitiveNode physics.
- [Game Loop](references/game-loop.md): Frame execution order and world/level lifecycle management.
- [Pawn and PlayerController](references/pawn-player-controller.md): Separating character representation from input handling.
- [Input Handling](references/input-handling.md): Keyboard, mouse, gamepad, and touch input.
- [Camera System](references/camera.md): Camera resolution, view target stack, perspective/orthographic setup.
- [Three.js Extension](references/threejs-extension.md): World-space transform operations and node discovery.
- [Property and Serialization System](references/property-serialization-system.md): Saving/loading, prefab inheritance, property decorators.

## Patterns

- [Sprint Movement](patterns/sprint-movement.md): Sprinting via pawn and controller logic.
- [Isometric Camera](patterns/isometric-camera.md): Orthographic camera that follows the player.
- [Top-Down Camera](patterns/top-down-camera.md): RTS/strategy overhead pan, zoom, and input toggles.
- [Mobile Controls](patterns/mobile-controls.md): Virtual joystick configuration, floating sticks, touch customization.

# Tips

- The property decorator is `ENGINE.property` (lowercase).
- Look up an unknown class with the `engine-search` skill, then read it with `engine-reference`. Prefer both over grepping `node_modules/@gnsx/genesys.js/dist`, which holds declarations without implementations.

# Deprecated (compat only)

Existing projects may still mention `Actor`, `SceneComponent`, `world.addActor`,
`getActors*`, `rootComponent`, `sceneComponents`, or `getActor()`. `ENGINE.Actor`
is a deprecated compatibility root only. Prefer the node APIs above; for migration
steps open the `engine-upgrades` skill, reference `13-14`.
