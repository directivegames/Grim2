# App Setup and Recovery

Desktop app flows that are not scene editing. All rows are **UI only** (no MCP tools).

## Getting Started Wizard

First launch walks through setup. Reopen anytime from **Menu → App Settings → Getting Started Wizard** (works on dashboard/home and in the editor).

| Step | When shown | What it does |
| --- | --- | --- |
| **AI Assistant** | Dev builds with Assistant allowed | Connect Cursor (recommended) or another model provider |
| **MCP** | Always | Optional: one-click **Configure** Cursor / Claude Code / VS Code / Codex for this Sandbox Studio environment |
| **Environment Check** | Always | Verify / install **Node.js 24** and **pnpm** |

Finish requires Environment Check ready. Skipping external MCP configure is fine if you only use the in-app Assistant.

## Environment Setup

When Node.js / pnpm is missing or outdated, **Environment Setup** opens (also embedded in the wizard’s Environment Check step).

| Path | Notes |
| --- | --- |
| Auto dialog | Triggered by the environment guard when tools are missing |
| Getting Started → Environment Check | Same install UI |
| Manual steps | Dialog can show **Manual Environment Setup** with copyable commands |

On Windows and macOS, one-click install is available; when possible the updated PATH applies without restarting the app.

## Genesys AI Settings

Open **Menu → App Settings → Genesys AI Settings** (dashboard/home or editor — no project required). Also from the Assistant panel menu when the panel is open.

| Area | Notes |
| --- | --- |
| **Providers** | Enable / reorder / manage Cursor, Codex, Copilot, Anthropic, Gemini, xAI, OpenRouter, DeepSeek, and more |
| **MCP** tab | Enable Genesys MCP, tool approval modes, **Configure** external IDEs, **Restart MCP Server**, copy channel / bearer details |
| Assist Action model | Optional separate model for Fix / Ask / Explain; default follows Default Agent Model |

**AI Assistant** toggle lives under **Menu → App Settings** (dev builds). Reset buttons restore defaults when a preference has changed.

## Genesys MCP (external IDEs)

Configure **once per Sandbox Studio environment** (Dev / Staging / Live), not per game project. Legacy per-project MCP entries are cleared on Configure.

| Action | Where |
| --- | --- |
| Enable / disable server | **App Settings → Genesys MCP** checkbox, or **Genesys AI Settings → MCP** |
| Configure Cursor / Claude / VS Code / Codex | Getting Started MCP step, or **Genesys AI Settings → MCP → Configure …** |
| Restart listener | **Genesys AI Settings → MCP → Restart MCP Server** |
| Copy connection details | **Genesys AI Settings → MCP** (channel / MCP server id, bearer, client config) |

MCP tools only work with a project open. Configure can still write global IDE settings while MCP is enabled. If Dev, Staging, and Live all run, enable the matching MCP server id in the IDE (for example `sandbox-studio-genesys-dev`).

## Project Recovery

When open/load fails, a recovery **dialog** appears on the current page (dashboard, home, or editor) — not a separate recovery route.

| Action | Notes |
| --- | --- |
| **Fix with AI** | Starts a Fix agent chat; retries opening when Fix finishes (needs Genesys AI connected) |
| **Retry** | Try opening again |
| **Open Project Folder** | Reveal project in OS file manager (desktop app) |
| **Open in Code Editor** | Open `{project}.code-workspace` |
| **Dismiss** | Close recovery without reopening |

Copyable error details are in the dialog for support. Menu stays usable during recovery so **Genesys AI Settings** remains reachable.

## Play Local Project *(dev SDK only)*

From the dashboard **Play Local Project** card (or Play Launcher): pick a local Genesys project folder, optionally build, and start the game without opening the full editor. Remembers last folder and **Build Project Before Playing**.
