---
name: webgpu-tsl-node-material-assets
description: Build custom WebGPU TSL NodeMaterialAsset classes in a Genesys game project, register them in the editor, create `.material.json` assets via MCP or the New Material dialog, and assign materials to meshes. Use when implementing TSL shaders, game-side node materials, material save/load, NewMaterialDialog integration, or mesh material assignment.
---

# WebGPU TSL Node Material Assets

Use this skill when a game project needs custom WebGPU TSL material shaders that:
- can be assigned to mesh components at runtime,
- appear in the editor's New Material flow,
- expose authored fields in the property editor, and
- round-trip safely through scene/material serialization.

A **TypeScript material class** and a saved **`.material.json` asset** are different things. Define the reusable class in code, build/register it, then create a project material asset from that class in the editor (MCP or manual).

## Use This Flow

Tag work by owner:

| Tag | When |
| --- | --- |
| `[Code]` | Define or update `@ENGINE.GameClass({ isNodeMaterialAsset: true, ... })` material class |
| `[Verify]` | Lint/build the game project; confirm class registration |
| `[MCP]` | Create `.material.json`, assign `material`, save scene |
| `[Manual]` | MCP unavailable — use Asset Browser → New → Material |

**Never edit `auto-imports.ts` manually.** Classes with `@ENGINE.GameClass()` are discovered by the build pipeline.

Before the first Genesys MCP call in a task, read [genesys-mcp-orchestrator/SKILL.md](../genesys-mcp-orchestrator/SKILL.md) and follow its availability gate.

## Required Conventions

- Import engine APIs as `import * as ENGINE from '@gnsx/genesys.js';`
- Use `@ENGINE.GameClass(...)` for game-defined asset classes (never `EngineClass` in game code).
- Mark authored fields with `@ENGINE.property({ type, description, ... })`.
- Build the TSL shader node graph in a dedicated `rebuild()` method.
- Colocate `ENGINE.registerSpecialization(...)` in the same module as the class.

## Implementation Checklist

1. Create a class extending `ENGINE.NodeMaterialAsset(Mesh*NodeMaterial)`.
2. Add `@ENGINE.GameClass({ isNodeMaterialAsset: true, nodeMaterialDisplayName, nodeMaterialGroup })`.
3. Add authored fields with explicit `@ENGINE.property` metadata and sensible defaults.
4. Implement defensive `rebuild()` with `try/catch`, clamped values, and safe fallback graph.
5. Implement `serialize` / `staticDeserialize`, register specialization, and dispose owned GPU resources.
6. Ensure the module is imported from game startup so decorators and registration run.
7. Build/register the class, then create a `.material.json` asset and assign it where needed.

## Best Practices (Mandatory)

- **Texture ownership:** Cache owned textures on the instance; reuse when URL is unchanged.
- **Disposal:** Dispose owned textures when replaced or in `dispose()`; never leak rebuild-allocated textures.
- **Failure containment:** On `rebuild()` failure, assign a safe fallback graph and set `needsUpdate = true`.
- **Property changes:** After runtime/editor mutations to authored fields, call `rebuild()` and set `needsUpdate = true`.
- **Loop safety:** Clamp/sanitize loop-driving values before feeding TSL logic.
- **TSL naming:** Use prefixed `toVar('prefixName')` names; avoid shadowing authored property names.

## MCP Workflow (Connected Editor)

Do not hand-write `.material.json`. Do not batch `action_build` with scene/asset mutations in one `run_script`.

**Step 1 — build (direct tool, separate from scene edits):**

```text
[Code] edit material class in src/
→ pnpm lint && pnpm build   (when MCP off)
→ action_build(action="buildProject")   (direct compact tool when MCP on — registers auto-imports + .dist/game.js)
→ query_editor(operation="getNodeMaterialClasses", filter="YourMaterialClass")
```

**Step 2 — create asset + assign (one apply script):**

```text
run_script(mode="apply", groupUndo=true, approval={ operations: ["action_asset.createMaterial", "action_component.setProperties", "action_scene.save"] }, code=...)
  → genesys.queryEditor({ operation: "getState" })
  → genesys.actionAsset({ action: "createMaterial", materialClassName: "GAME.YourMaterialClass", name: "M_YourMaterial", parentPath: "assets/materials" })
  → genesys.actionComponent({ action: "setProperties", actorId: …, properties: { material: "@project/assets/materials/M_YourMaterial.material.json" } })
  → genesys.actionScene({ action: "save" })
  → return { materialAssetPath: "@project/assets/materials/M_YourMaterial.material.json", saved: true }
→ query_asset(operation="find", assetType="material", query="M_YourMaterial")
```

**Efficiency rules:**
- Call `action_build` as a **direct compact MCP tool** first; do not combine it with `createMaterial` / `setProperties` / `save` in the same `run_script`.
- If build must run inside `run_script`, include `action_build.buildProject` in `approval.operations`.
- `createMaterial` is a hidden compact `action_asset` operation — dispatch via `genesys.actionAsset(...)` inside `run_script`; skip `describe_tool` preamble.
- Use `query_editor(getNodeMaterialClasses)` to verify node material registration — **not** `getRegisteredClasses` (that lists actor/component classes only).
- On `MeshComponent`, the editable property is `material`, not `materialPath`.
- Do not append `select` / `frameSelection` unless the user asks.
- Do not grep or hand-edit `*.genesys-scene` when MCP reports `editorReady: true`.

**`createMaterial` arguments:**

| Field | Required | Notes |
| --- | --- | --- |
| `materialClassName` | Yes | Registry name, e.g. `GAME.PulseStripeNodeMaterialAsset` |
| `name` | Yes | Base file name without extension; `.material.json` is appended |
| `parentPath` | No | Defaults to `assets/materials` |

## Manual Editor Fallback (MCP Off)

1. `[Verify]` Run `pnpm lint` and `pnpm build` so the class registers.
2. Asset Browser → **New** → **Material**.
3. Pick the material's `nodeMaterialDisplayName` under its `nodeMaterialGroup`.
4. Enter a name, choose `assets/materials/`, click **Create Material**.
5. Assign `@project/assets/materials/<Name>.material.json` on the target mesh **material** property.
6. Save the scene; reopen and confirm authored fields round-trip.

## Reference

- [references/game-project-setup.md](references/game-project-setup.md) — full class pattern and validation checklist
- [README.md](README.md) — background on NodeMaterialAsset design
