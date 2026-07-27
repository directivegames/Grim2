---
name: list-assets
description: Search and list project assets by type. Use when you need to find available assets (models, textures, audio, prefabs, etc.) in the project.
metadata:
    version: 1.0.0
---

# List Assets

Use the `eval-world` skill to query the editor's asset registry.

## Asset Types

Valid types: `model`, `texture`, `hdri`, `video`, `audio`, `json`, `scene`, `prefab`, `material`, `resource`, `sourcecode`, `jsclass`, `mesh-combination`, `lightmap`, `navmesh`, `vfx`, `animconfig`, `skeletonprofile`

## How to Use

Call `editor.listAssets(type)` via the eval-world script runner:

```
pnpm exec tsx .agents/skills/eval-world/scripts/eval-world.ts "return editor.listAssets('<type>')"
```

**Examples:**
```
pnpm exec tsx .agents/skills/eval-world/scripts/eval-world.ts "return editor.listAssets('model')"
pnpm exec tsx .agents/skills/eval-world/scripts/eval-world.ts "return editor.listAssets('audio')"
pnpm exec tsx .agents/skills/eval-world/scripts/eval-world.ts "return editor.listAssets('prefab')"
```

To filter by name, chain a `.filter()` after the call:
```
pnpm exec tsx .agents/skills/eval-world/scripts/eval-world.ts "return editor.listAssets('model').filter(p => p.includes('tree'))"
```

## Result

Returns a JSON array of asset path strings for the given type.
