# Asset paths

Every asset reference in game code, prefabs, and scene data is a logical path with an `@engine` or `@project` prefix. The editor, the build, and publishing resolve these. A path built at runtime cannot be tracked by those tools.

## Engine assets

- Files live in `node_modules/@gnsx/genesys.js/assets`.
- Replace the `node_modules/@gnsx/genesys.js` prefix with `@engine`.
- Example: `node_modules/@gnsx/genesys.js/assets/models/SM_Cube.glb` → `@engine/assets/models/SM_Cube.glb`.

## Project assets

- Files live in `/assets` at the project root.
- Use the full path with the `@project/assets/` prefix, never a relative path.
- Example: `/assets/models/tiger.glb` → `@project/assets/models/tiger.glb`.
- Write each path as a literal. Never construct a project path programmatically (`'@project/assets/' + name`). Publishing and the asset compiler only see literal references.

Before writing a path, list the folder and confirm the file exists. A path to a missing file shows as `Failed to load texture` (or model) in the console.

## Loading textures at runtime

Source: .engine/src/utils/ResourceManager.ts (`loadTexture(path: AssetPath)`), .engine/src/storage/storageProvider.ts (`AssetPath.fromString`)
```typescript
const texture = await ENGINE.resourceManager.loadTexture(
  ENGINE.AssetPath.fromString('@project/assets/textures/floor.png'),
);
```

- Keep the logical `.png` / `.jpg` name even when the asset compiler bakes to `.ktx2`. The resource manager picks the baked file.
- Do not resolve a path and hand it to `THREE.TextureLoader`. After baking the file is `.ktx2`, which `TextureLoader` cannot read.
- `THREE.TextureLoader` is only for external URLs.

## Asset paths inside raw HTML

The browser cannot resolve `@engine` / `@project` in HTML. Resolve developer-authored markup first.

Source: .engine/src/storage/projectContext.ts (`resolveAssetPathsInText`)
```typescript
const html = '<img src="@engine/assets/textures/Checkerboard.png">';
const resolved = await ENGINE.resolveAssetPathsInText(html);
```

- Use `resolveAssetPathsInText` only for HTML strings. Never for textures, models, or sound.
- Never put player or network strings into that HTML (Safe UI, see `genesys-ui`).
- Mount HTML UI under `world.gameContainer` (`genesys-ui`).

## Class names in prefab and serialized data

- Engine classes: `ENGINE.{ClassName}` (`ENGINE.SceneNode`, `ENGINE.MeshNode`).
- Game classes: `GAME.{ClassName}` (`GAME.Enemy`, `GAME.PickupRoot`).
- Prefabs are `*.prefab.json` files under `/assets` (usually `/assets/prefabs`). Create, place, and edit them through MCP (`genesys-prefabs`); do not hand-edit the JSON.

## Choosing assets

Check `@engine/assets` and `@project/assets` for a fitting model, texture, or sound before generating or using a primitive. When nothing fits, `genesys-generated-assets` makes one. Build-time compression and exclude rules belong to `genesys-asset-compiler`.
