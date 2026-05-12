---
name: TSL-node-material-assets
description: Build custom WebGPU TSL NodeMaterialAsset classes in a Genesys game project with correct class registration, serialization specialization, and editor integration. Use when implementing TSL material shaders, game-side shader assets, material save/load, or NewMaterialDialog/property-editor support for node materials.
---

# Genesys TSL Node Material Assets

Use this skill when a game project needs custom WebGPU TSL material shaders that:
- can be assigned to mesh components at runtime,
- appear in the editor's New Material flow,
- expose authored fields in the property editor, and
- round-trip safely through scene/material serialization.

## Required Conventions
- Import engine APIs as `import * as ENGINE from '@gnsx/genesys.js';`
- Use `@ENGINE.GameClass(...)` for game-defined asset classes (never `EngineClass` in game code).
- Mark authored fields with `@ENGINE.property(...)`.
- Mark class instances as serializable: `readonly [ENGINE.ISerializableObjectTag] = true as const;`
- Build the TSL shader node graph in a dedicated `rebuild()` method and call it from constructor and load path.

## Implementation Checklist
1. Create a class extending `ENGINE.NodeMaterialAsset(Mesh*NodeMaterial)`.
2. Add `@ENGINE.GameClass({ isNodeMaterialAsset: true, nodeMaterialDisplayName, nodeMaterialGroup })`.
3. Add authored fields with `@ENGINE.property(...)` and sensible defaults.
4. Implement:
   - `rebuild()`
   - `serialize(dumper) { this.serializeAuthoredFields(dumper); }`
   - `static staticDeserialize(data, loader)` using `loadAuthoredFields(...)` + `rebuild()`
5. Register specialization for the class via `ENGINE.registerSpecialization(...)` (serializeFn/staticDeserializeFn/cdo).
6. Ensure the module is imported during startup (so decorators + specialization registration execute).
7. Assign the material like any `THREE.Material` to mesh components/actors.

## Defensive Runtime Safety
- Add `postLoad()` that calls `rebuild()` as a safety net.
- After property changes in gameplay/editor code, call `rebuild()` and set `needsUpdate = true`.

## Reference
- `SKILL_DIR/references/game-project-setup.md`
