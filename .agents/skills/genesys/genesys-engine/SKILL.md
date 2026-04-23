---
name: genesys-engine
description: Provides comprehensive reference for the Genesys game engine including architecture, actors, components, APIs, and project structure. Use when implementing game features, exploring the codebase or project structure, working with engine classes, or when the user mentions Genesys, engine, game logic, actors, components, scenes, worlds, levels, pawns, controllers, input handling, cameras, serialization, game loop, project structure, or project organization.
---

# Genesys Engine Overview
- The engine package name is `@gnsx/genesys.js`
- Source code of the engine is located at `node_modules/@gnsx/genesys.js/src`
  NOTE! Don't use the grep/glob tool to find stuff in the engine source since the entire `node_modules` folder is gitignored and those tools respect it. Use the bash tool instead.
  The read tool is NOT affected by this so keep using it!

## Core Architecture

1. Actor-Component System: The engine uses a class-based Actor-Component pattern
    - Actor = any object in the world (has a root SceneComponent)
    - Every Actor has a root SceneComponent — this is the transform anchor
    - SceneComponent = transform + visual/physics representation (extends THREE.Object3D)
    - Components form a parent-child hierarchy via standard Three.js add()/remove()
    - Actors tick components: PrePhysics → [physics] → PostPhysics

2. World-Centric Runtime:
    - World = the runtime scene manager, owns the Three.js scene, actors, and global systems
    - Level = serialized world data + resources
    - GameMode: Spawns players, manages rules (transient — not saved)
    - GameLoop: Drives tick, manages World/Level lifecycle

## Core Coding Guidelines
- When using the engine, import the entire module into scope with `import * as ENGINE from '@gnsx/genesys.js'`
- Access all engine classes via the `ENGINE` namespace (e.g., `ENGINE.Pawn`, `ENGINE.CharacterMovementComponent`, `ENGINE.GameMode`)
- THREE.js is not re-exported from the engine. Import it separately: `import * as THREE from 'three'`
- After finishing ALL the code changes, run `pnpm build` and `pnpm lint` to make sure the output is clean.
- Actor and component instances must be created using the `.create(options)` method. Calling the constructor directly is forbidden.
- DO NOT use the "EngineClass" decorator, use "GameClass" instead.
- Use correct typing, "xxx as any" is forbidden.

## References

Read the references below that match what you're implementing:

- `SKILL_DIR/references/world-actor-component-overview.md`: understand relationship between the world, actor and component system.

- `SKILL_DIR/references/actor.md`: learn how to create game objects, manage their lifecycle, and make them respond to game events.

- `SKILL_DIR/references/component.md`: understand how to build actor behavior from modular pieces, work with component hierarchies, and handle component lifecycle.

- `SKILL_DIR/references/game-loop.md`: dive deeper into how the engine runs frame by frame, manages the world lifecycle, and keeps your game state persistent across level loads.

- `SKILL_DIR/references/pawn-player-controller.md`: learn how the engine separates your character's body from the brain that controls it. Useful for understanding player possession, switching characters, and the different ways pawns can move.

- `SKILL_DIR/references/input-handling.md`: explore how keyboard, mouse, gamepad, and touch input are captured and routed to your game.

- `SKILL_DIR/references/camera.md`: understand how cameras work in the engine.

- `SKILL_DIR/references/threejs-extension.md`: understand how the engine bridges the gap between Three.js's local-space-only API and the world-space operations, component discovery, and game lifecycle management required for game development.

- `SKILL_DIR/references/property-serialization-system.md`: learn how the engine saves and loads your game world, enables prefab inheritance, and powers the editor's property panels.

## Patterns

The `SKILL_DIR/patterns` folder contains concise guides explaining recommended patterns for isolated features. There is no index; list the folder contents and use file names to identify relevant patterns.


# Methodology
Follow steps below when working with genesys:
1. **Before exploring the codebase or making any changes, you MUST first read `SKILL_DIR/references/project-structure.md`** to understand the project structure.
2. Identify the relevant references, read them.
3. **Before exploring the codebase or making any changes, you MUST first list `SKILL_DIR/patterns`**, then identify and load the relevant ones.
5. Continue with the new context.

# Tips
- grep CLASS_NAME against `node_modules/@gnsx/genesys.js/artifacts/class-hierarchy.xml` to find exactly where its source is. You can also read the file in whole to understand the entire engine class hierarchy.
- The property decorator is `ENGINE.property` (lower case)
