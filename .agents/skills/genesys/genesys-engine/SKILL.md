---
name: genesys-engine
description: Provides comprehensive reference for the Genesys game engine including architecture, actors, components, APIs, and project structure. Use when implementing game features, exploring the codebase or project structure, working with engine classes, or when the user mentions Genesys, engine, game logic, actors, components, scenes, worlds, levels, pawns, controllers, input handling, mobile controls, touch input, virtual joystick, on-screen controls, cameras, serialization, game loop, project structure, or project organization.
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
- Access all engine classes via the ENGINE namespace (e.g., ENGINE.Pawn, ENGINE.CharacterPawn).
- Import Three.js separately: import * as THREE from 'three'.
- Run pnpm build and pnpm lint after code changes to verify cleanliness.
- Create actor and component instances using the .create(options) factory method. Do not call the constructor directly.
- Decorate every custom Actor, Component, and serializable class with @ENGINE.GameClass(). Never use @EngineClass — it is engine-internal.
- Mark serializable fields with @ENGINE.property() (lowercase). The decorator requires the enclosing class to be @ENGINE.GameClass().
- For Playable lifecycle hooks, override beginPlay()/endPlay(), call super, and only run custom logic when the returned boolean is true.
- In tick handlers (such as tickPrePhysics), null-guard cached component refs before using them.
- Prefer extending ENGINE.CharacterPawn for first/third-person player pawns; override its setup hooks (createRootComponent, createMovementComponent, getInitialCameraPositions, setupCamera, setupAnimationComponent, setupVisualComponent) instead of replacing the whole class.
- Use explicit typing. Avoid as any.

## Registering A Custom Class With The Editor

- After TypeScript edits, run `pnpm lint` and rebuild so the editor picks up newly registered `GAME.*` classes.
- When MCP is connected, use `action_build(action="buildProject")` to register the updated bundle in the running editor.
- `pnpm build` compiles project code, but by itself does not refresh class registration in an already running editor session.
- `pnpm build-project` (CLI script) talks to the SDK app file server and can fail from an agent shell; for editor registration workflows, prefer MCP `action_build`.

## References

Read the references below that match your current task:

- [World, Actor, and Component Overview](references/world-actor-component-overview.md): understand relationship between the world, actor and component system.
- [Actor](references/actor.md): Learn how to create game objects, manage their lifecycle, and make them respond to game events.
- [Component](references/component.md): Understand how to build actor behavior from modular pieces and handle component lifecycle.
- [Game Loop](references/game-loop.md): Frame execution order and world/level lifecycle management.
- [Pawn and PlayerController](references/pawn-player-controller.md): Separation of character representation from input handling logic.
- [Input Handling](references/input-handling.md): Capture and routing of keyboard, mouse, gamepad, and touch input.
- [Camera System](references/camera.md): Camera resolution, view target stack, and perspective/orthographic setup.
- [Three.js Extension](references/threejs-extension.md): World-space transform operations and component discovery.
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
