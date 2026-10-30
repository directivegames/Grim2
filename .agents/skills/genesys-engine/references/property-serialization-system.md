# Property and serialization system

Decorators drive saving, loading, editor integration, and network replication.

Why it matters:
1. **Scene persistence** — level files store every node's transform, children, and configuration.
2. **Prefab support** — instances inherit from a base and override specific properties.
3. **Editor integration** — properties show in the editor with type, limits, and descriptions.
4. **Network replication** — chosen properties sync across clients.
5. **Type safety** — serialized data is rebuilt into the right class.

## Property metadata

Mark a saved field with `@ENGINE.property()` (lowercase).

Source: .engine/src/utils/serialization/decorator.ts (`property`, `PropertyMetadataBase`)
```typescript
@ENGINE.GameClass()
export class Spawner extends ENGINE.SceneNode {
  @ENGINE.property({ type: 'number', min: 0, step: 0.1, description: 'Seconds between spawns', category: 'Spawning' })
  public interval = 2;

  @ENGINE.property({ type: 'enum', options: ['Easy', 'Normal', 'Hard'] })
  public difficulty = 'Normal';
}
```

Metadata covers:
- Type information (`type`: `'number'`, `'string'`, `'boolean'`, `'vector2'`, `'vector3'`, `'euler'`, `'enum'`, …). Numeric types take `min`, `max`, `step`, `decimals`; `number` also takes `unit`.
- Editor hints: `label`, `description`, `category`, `order`, `hidden`, `readonly`.
- Serialization behaviour: `transient` (never saved), `transientOnPrefab` (skipped for prefabs), `editorOnly`, `alwaysSerializeWhenSet`, `migrateFrom`.
- Network replication: `replicate` and `net` settings (see `genesys-multiplayer`).
- Default values: `default`.

The decorator only attaches metadata. The enclosing class still needs `@ENGINE.GameClass()` for dump, load, and prefabs. `src/game-data.ts` is generated from these decorators; do not edit it.

## Class registration

Classes must be registered to be instantiable from JSON, prefabs, and scene files.

Source: .engine/src/systems/ClassRegistry.ts (`GameClass`, `EngineClass`)
- Use `@ENGINE.GameClass()` on every custom SceneNode subclass or serializable class.
- `@EngineClass` is reserved for engine built-ins and registers a name that must be globally unique. The root `ENGINE` export sets `EngineClass` to `undefined`, so game code cannot use it.
- In prefab JSON, reference engine classes as `ENGINE.{ClassName}` and game classes as `GAME.{ClassName}` (`ENGINE.SceneNode`, `ENGINE.MeshNode`, `GAME.PickupRoot`).
- Registered classes are discovered through the generated `src/auto-imports.ts`. Never edit it.
- After adding a class, run MCP `action_build(action="buildProject")` and confirm with `query_editor(operation="getRegisteredClasses", filter="YourClass")`.

## Dumper and Loader

Source: .engine/src/utils/serialization/serializer.ts

**Dumper** converts live objects to JSON. It traverses object graphs, compares against defaults to keep output small, and compacts type tags (for example `$bc`).

**Loader** rebuilds objects from JSON. It resolves class names through `ClassRegistry`, handles circular references, and calls `postLoad()` after properties are set.

## Serializable objects

Implement `ISerializableObject` for custom control. The marker is `readonly [ISerializableObjectTag]: true`; all methods are optional.

Source: .engine/src/utils/serialization/serializable.ts
- `serialize(dumper)` / `deserialize(loader)` — custom logic.
- `isTransient()` — skip serialization dynamically.
- `postLoad()` — setup after loading.

`SceneNode` implements this interface for placeables and their trees.

## Usage pattern

1. Add `@ENGINE.GameClass()` to the class.
2. Mark fields with `@ENGINE.property()`.
3. Call `setTransient(true)` on runtime objects that must not be saved.
4. Set per-instance values for placed nodes through MCP, not in code (`genesys-mcp-orchestrator`).
