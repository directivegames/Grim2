# genesys-engine (skill)

Provides comprehensive reference for the Genesys game engine (@gnsx/genesys.js) architecture, SceneNode placeables, and project structure.

## Overview

The Genesys engine uses a World–SceneNode architecture. The World owns a SceneNode tree: placeable roots (often `PrimitiveNode`, `MeshNode`, or a custom subclass with `isRoot`) hold child nodes for visuals, physics, cameras, and gameplay behaviour.

### Why the Property System?

The property and serialization system is the backbone of data persistence. It solves several interconnected problems:
1. Scene Persistence - Save and load level files with all node positions, children, and configurations.
2. Prefab Support - Reusable templates where instances inherit from a base but can override specific properties.
3. Editor Integration - Expose properties in the editor with type information, limits, and descriptions.
4. Network Replication - Synchronize specific properties across clients in multiplayer games.
5. Type Safety - Ensure serialized data can be correctly reconstructed into the right class instances.

## Contents

- `SKILL.md` - Primary decision logic and coding guidelines.
- `references/` - Deep dives into engine subsystems.
- `patterns/` - Concise guides for common feature implementations.
