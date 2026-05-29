# genesys-engine (skill)

Provides comprehensive reference for the Genesys game engine (@gnsx/genesys.js) architecture, actors, components, and project structure.

## Overview

The Genesys engine uses a World-Actor-Component architecture that organizes game entities into a clear hierarchy. This pattern separates concerns between scene management (World), game entities (Actors), and functional building blocks (Components).

### Why the Property System?

The property and serialization system is the backbone of data persistence. It solves several interconnected problems:
1. Scene Persistence - Save and load level files with all actor positions, components, and configurations.
2. Prefab Support - Reusable templates where instances inherit from a base but can override specific properties.
3. Editor Integration - Expose properties in the editor with type information, limits, and descriptions.
4. Network Replication - Synchronize specific properties across clients in multiplayer games.
5. Type Safety - Ensure serialized data can be correctly reconstructed into the right class instances.

## Contents

- `SKILL.md` - Primary decision logic and coding guidelines.
- `references/` - Deep dives into engine subsystems.
- `patterns/` - Concise guides for common feature implementations.
