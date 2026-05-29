# Property and Serialization System

The property and serialization system enables automatic saving/loading, editor integration, and network replication through decorators.

## Property Metadata

Mark properties with the @ENGINE.property() decorator. Metadata includes:
- Type information (number, string, boolean, vector, enum).
- Editor UI hints (min/max, step, category, description).
- Serialization behavior (skip for prefabs, skip outside editor).
- Network replication toggle.
- Default values.

Reference: See serialization/decorator.ts in engine source.

## Class Registration

Classes must be registered to be instantiable from JSON, prefabs, and scene files.
- Use @ENGINE.GameClass() for every custom Actor, Component, or serializable class in your project.
- Do not use @EngineClass — it is reserved for engine built-in classes and registers a name that must be globally unique.
- In prefab JSON, reference engine classes as "ENGINE.{ClassName}" and game classes as "GAME.{ClassName}".

Reference: See ClassRegistry.ts in engine source.

## Dumper and Loader

Dumper converts live objects to JSON.
- Traverses object graphs.
- Compares against defaults to minimize output.
- Optimizes type tags (e.g., $bc).

Loader reconstructs objects from JSON.
- Resolves class names via ClassRegistry.
- Handles circular references.
- Calls postLoad() after properties are set.

Reference: See serialization/serializer.ts in engine source.

## Serializable Objects

Implement ISerializableObject for custom control:
- serialize(dumper) / deserialize(loader) — Custom logic.
- isTransient() — Dynamically skip serialization.
- postLoad() — Setup after loading.

The Actor base class implements this interface.

## Usage Pattern

1. Add @ENGINE.GameClass() decorator to the class.
2. Mark fields with @ENGINE.property().
3. Call setTransient(true) for runtime objects that should not be saved.
