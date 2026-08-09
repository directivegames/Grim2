---
name: genesys-engine
description: Provides comprehensive reference for the Genesys game engine including SceneNode architecture, World APIs, pawns, controllers, input, cameras, serialization, and project structure. Use when implementing game features, exploring the codebase or project structure, working with engine classes, or when the user mentions Genesys, engine, game logic, SceneNode, PrimitiveNode, MeshNode, nodes, scenes, worlds, levels, pawns, controllers, input handling, mobile controls, touch input, virtual joystick, on-screen controls, cameras, serialization, game loop, project structure, or project organization.
---

# Methodology

Follow these steps when working with Genesys:

1. Read [project-structure](references/project-structure.md) to understand the folder layout and entry points.
2. Read the relevant subsystem references in the References section below.
3. Check the Patterns section below for implementation guides for specific features.
4. Continue with the gathered context.

# Genesys Engine Overview

- The engine package name is @gnsx/genesys.js.
- Engine source code is available in the .engine folder at the project root. Use this as your primary reference for class hierarchies, method signatures, and coding patterns.

## Core Coding Guidelines

- Import the engine module with import * as ENGINE from '@gnsx/genesys.js'.
- Access all engine classes via the ENGINE namespace (e.g., ENGINE.Pawn, ENGINE.CharacterPawn, ENGINE.PrimitiveNode).
- Import Three.js separately: import * as THREE from 'three'.
- Run pnpm build and pnpm lint after code changes to verify cleanliness.
- Create node instances using the .create(options) factory method. Do not call the constructor directly.
- Decorate every custom SceneNode subclass and serializable class with @ENGINE.GameClass(). Never use @EngineClass — it is engine-internal.
- Mark serializable fields with @ENGINE.property() (lowercase). Prefer decorating the enclosing class with @ENGINE.GameClass() so the class is registered for dump/load/prefabs (the decorator itself only attaches metadata).
- Prefer SceneNode / PrimitiveNode / MeshNode / ModelMeshNode placeables. There is no ActorNode. `ENGINE.Actor` is a deprecated compatibility root only.
- For a custom class that is always a world/placeable root, set `this.isRoot = true` in the **constructor**. Do not set `isRoot` in `initialize` or via options spread on that class. One-off built-ins may use `.create({ isRoot: true, ... })`.
- Add children with `children` in options or `this.add(...)` in `initialize`. Do not use deprecated `rootComponent` / `sceneComponents` options.
- Add placeables with `world.add(...)`. Query with `world.getNodes*` / `getRootNodes` / `getNode` / `getPlayerControllerAt`. Do not use deprecated `addActor` / `getActors*`.
- For Playable lifecycle hooks, override beginPlay()/endPlay(), call super, and only run custom logic when the returned boolean is true.
- In tick handlers (such as tickPrePhysics), null-guard cached node refs before using them.
- Prefer extending ENGINE.CharacterPawn for first/third-person player pawns; override its setup hooks (createCollision, createMovementNode, getInitialCameraPositions, setupCamera, setupAnimationNode, setupVisualNode) instead of replacing the whole class.
- Use explicit typing. Avoid as any.

## Registering A Custom Class With The Editor

- After TypeScript edits, run `pnpm lint` and rebuild so the editor picks up newly registered `GAME.*` classes.
- When MCP is connected, use `action_build(action="buildProject")` to register the updated bundle in the running editor.
- `pnpm build` compiles project code, but by itself does not refresh class registration in an already running editor session.
- `pnpm build-project` (CLI script) talks to the SDK app file server and can fail from an agent shell; for editor registration workflows, prefer MCP `action_build`.

## References

Read the references below that match your current task:

- [World and SceneNode Overview](references/world-scene-node-overview.md): World as a SceneNode tree and placeable roots.
- [SceneNode](references/scene-node.md): Create placeables, lifecycle, tags, and world entry.
- [Building Node Trees](references/building-node-trees.md): Children, discovery, and PrimitiveNode physics.
- [Game Loop](references/game-loop.md): Frame execution order and world/level lifecycle management.
- [Pawn and PlayerController](references/pawn-player-controller.md): Separation of character representation from input handling logic.
- [Input Handling](references/input-handling.md): Capture and routing of keyboard, mouse, gamepad, and touch input.
- [Camera System](references/camera.md): Camera resolution, view target stack, and perspective/orthographic setup.
- [Three.js Extension](references/threejs-extension.md): World-space transform operations and node discovery.
- [Property and Serialization System](references/property-serialization-system.md): Saving/loading, prefab inheritance, and property decorators.

## Patterns

Guides for specific implementations:

- [Sprint Movement](patterns/sprint-movement.md): Implementing sprinting with pawn and controller logic.
- [Isometric Camera](patterns/isometric-camera.md): Setting up an orthographic camera that follows the player.
- [Top-Down Camera](patterns/top-down-camera.md): RTS/strategy overhead pan, zoom, and input toggles.
- [Mobile Controls](patterns/mobile-controls.md): Virtual joystick configuration, floating sticks, and touch control customization.

# Tips

- The property decorator is ENGINE.property (lowercase).
- The engine source under .engine/ is the authoritative API reference; consult it before guessing at signatures.
- To confirm class availability before spawn actions, use `query_editor(operation="getRegisteredClasses", filter="YourClass")`.
- Do not grep `node_modules/@gnsx/genesys.js/dist` as a first step. Prefer `.engine/` source and the focused references in this skill.
- For built-in widgets and HUD layouts, see the genesys-ui-kit skill rather than rolling raw HTML.
- Migrating older Actor/Component projects: see the `engine-upgrades` skill, references `13-14`.

# Deprecated (compat only)

Existing projects may still mention `Actor`, `SceneComponent`, `world.addActor`, `getActors*`, `rootComponent`, or `getActor()`. Prefer node APIs above. Open `engine-upgrades` → `13-14` for migration steps.
