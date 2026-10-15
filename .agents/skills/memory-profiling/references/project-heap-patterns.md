# Project heap patterns

Game-specific memory signatures live **in the project**, not in the skill template.
The analyzer loads them automatically when present.

## File location

Create this file in the **game project root** (version it with the game):

```text
.genesys/heap-patterns.json
```

Captures and reports default to `.genesys/captures/` (alongside this file under
`.genesys/`). Pattern rules stay in the project so each game owns its minified
names, asset paths, and subsystems.

`capture-heap.mjs` records `projectCwd` in each capture's `.meta.json`. When you
analyze a capture from another directory, the analyzer uses that path to find
`.genesys/heap-patterns.json`. Override with `--project-root=` or `--patterns=`.

Disable project rules with `--no-project-patterns`.

## Format

JSON array or an object with a `patterns` array:

```json
{
  "patterns": [
    {
      "id": "pinned-character-glb",
      "kind": "owner",
      "message": "Character GLTF still held on ResourceManager.cachedModels — check load/unload.",
      "minRetainedBytes": 2097152,
      "match": {
        "pathContains": "@project/assets/characters/"
      }
    },
    {
      "id": "my-subsystem",
      "kind": "owner",
      "message": "CustomSubsystem retained heap — see src/subsystems/my-subsystem.ts",
      "match": {
        "constructor": "MySubsystem"
      }
    }
  ]
}
```

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable id for compare reports and team discussion |
| `message` | yes | Plain-language explanation shown in section 0 |
| `kind` | no | `owner`, `runtime`, or `artifact` (default `owner`) |
| `minRetainedBytes` | no | Minimum retained size to report (default 512 KB) |
| `match` | yes | At least one matcher below |

### Matchers (use any combination; retained size is the max/sum logic below)

| Matcher | Matches against |
| --- | --- |
| `constructor` | Exact constructor name from report section 7 |
| `constructorRegex` | Regex on constructor names |
| `pathContains` | Substring on section 8 GC root paths (sums matching retainers) |
| `pathRegex` | Regex on GC root paths |
| `labelContains` | Substring on named retainer labels |
| `labelRegex` | Regex on named retainer labels |

Prefer stable asset path fragments (`@project/assets/...`) over minified class
names when you can.

## Copy-paste starter

See [heap-patterns.example.json](heap-patterns.example.json) in this folder —
copy it to **your project's** `.genesys/heap-patterns.json` and edit. The
example is documentation only; the analyzer never reads files under the skill
directory for project rules.

## Report output

Section **0** lists skill-wide hints (`[skill/…]`) and project rules
(`[project/…]`). Both are also in `.summary.json` under `patterns`, with a
`source` field and `projectPatternsFile` when loaded.
