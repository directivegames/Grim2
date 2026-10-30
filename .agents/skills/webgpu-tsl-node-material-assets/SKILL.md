---
name: webgpu-tsl-node-material-assets
description: "Node materials: the 22 shipped classes (dissolve, fresnel rim, neon pulse, vertex wave, triplanar, toon, glass, heat haze and more), custom TSL NodeMaterialAsset classes, .material.json assets, assigning them to meshes. Use for shaders, TSL, custom materials, hologram, force field, toon or cel shading, glass, water wobble, dissolve, glowing stripes. Not for emissive glow or bloom (use `genesys-lighting`), particles (use `genesys-vfx`) or textures and models (use `genesys-assets`)."
metadata:
  tokens: 3019
---

# Node materials (shipped classes and custom TSL)

This skill owns materials whose look comes from a TSL node graph: the 22 node-material classes the engine ships, and custom `NodeMaterialAsset` classes written in game code. The most important rule: **use a shipped class first.** Most "custom shader" requests (hologram rim, dissolve, neon stripes, swaying grass, toon shading, glass) are one `createMaterial` call with a shipped class. Write a custom class only when no shipped class fits.

A TypeScript material class and a saved `.material.json` asset are different things. The class defines the graph and its authored fields; the asset stores one instance's field values. Build and register a class, then create an asset from it in the editor.

## Use another skill when

- MCP availability gate, `run_script` dispatch, approvals; setting a material on a scene node and its persistence trap → `genesys-mcp-orchestrator`
- Class registration, `@ENGINE.GameClass()`, `@ENGINE.property()` rules → `genesys-engine`
- `pnpm lint`, `action_build(buildProject)`, and proving Play runs the new class → `genesys-game-boot`
- Emissive glow on a standard material, lights, shadows, exposure, bloom, colour grade → `genesys-lighting`
- Particles and one-shot effects → `genesys-vfx`
- Textures, models and where they come from → `genesys-assets`; generated textures → `genesys-generated-assets`
- Texture compression (KTX2) of material textures at build → `genesys-asset-compiler`
- Shared materials on spawned things, shader warm-up on the title → `genesys-profiler`
- Doing it by hand in the editor (Asset Browser, Inspector) → `genesys-editor-manual`

## Decide: use a shipped class first

All live in `.engine/src/runtime/materials/nodeMaterialAssets/`; the registry name is `ENGINE.<Class>`. Authored fields and defaults per class: [shipped-classes](references/shipped-classes.md).

| Want | Class (`ENGINE.…`) |
|---|---|
| Hologram, force field, ghost edge glow | `FresnelRimNodeMaterialAsset` |
| Burn / dissolve with glowing edge, looping or a one-shot fade | `DissolveNodeMaterialAsset` |
| Pulsing neon stripes (sci-fi trims, pads) | `NeonPulseNodeMaterialAsset` |
| Swaying grass, flags, water wobble | `VertexWaveNodeMaterialAsset` |
| Textured ground or walls with no UVs (blockout grids, terrain; engine `M_Floor` / `M_Wall`) | `DynamicUVNodeMaterialAsset` |
| Procedural world-space stripes for terrain-like shading | `WorldTriplanarNodeMaterialAsset` |
| Vertical two-colour gradient (sky domes, stylised props; unlit) | `ColorGradientNodeMaterialAsset` |
| Heat haze, magic shimmer | `HeatDistortionNodeMaterialAsset` |
| Soap bubble, beetle shell, oil sheen | `IridescenceNodeMaterialAsset` |
| Wax, skin, jelly, leaves lit from behind | `SSSNodeMaterialAsset` |
| Glass, ice, crystal | `TransmissionNodeMaterialAsset` |
| Layered depth illusion on flat panels | `ParallaxUVNodeMaterialAsset` |
| Toon / cel shading (engine toon ramps in `@engine/assets/textures/`) | `MeshToonNodeMaterialAsset` |
| Baked-looking stylised lighting (`@engine/assets/textures/matcaps/`) | `MeshMatcapNodeMaterialAsset` |
| Plain PBR / unlit / classic shading | `MeshStandardNodeMaterialAsset`, `MeshPhysicalNodeMaterialAsset`, `MeshBasicNodeMaterialAsset`, `MeshLambertNodeMaterialAsset`, `MeshPhongNodeMaterialAsset` |
| Debug normals; point clouds; billboards | `MeshNormalNodeMaterialAsset`, `PointsNodeMaterialAsset`, `SpriteNodeMaterialAsset` |

Write a custom class (*Custom class* below) when the effect needs a graph none of these has, or a field driven from gameplay that no shipped class has.

## Build: create a material from a shipped class

`action_asset(action="createMaterial", materialClassName: "ENGINE.FresnelRimNodeMaterialAsset", name: "M_GhostRim", parentPath: "assets/materials")` writes `@project/assets/materials/M_GhostRim.material.json` with the class defaults. Then assign it on the mesh node (`material`, *MCP workflow*), save, re-query.

**Setting authored values on a material asset.** There is no MCP route: `action_asset` has no property-edit operation and `action_node(action="setProperties")` edits scene nodes, not material files. Do not hand-write `.material.json`. Fallbacks, in order:
1. Editor UI: double-click the `.material.json` in the Asset Browser, set the fields in **Inspector (Material)**, save (`genesys-editor-manual`). Tell the creator in one line which fields to set when MCP is all you have.
2. A reusable asset with your values and no UI: a small `GAME.*` subclass of the shipped class whose field initializers carry the values, written with the full pattern in [game-project-setup.md](references/game-project-setup.md) (its own `staticDeserialize` and `registerSpecialization`), then `createMaterial` from it. Verify on first use that the fields round-trip.
3. Materials made in code for runtime-spawned things: set the fields, then call `rebuild()`.

Source: `.engine/src/runtime/materials/nodeMaterialAssets/FresnelRimNodeMaterialAsset.ts`, `.engine/src/nodes/visual/MeshNode.ts` (`MeshNode.create` options)
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// One shared material and geometry for every spawned copy (never one per spawn).
const ghostMaterial = new ENGINE.FresnelRimNodeMaterialAsset();
ghostMaterial.rimColor.set('#33ccff');
ghostMaterial.emissiveIntensity = 1.2;
ghostMaterial.rebuild();                       // authored fields reach the TSL graph only on rebuild()
const shellGeometry = new THREE.SphereGeometry(0.6, 24, 16);

export function makeGhostShell(): ENGINE.MeshNode {
  return ENGINE.MeshNode.create({ geometry: shellGeometry, material: ghostMaterial });
}
```

## Custom class

Work comes in three tags: `[Code]` (the class), `[Verify]` (lint, build, registration), `[MCP]` (create the `.material.json`, assign, save). When MCP is unavailable, the asset is made by hand in the editor (*Editor fallback*). Never edit `auto-imports.ts` manually; `@ENGINE.GameClass()` classes are discovered by the build. Before the first Genesys MCP call, load `genesys-mcp-orchestrator` and follow its availability gate.

Checklist:
1. Extend `ENGINE.NodeMaterialAsset(Mesh*NodeMaterial)` with `@ENGINE.GameClass({ isNodeMaterialAsset: true, nodeMaterialDisplayName, nodeMaterialGroup })` (never `EngineClass`), importing `* as ENGINE from '@gnsx/genesys.js'`.
2. Authored fields with explicit `@ENGINE.property({ type, description, ... })` metadata and sensible defaults.
3. A defensive `rebuild()` that builds the TSL graph: `try/catch`, clamped loop-driving values, a safe fallback graph, `needsUpdate = true`.
4. `serialize` / `staticDeserialize`, `ENGINE.registerSpecialization(...)` in the same module, and disposal of owned GPU resources.
5. Import the module from game startup so decorators and registration run.
6. Build and register the class, then create a `.material.json` and assign it.

The mandatory practices (texture caching and disposal, failure containment, `rebuild()` after field changes, prefixed `toVar` names) and the full class pattern: [game-project-setup.md](references/game-project-setup.md).

## MCP workflow (connected editor)

Do not hand-write `.material.json`, and never grep or hand-edit `*.genesys-scene` while the editor is ready. Full sequence, efficiency rules and `createMaterial` arguments: [mcp-workflow](references/mcp-workflow.md).

1. **Build**, as a direct tool call, never in the same `run_script` as scene or asset edits: `pnpm lint && pnpm build` → `action_build(action="buildProject")` → `query_editor(operation="getNodeMaterialClasses", filter="YourMaterialClass")`. Use `getNodeMaterialClasses`, not `getRegisteredClasses`.
2. **Create and assign** in one apply `run_script` with `approval.operations` `["action_asset.createMaterial", "action_node.setProperties", "action_scene.save"]`: `genesys.actionAsset({ action: "createMaterial", materialClassName: "GAME.YourMaterialClass", name: "M_YourMaterial", parentPath: "assets/materials" })` (a hidden compact operation, so only through `run_script`), then set the mesh's `material` property (not `materialPath`) to `@project/assets/materials/M_YourMaterial.material.json`, then save.
3. **Re-query**: `query_asset(operation="find", assetType="material")` and the mesh's `material` via `getEditableProperties`.

## Editor fallback (MCP off)

1. `[Verify]` Run `pnpm lint` and `pnpm build` so the class registers.
2. Asset Browser → New → Material.
3. Pick the material's `nodeMaterialDisplayName` under its `nodeMaterialGroup` (shipped FX classes are under **TSL Node FX**, plain kinds under **TSL Node (THREE)**).
4. Enter a name, choose `assets/materials/`, click Create Material.
5. Assign `@project/assets/materials/<Name>.material.json` on the target `MeshNode` material property.
6. Save the scene; reopen and confirm authored fields round-trip.

## Limitations

- Node materials render wrong or not at all with WebXR on, or with `rendererType: "webgl"` → those paths use three's classic `WebGLRenderer` (`.engine/src/render/Renderer.ts`), which does not compile TSL node graphs → keep standard materials for XR builds (verify in Play on first use). The default renderer (`auto` → WebGPU, with its own WebGL2 fallback) runs them.

## Traps

- A custom class was written for a rim glow, dissolve, toon or glass look → a shipped class already does it → `createMaterial` with the shipped class (*Decide*).
- Changed a field in code and nothing changed on screen → the TSL graph is built in `rebuild()` → call `rebuild()` after setting fields.
- The "death dissolve" never finishes, it loops → `DissolveNodeMaterialAsset` has `loop` on by default, so its threshold follows `time` → set `loop: false`, then call `setProgress(t)` each frame with `t` going from 0 (solid) to 1 (gone).
- A material set on a node is gone after reopening → the scene was not saved → `action_scene(action="save")`, re-query (`genesys-mcp-orchestrator`). A material sent as an object instead of a `.material.json` path is refused by `setProperties` and ignored, with a warning, by `MeshNode.material`.
- The class is missing from New Material → the build did not run since the file was added, or the file sits outside `src/` (or in an excluded folder) → `action_build(buildProject)`, which imports every `src/**/*.ts`, then check `getNodeMaterialClasses`.
- Authored values reset on load → no specialization, or `staticDeserialize` does not call `loadAuthoredFields` before `rebuild()` → follow [game-project-setup.md](references/game-project-setup.md).
- A hitch the first time an effect appears → its node material compiles on first draw → warm it up on the title (`genesys-profiler`).
- Every spawned enemy has its own material → `new …MaterialAsset()` per spawn → one shared instance (the snippet above); a per-instance flash is `genesys-game-feel`.

## Done

- `query_editor(getNodeMaterialClasses)` lists the class (custom classes), or the shipped class was used.
- `query_asset(find, assetType="material")` lists the `.material.json`; the mesh's `material` property is that path after `action_scene(action="save")` and a re-query.
- In Play the effect is visible on the intended mesh, animates if it should, and the console has no shader or `rebuild` errors.
- Spawned objects share one material instance.

## References

- [references/shipped-classes.md](references/shipped-classes.md) — every shipped class with its authored fields and defaults
- [references/mcp-workflow.md](references/mcp-workflow.md) — build, create and assign sequence, efficiency rules, `createMaterial` arguments
- [references/game-project-setup.md](references/game-project-setup.md) — work tags, conventions, mandatory practices, full custom class pattern, specialization, deserialize order, validation checklist
- [references/background.md](references/background.md) — why node material assets exist, class vs asset, authoring vs runtime
