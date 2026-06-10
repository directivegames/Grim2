---
name: TSL-node-material-assets
description: Build custom WebGPU TSL NodeMaterialAsset classes in a Genesys game project with correct class registration and editor integration. Use when implementing TSL material shaders, game-side shader assets, material save/load, or NewMaterialDialog/property-editor support for node materials.
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
- Build the TSL shader node graph in a dedicated `rebuild()` method.

## Implementation Checklist
1. Create a class extending `ENGINE.NodeMaterialAsset(Mesh*NodeMaterial)`.
2. Add `@ENGINE.GameClass({ isNodeMaterialAsset: true, nodeMaterialDisplayName, nodeMaterialGroup })`.
3. Add authored fields with `@ENGINE.property({ type, description, ... })` and sensible defaults.
4. Implement `rebuild()` to translate authored fields into TSL nodes.
5. Ensure the module is imported during startup so the class is registered.
6. Assign the material like any `THREE.Material` to mesh components/actors.

## Best Practices (Mandatory)
- Texture ownership: If `rebuild()` creates textures, cache owned textures on the instance and reuse when URL is unchanged.
- Disposal: Dispose owned textures when replaced or removed, and in `dispose()`/teardown. Never leak rebuild-allocated textures.
- Failure containment: Wrap `rebuild()` in `try/catch`; on failure, assign a safe fallback graph and set `needsUpdate = true`.
- Property changes: When gameplay/editor code mutates authored fields at runtime, call `rebuild()` and set `needsUpdate = true`.
- Loop safety: Clamp/sanitize loop-driving values (sample counts, scales, fade ranges) before feeding TSL logic.
- TSL naming: Use prefixed `toVar('prefixName')` names and avoid local-variable shadowing of authored properties.

## Lifecycle Guidance
- Constructor must call `rebuild()` after authored fields are initialized.
- Prefer module-side registration + asset class colocated in one file.

## Reference
- ./references/game-project-setup.md
