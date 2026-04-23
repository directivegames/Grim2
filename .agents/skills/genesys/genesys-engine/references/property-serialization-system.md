# Property and Serialization System

## Overview

The property and serialization system is the backbone of data persistence in the Genesys engine. It enables automatic saving and loading of game objects, editor integration, and network replication through a decorator-based metadata system.

## Why This System Exists

Game engines need to solve several interconnected problems:

1. **Scene Persistence** - Save and load level files with all actor positions, components, and configurations
2. **Prefab Support** - Create reusable templates where instances inherit from a base but can override specific properties
3. **Editor Integration** - Expose properties in the editor with type information, limits, and descriptions
4. **Network Replication** - Synchronize specific properties across clients in multiplayer games
5. **Type Safety** - Ensure serialized data can be correctly reconstructed into the right class instances

Rather than manually writing serialization logic for every class, the property system uses metadata to automatically handle all these concerns through declarative decorators.

## Key Concepts

### Property Metadata

Properties are marked with the `@property()` decorator, which stores metadata about:

- **Type information** - Whether the property is a number, string, boolean, vector, enum, or complex type
- **Editor UI hints** - Min/max values, step size, decimal places, description text, category organization
- **Serialization behavior** - Whether to skip the property entirely, skip only for prefabs, or skip outside the editor
- **Network replication** - Whether this property should sync across the network
- **Default values** - Used to skip serialization when the current value matches the default

See `node_modules/@gnsx/genesys.js/src/utils/serialization/decorator.ts` for the full property metadata interface.

### Class Registration

Classes must be registered to be instantiable from serialized data. The engine uses two decorators:

- `@EngineClass('ClassName')` for engine-built-in classes
- `@GameClass()` for game-specific classes

Registration stores the mapping between class names and constructors in `ClassRegistry`, enabling the loader to reconstruct objects from their serialized type identifiers.

See `node_modules/@gnsx/genesys.js/src/systems/ClassRegistry.ts` for the registration system.

### Dumper and Loader

The serialization pipeline uses two primary classes:

**Dumper** converts live objects to JSON:
- Traverses object graphs and identifies shared references
- Uses property metadata to determine what to include
- Compares values against defaults to minimize output
- Optimizes the format by inlining single-reference objects
- Generates compact type tags like `$bc` (base class) for known types

**Loader** reconstructs objects from JSON:
- Resolves class names to constructors via `ClassRegistry`
- Handles circular references and shared object instances
- Supports loading into existing objects (for updating prefab instances)
- Calls `postLoad()` on objects that implement it for initialization after all properties are set

See `node_modules/@gnsx/genesys.js/src/utils/serialization/serializer.ts` for the implementation.

### Serializable Objects

Classes can implement `ISerializableObject` for custom serialization control:

- `serialize(dumper)` - Custom dumping logic
- `deserialize(loader)` - Custom loading logic
- `isTransient()` - Dynamically determine if this object should be skipped
- `postLoad()` - Called after all properties are loaded for setup/validation

The `Actor` base class implements this interface and serves as the foundation for all serializable world objects.

## Usage Pattern

To make a class serializable:

1. Add the class decorator: `@EngineClass('MyClass')` or `@GameClass()`
2. Mark properties with `@property()` and appropriate metadata
3. For custom serialization needs, implement `ISerializableObject` methods
4. The engine automatically handles saving and loading via `WorldSerializer`

Transient objects (like runtime-spawned player pawns) can call `setTransient(true)` to prevent being saved in scene files.
