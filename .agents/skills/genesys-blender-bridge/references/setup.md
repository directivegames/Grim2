# Setup

## Default transport (add-on-free)

Use Blender's CLI through `scripts/bridge.sh`. No Blender add-on is required
for `sync-from-genesys` / `diff` / `validate` / `test`.

Requirements:

- Blender 4.2 or newer with `bpy` and glTF import enabled. `bridge.sh` finds it via `$BLENDER`, then
  `/Applications/Blender.app`, then `blender` on PATH; exit 3 means not found.
- `python3` for `make_bridge_scripts.py` and `merge_manifest_chunks.py` (plain
  standard library; no Blender needed).
- `node` and the project's `node_modules` (three, `@gltf-transform`,
  meshoptimizer, sharp) for converting engine GLBs through
  `genesys-blender-modeling/scripts/plain-glb.mjs`, and for `bridge.sh test`.
  The `genesys-blender-modeling` skill must sit beside this one.
- Project root containing `package.json`, `assets/` and
  `node_modules/@gnsx/genesys.js/`.
- Genesys MCP connected for extraction and push (Sandbox Studio open).

Always pass absolute or project-root-relative paths into Blender. Do not
assume the shell cwd is the game project (Sandbox Studio may own the process
cwd); `cd` to the project root or use absolute paths.

Readiness test:

```bash
bash .agents/skills/genesys-blender-bridge/scripts/bridge.sh test
```

It needs no editor. All `PASS` lines and `ALL PASS` mean Blender, node, three
and the transform math agree. Output goes to
`.scratch/blender-bridge/test/`.

Blender's exit status does not carry the script's result. `bridge.sh` and the
test read the `RESULT ok|fail` line (or the results file) instead; do the same
when calling `blender_bridge.py` directly.

## Optional live Blender MCP

Not needed. When the creator already has a Blender MCP connected, it can make
the layout edits in step 5 of the workflow (move, Alt+D duplicates, parent),
then save the file the diff reads. The bridge's own sync and diff still run
through `bridge.sh` for deterministic results. Installing a Blender add-on or
MCP server, or enabling a network listener, is the creator's decision: ask,
never install one yourself. Third-party Blender MCP add-ons typically listen on
loopback without authentication: keep them local-dev only and pin a reviewed
release rather than tracking a main branch.

## Genesys MCP

Follow `genesys-mcp-orchestrator`.

- Connected environment channel.
- `query_editor(getState)` → `editorReady: true`, correct `activeScenePath`.
- Stop play mode before extract/apply.

## Paths

`blender_bridge.py` resolves asset URLs for import only:

```text
@project/<path>   →  <project>/<path>        (assets/, packs/, any project folder)
@engine/<path>    →  <project>/node_modules/@gnsx/genesys.js/<path>
```

A path with `..` is refused. Never construct `@project` paths by string
concatenation in game code; the bridge is allowed to resolve them for import
only.
