# Setup

## Default transport (add-on-free)

Use Blender's CLI. No Blender add-on is required for
`sync-from-genesys` / `diff` / `validate`.

Requirements:

- Blender 4.2+ / 5.x with `bpy` and glTF import enabled.
- Project root containing `assets/` and `node_modules/@gnsx/genesys.js/`.
- Genesys MCP connected for extraction and push (Sandbox Studio open).

Always pass absolute or project-root-relative paths into Blender. Do not
assume the shell cwd is the game project (Sandbox Studio may own the process
cwd).

Readiness test:

```bash
blender --background --python .agents/skills/genesys-blender-bridge/scripts/blender_bridge.py -- --help
```

## Optional live Blender MCP

Repository: https://github.com/harveyxiacn/blender-mcp

Only install when the user explicitly wants an interactive live bridge. The
MCP server's Blender side **does** require its own add-on. Security notes:

- loopback only;
- no protocol authentication — treat as local-dev;
- select and pin a currently reviewed release rather than tracking `main`;
- still prefer running `blender_bridge.py` for deterministic scene sync and
  change detection even if MCP is installed.

Approval boundary: ask before installing any Blender add-on or enabling network
listeners. Never install silently.

## Genesys MCP

Follow [genesys-mcp-orchestrator](../../genesys-mcp-orchestrator/SKILL.md).

- Connected environment channel in the IDE.
- `query_editor(getState)` → `editorReady: true`, correct `activeScenePath`.
- Stop play mode before extract/apply.

## Paths

Resolve assets inside `blender_bridge.py`:

```text
@project/assets/...  →  <project>/assets/...
@engine/assets/...   →  <project>/node_modules/@gnsx/genesys.js/assets/...
```

Never construct `@project` paths by string concatenation in game code; the
bridge is allowed to resolve them for import only.
