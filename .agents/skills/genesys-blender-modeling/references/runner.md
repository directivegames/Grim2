# The runner: output lines, asset.json, environment

Open this when a run prints a line you don't recognise, when you need an `asset.json` field beyond `role` / `export` / `expect`, or when Blender itself fails.

## Commands

```bash
.agents/skills/genesys-blender-modeling/scripts/blender.sh build blender/chest [--look]   # one asset folder
.agents/skills/genesys-blender-modeling/scripts/blender.sh sheet @engine/assets/models/demo/SandboxAsset/Dungeon/SM_SB_Arch.glb   # contact sheet of any model
.agents/skills/genesys-blender-modeling/scripts/blender.sh preview <glb>   # Cycles preview, for baked assets
.agents/skills/genesys-blender-modeling/scripts/blender.sh prune            # dry run; --apply deletes
```

## Output lines

| Line | Meaning |
|---|---|
| `BLENDER <version>` | The Blender found (4.1 or newer) |
| `BUDGET <role> …` | The role's caps from `genesys-assets` → *Weight budgets*; `expect` cannot raise them |
| `NUMBERS …` | Objects, meshes, tris, materials, size (w h d in metres), bottom |
| `MARKERS …` | Exported marker names |
| `SHEET …` | Contact sheet: top-left front · top-right side · bottom-left top · bottom-right hero |
| `EXPORT …` | File, size against the role budget, and the `@project/...` path to use |
| `RESULT ok` / `FAIL …` | A failed expectation, budget or Python error renders a sheet of what was built and exports nothing; the file already in `assets/` is left as it was |
| `WARN` | Palette, a reused material name, glTF exporter warnings — read them |
| `NOTE` | Curves and text converted to meshes, or dropped |
| `EXPECT` | A gate changed, with its reason — report it |
| `RETRY` | Blender died without a result and ran once more |

`print()` in a step script shows only lines starting with `PRINT`.

## asset.json fields

```json
{
  "role": "prop",
  "export": "assets/models/props/SM_Chest.glb",
  "expect": { "size": [0.92, 0.72, 0.66], "tris": [150, 2500], "materials": 4,
              "markers": ["loot_spawn"], "bottom": 0, "tolerance": 0.15 },
  "still": { "out": "assets/ui/title.jpg", "width": 1920, "height": 1080, "camera": "title_cam",
             "transparent": false, "engine": "EEVEE" },
  "look": false,
  "rig": "mannequin",
  "why": "<reason a gate changed>"
}
```

- `role` is required: `hero`, `creature`, `prop`, `pickup`, `kit`, `building`, `scatter`, `title`, `icon`. It picks the row in `genesys-assets` → *Weight budgets* (tris, materials, file size). The runner enforces it on every build, whatever `expect` says.
- `size` is `[width X, height up, depth]` in glTF axes (0 skips an axis). `export` and `still` are both optional; a title folder has only `still` (role `title`), an icon folder role `icon`.
- The first build records `role` and `expect` in `.scratch/blender/state/<folder>.json`. A later change fails (`FAIL role/expect changed since the last build`) unless `asset.json` carries a new `"why"`; the run then prints `EXPECT changed …` for the parent to read.
- `look: true` is the same as `--look`. Tangents export automatically when a material uses a Normal Map node (a `gbake` bake); `"tangents": true` or `false` overrides that ([high-to-low-bake](high-to-low-bake.md)). `rig: "mannequin"` exports skinned and checks the rig ([rigged-characters](rigged-characters.md)).

## Parallel safety and environment

- Each run renders into its own temp folder under `.scratch/blender/tmp/` and renames finished files into place, so workers can build different folders at the same time.
- Each run stops after `BLENDER_TIMEOUT` seconds (default 300).
- `blender.sh` finds Blender via `$BLENDER`, then `PATH`, then the usual install folders. Blender found through a symlink is resolved to the real binary.
- The SDK-managed `.gitignore` ignores `.scratch/` and `art-source/`. In a project made before that, `blender.sh` prints the line to add.

## Environment traps

- `import_glb` of an engine model fails → `plain-glb.mjs` could not convert it; the error carries the converter's message → run from the project root so `node` and `node_modules` resolve.
- `RETRY` then `FAIL Blender exited twice without a RESULT line` → read the tail it prints (crash, missing Blender resources).
- `FAIL Blender ran longer than 300s` → too many booleans or a large bake; simplify, or raise `BLENDER_TIMEOUT`.
- Blender not found or older than 4.1 → set `BLENDER=/path/to/Blender`.
- `.scratch/blender` grows to hundreds of MB → `blender.sh prune`, then `prune --apply`.
