# Installed asset packs

## Layout

Source: an installed pack's `config.json`; layout rules from `asset-pack-authoring`
```
packs/<id>/
  config.json   — "type": "asset-pack", "id", "name", "description", "version", "tags", "contents"
  src/          — pack classes (TypeScript import alias @packs/<id>/...)
  assets/       — models, materials, textures, prefabs
```

- Runtime asset URL: `@project/packs/<id>/assets/...`. `@packs/<id>/...` is a TypeScript import alias only (`asset-pack-authoring`).
- `<id>` is the folder name. Read it from disk; do not derive it from the display name.
- A pack may have been catalogued: then it has an `ASSETS.md` index (at the pack root or in an assets folder) and a card `<Name>.md` beside each GLB, and search prints `card:` lines for it. If so, read the index's *Pack notes* before placing anything from it; they record the pack's real scale and which way its fronts face, which may not be 1 m = 1 m or −Z. Then read only the cards of the pieces you pick (`genesys-assets` → routes → Asset cards). No index: measure and look as for any model.
- `query_asset(find)` indexes `assets/` and installed packs. Place pack models as `ENGINE.ModelMeshNode` and pack prefabs with `action_prefab.instantiate` (`genesys-prefabs`).
- Catalog packs install through the editor UI (Browse Asset Packs). `action_asset(installAssetPack)` only scaffolds an empty `packs/<name>/`.

## Broken material paths

A pack can reference textures that do not exist. Observed in an installed builder pack (folder `core-builder-pack`):

| Path in the pack's `.material.json` | Problem |
|---|---|
| `@project/packs/core_builder_pack/assets/textures/T_Grid_10x10_Grey.png` | Wrong id: underscores instead of the folder's hyphens |
| `@project/assets/textures/T_GridGrunge01_R.jpg` | Points at the game's `assets/`, not the pack's `assets/` |

The same wrong id was hardcoded as a default in the pack's TypeScript material class.

### Detect

1. After placing pack content, read the editor or Play console. `Failed to load texture` names the bad URL.
2. Before placing, list the texture URLs a pack's materials use (read-only):
   `grep -rhoE '@(project|engine)/[^"]+\.(png|jpg|jpeg|webp|ktx2|hdr)' packs/<id>/assets/materials | sort -u`
3. For each URL, check the file exists. `@project/packs/<id>/...` maps to `packs/<id>/...`; `@project/assets/...` maps to the game's `assets/...`; the `<id>` must equal the folder name.

### Fix

Pick the first that works and report the pack defect to the user:

1. **Assign a working material** to the placed node with MCP (`action_node.setProperties`, `material`), for example the engine grid materials `@engine/assets/materials/M_Floor.material.json` / `M_Wall.material.json`, another pack material whose paths resolve, or a project material.
2. **Make a project material** with `action_asset.createMaterial` (for example `materialClassName: "ENGINE.MeshStandardNodeMaterialAsset"`, `parentPath: "assets/materials"`), set its texture fields to the pack's real `@project/packs/<id>/assets/textures/...` files in the editor's material properties, and assign it. Do not hand-write `.material.json`.
3. **Leave the pack's own files alone.** The pack is installed content; a reinstall or update overwrites edits. A pack fix belongs to the pack author or a deliberate `asset-pack-authoring` task the user asked for.

Never "fix" a path by guessing a pack id. Never copy pack textures into `assets/textures/` just to satisfy a wrong path; that hides the defect and duplicates files.

The space is not done while any `Failed to load texture` line remains.
