---
name: genesys-editor-manual
description: Explain how to perform Genesys editor tasks manually in the UI (menus, outliner, dialogs, hotkeys) and when to prefer Genesys MCP instead. Use when the user asks where a button is, how to do something in the editor by hand, or whether an action is available via MCP.
---

# Genesys Editor Manual

Use when the user asks **where a control is**, **how to do X in the editor UI**, or **whether MCP can do it**.

For live mutations via tools, prefer [genesys-mcp-orchestrator](../genesys-mcp-orchestrator/SKILL.md) when MCP is Connected or Probe-capable.

## Load only what you need

Do **not** read every reference up front. Open the smallest file that answers the question:

| Question about… | Read |
| --- | --- |
| MCP vs UI / is there a tool? | [mcp-vs-ui.md](references/mcp-vs-ui.md) |
| Getting Started, Environment Setup, AI/MCP settings, Project Recovery, Play Local | [app-setup-and-recovery.md](references/app-setup-and-recovery.md) |
| Title-bar Menu, Tools, Play, Build, Upload, Help | [menus-and-play.md](references/menus-and-play.md) |
| Outliner, Inspector, Focus, copy/paste properties, components, prefab chrome | [outliner-and-inspector.md](references/outliner-and-inspector.md) |
| Viewport gizmos/view/snap, Asset Browser, specialised dialogs | [viewport-and-assets.md](references/viewport-and-assets.md) |
| Exact hotkey | [hotkeys.md](references/hotkeys.md) |

## Decision table

| User need | Prefer |
| --- | --- |
| Mutate scene while MCP ready | MCP (`genesys-mcp-orchestrator`) |
| “Where is the button?” / teach UI | This skill (correct reference above) |
| MCP Off | UI path + code/filesystem tools — do not invent MCP tools |
| Runtime gameplay | Engine/code skills — not editor UI |

## Critical semantics

- **Editor hide (eye / H)** and **editor lock (L)** are **viewport/outliner only** — not runtime visibility/selectability.
- Class registration: MCP `action_build(action="buildProject")` or Menu → **Build Project** — no separate `compile` MCP action.
- Animation / VFX / Skeleton / Foundry (Scenario) / project open-create / catalog asset-pack browse-install / Getting Started / Environment Setup / Project Recovery are **UI only** unless listed in mcp-vs-ui.
- Genesys MCP for external IDEs is configured **once per Sandbox Studio environment** (not per game project). See [app-setup-and-recovery.md](references/app-setup-and-recovery.md).

## Maintenance

Shipped under `.agents/skills/genesys/`; overwritten on SDK project update. When MCP ops or UI labels change, update `references/mcp-vs-ui.md` and the matching area file in the same change (genesys-mcp-developer checklist).
