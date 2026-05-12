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
- Every editor-authored field must use explicit metadata: `@ENGINE.property({ type, description, ... })`.
- Mark class instances as serializable: `readonly [ENGINE.ISerializableObjectTag] = true as const;`
- Build the TSL shader node graph in a dedicated `rebuild()` method.

## Rule
- Keep specialization registration in the same file as the `NodeMaterialAsset` class.
- Prefer a single side-effect import of the asset module during startup instead of maintaining a separate registration-only file.

## Implementation Checklist
1. Create a class extending `ENGINE.NodeMaterialAsset(Mesh*NodeMaterial)`.
2. Add `@ENGINE.GameClass({ isNodeMaterialAsset: true, nodeMaterialDisplayName, nodeMaterialGroup })`.
3. Add authored fields with `@ENGINE.property({ type, description, ... })` and sensible defaults.
4. Implement:
   - `rebuild()`
   - `serialize(dumper) { this.serializeAuthoredFields(dumper); }`
   - `static staticDeserialize(data, loader)` using `loadAuthoredFields(...)` + `rebuild()`
5. Register specialization for the class via `ENGINE.registerSpecialization(...)` (serializeFn/staticDeserializeFn/cdo).
6. Ensure the module is imported during startup (so decorators + specialization registration execute).
7. Assign the material like any `THREE.Material` to mesh components/actors.

## Best Practices (Mandatory)
- **Texture ownership:** If `rebuild()` creates textures, cache owned textures on the instance and reuse when URL is unchanged.
- **Disposal:** Dispose owned textures when replaced or removed, and in `dispose()`/teardown. Never leak rebuild-allocated textures.
- **Failure containment:** Wrap `rebuild()` in `try/catch`; on failure, assign a safe fallback graph and set `needsUpdate = true`.
- **Deserialize lifecycle:** Avoid duplicate heavy rebuilds (`constructor` + `staticDeserialize` + `postLoad`). Use one canonical load flow and guard `postLoad` if needed.
- **Property changes:** When gameplay/editor code mutates authored fields at runtime, call `rebuild()` and set `needsUpdate = true`.
- **Loop safety:** Clamp/sanitize loop-driving values (sample counts, scales, fade ranges) before feeding TSL logic.
- **TSL naming:** Use prefixed `toVar('prefixName')` names and avoid local-variable shadowing of authored properties.
- **Registration safety:** Keep specialization registration idempotent (`isRegistered` guard) to avoid duplicate registrations in hot-reload/import cycles.

## Lifecycle Guidance
- Constructor can optionally defer `rebuild()` when used by custom deserialize paths.
- `staticDeserialize(...)` should load authored fields, then rebuild once from final values.
- `postLoad()` remains a safety net for alternate load paths; guard it if deserialize already rebuilt.
- Prefer module-side registration + asset class colocated in one file.

## Reference
- `SKILL_DIR/references/game-project-setup.md`
