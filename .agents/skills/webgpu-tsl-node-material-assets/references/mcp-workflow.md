# MCP workflow for node materials

The short version is in [SKILL.md → MCP workflow](../SKILL.md#mcp-workflow-connected-editor). This file holds the full build, create and assign sequence, the efficiency rules and the `createMaterial` arguments.

Do not hand-write `.material.json`. Do not batch `action_build` with scene or asset mutations in one `run_script`.

Step 1 — build (direct tool, separate from scene edits; canonical sequence in `genesys-game-boot`):

Source: MCP `action_build` / `query_editor` (`genesys-mcp-orchestrator`)
```text
[Code] edit material class in src/
→ pnpm lint && pnpm build
→ action_build(action="buildProject")   (direct compact tool — registers auto-imports + .dist/game.js)
→ query_editor(operation="getNodeMaterialClasses", filter="YourMaterialClass")
```

Step 2 — create asset + assign (one apply script):

Source: MCP `action_asset.createMaterial` (compact-hidden), `action_node`, `action_scene`
```text
run_script(mode="apply", groupUndo=true, approval={ operations: ["action_asset.createMaterial", "action_node.setProperties", "action_scene.save"] }, code=...)
  → genesys.queryEditor({ operation: "getState" })
  → genesys.actionAsset({ action: "createMaterial", materialClassName: "GAME.YourMaterialClass", name: "M_YourMaterial", parentPath: "assets/materials" })
  → genesys.actionNode({ action: "setProperties", componentId: …, properties: { material: "@project/assets/materials/M_YourMaterial.material.json" } })
  → genesys.actionScene({ action: "save" })
  → return { materialAssetPath: "@project/assets/materials/M_YourMaterial.material.json", saved: true }
→ query_asset(operation="find", assetType="material", query="M_YourMaterial")
→ query_node(operation="getEditableProperties") on the mesh: `material` is the path
```

Efficiency rules:
- Call `action_build` as a direct compact MCP tool first; do not combine it with `createMaterial` / `setProperties` / `save` in the same `run_script`.
- If build must run inside `run_script`, include `action_build.buildProject` in `approval.operations`.
- `createMaterial` is a hidden compact `action_asset` operation — dispatch via `genesys.actionAsset(...)` inside `run_script`.
- Use `query_editor(getNodeMaterialClasses)` to verify node material registration — not `getRegisteredClasses` (that lists placeable `ENGINE.*` / `GAME.*` types, not node-material asset classes).
- Assign the material on a `MeshNode` via the editable `material` property (not `materialPath`).
- Do not append `select` / `frameSelection` unless the user asks.
- Do not grep or hand-edit `*.genesys-scene` when MCP reports `editorReady: true`.

`createMaterial` arguments:

| Field | Required | Notes |
| --- | --- | --- |
| `materialClassName` | Yes | Registry name: `ENGINE.FresnelRimNodeMaterialAsset` for a shipped class, `GAME.PulseStripeNodeMaterialAsset` for yours |
| `name` | Yes | Base file name without extension; `.material.json` is appended |
| `parentPath` | No | Defaults to `assets/materials` |
