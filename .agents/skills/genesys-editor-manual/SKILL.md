---
name: genesys-editor-manual
description: "How to do Genesys (Sandbox Studio) editor tasks by hand: menus, Outliner, Inspector, Asset Browser, Store Manager, hotkeys, Play and Exit, and when MCP is better. Use when the user asks where a button is, what a hotkey does, how to exit Play, or how to do something in the editor UI. Not for making scene changes while MCP is ready (use `genesys-mcp-orchestrator`)."
metadata:
  tokens: 1691
---

# Genesys Editor Manual

Genesys in skills and code is Sandbox Studio in the product UI. This skill answers "where is it / how do I do it by hand / can MCP do it?". When MCP is ready and the user wants the change made, make it through `genesys-mcp-orchestrator` instead of describing clicks.

## Use another skill when
- MCP is Connected or Probe-capable and the user wants the scene changed → `genesys-mcp-orchestrator`
- Where a mesh, image, texture, skybox, or sound comes from → `genesys-assets`
- Runtime gameplay code (nodes, pawns, input) → `genesys-engine`
- Build order and Play bundle proof → `genesys-game-boot`
- Poly Builder via MCP → `genesys-polybuilder`
- Prefab workflow decisions → `genesys-prefabs`
- Profiler reports and traces → `genesys-profiler`
- Asset compression settings in Project Settings → `genesys-asset-compiler`
- Store items, pricing, publishing → `monetization-store-items`
- How a game handles Escape and pause → `genesys-game-boot`

## Load only what you need

Open the smallest file that answers the question. Do not read every reference up front.

| Question about… | Read |
| --- | --- |
| MCP vs UI / is there a tool? | [mcp-vs-ui.md](references/mcp-vs-ui.md) |
| Getting Started, Environment Setup, AI/MCP settings, Project Recovery | [app-setup-and-recovery.md](references/app-setup-and-recovery.md) |
| Title-bar Menu, Tools, Play, Build, Upload, Help, Profiler panel, NavMesh dialog | [menus-and-play.md](references/menus-and-play.md) |
| Outliner, Inspector, Focus, copy/paste properties, prefab chrome | [outliner-and-inspector.md](references/outliner-and-inspector.md) |
| Viewport gizmos/view/snap, Place bar, Asset Browser, specialised dialogs | [viewport-and-assets.md](references/viewport-and-assets.md) |
| Viewport Poly Builder (brush, mesh edit) | [viewport-and-assets.md](references/viewport-and-assets.md) (Poly Builder) |
| Editor viewport is slow or soft, Editor Pixel Ratio / Screen Percentage | [viewport-and-assets.md](references/viewport-and-assets.md) (Editor Pixel Ratio) |
| Exact hotkey | [hotkeys.md](references/hotkeys.md) |

## Decide

| User need | Prefer |
| --- | --- |
| Mutate the scene while MCP is ready | MCP (`genesys-mcp-orchestrator`) |
| "Where is the button?" / teach the UI | This skill, the matching reference above |
| MCP Off | UI path + code/filesystem tools. Do not invent MCP tools |
| Runtime gameplay | Engine/code skills, not editor UI |
| New art | `genesys-assets` (reuse, code, or Blender and Scenario on request), then place with MCP |

## Critical semantics

- Editor hide (eye / H) and editor lock (L) are viewport/Outliner only. They are not runtime visibility or selectability.
- Class registration is MCP `action_build(action="buildProject")` or Menu → Build Project (`Ctrl/Cmd+B`). There is no separate `compile` MCP action.
- `action_node` ops are only `add`, `delete`, `setProperties`, `select`. Transform, reparent, duplicate, hide/lock, reset-to-default, and node copy/paste are UI (transforms also via editable property paths in `setProperties`).
- UI only unless listed in [mcp-vs-ui.md](references/mcp-vs-ui.md): Animation / VFX / Skeleton editors, project open/create, catalog asset-pack browse/install, Getting Started, Environment Setup, Project Recovery, and interactive Poly Builder tools.
- New art goes through `genesys-assets` (reuse, code, or Blender and Scenario on request). The title-bar Foundry dialog is the editor's own manual generator; its prompt-enhance control is UI only. Describe Foundry only when the user asks about that dialog.
- Genesys MCP for external IDEs is configured once per Sandbox Studio environment (Dev / Staging / Live), not per game project. When several environments run, enable the matching server id (for example `sandbox-studio-genesys-dev`). See [app-setup-and-recovery.md](references/app-setup-and-recovery.md).
- **Exiting Play (canonical).** A consumed Escape stays in the game. Escape exits Play only when the game did not consume it and pointer lock is off. F8 always exits (the game never receives F8). The title-bar Exit Play Mode also works. Games pause on Escape and P ([hotkeys.md](references/hotkeys.md)).
- Store Manager (main menu) lists and edits the game's store items and links the project as a game on open. MCP equivalent: `query_store` / `action_store` (`monetization-store-items`).
- Version gate: Poly Builder, profiler, and Foundry tools and store `linkGame` over MCP need Sandbox Studio 18.1+. On an older app, give the UI path.
- Some UI strings still say "Actor" or "Component". MCP and engine types use `*Node`, and MCP params name node UUIDs `componentId` / `componentIds` / `parentComponentId`.

## Traps

- Telling the user to click through the Outliner while MCP is ready and they asked for the change → make it with MCP.
- Describing editor hide (H) as hiding the node in the game → it is editor-only; runtime visibility is a node property.
- Inventing `action_node` ops such as `move` or `duplicate` → only `add`, `delete`, `setProperties`, `select` exist.
- Sending a skybox, image, or mesh request to Foundry → use `genesys-assets`.
- Telling the user to reload MCP after Sandbox Studio restarted → the reconnect proxy keeps the URL alive.
- "Press Esc to leave Play" for a game that pauses on Escape → the game consumes it and Play stays. Say F8, or the title-bar Exit Play Mode.

## Done
- The answer names the exact menu path, panel control, or hotkey from the references, and whether MCP covers it.
- When MCP covers it and is ready, the change was made through `genesys-mcp-orchestrator` rather than described.

## References
- [mcp-vs-ui.md](references/mcp-vs-ui.md) — task-by-task MCP tool vs manual UI path
- [app-setup-and-recovery.md](references/app-setup-and-recovery.md) — Getting Started, Environment Setup, Genesys AI Settings, MCP configure, Project Recovery
- [menus-and-play.md](references/menus-and-play.md) — title-bar Menu, buttons, Play options, Profiler, NavMesh dialog
- [outliner-and-inspector.md](references/outliner-and-inspector.md) — Outliner search, context menu, Inspector, prefab chrome
- [viewport-and-assets.md](references/viewport-and-assets.md) — transform toolbar, Camera / View Mode / Show / Performance menus, Snap, Place bar, Poly Builder, Asset Browser, dialogs, status bar
- [hotkeys.md](references/hotkeys.md) — every hotkey (mirrors the in-app Hot Keys dialog; generated, keep in sync with the editor)
