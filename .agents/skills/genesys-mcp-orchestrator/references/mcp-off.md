# MCP-off playbook

Open this when every configured Genesys channel failed the channel probe in [SKILL.md](../SKILL.md#channel-probe), or the user turned MCP off.

Never stall a whole build on MCP. Carry on with work that doesn't touch the editor, queue the editor changes, and probe again.

| Proceeds without MCP | Waits for MCP |
|---|---|
| TypeScript (classes, GameMode, UI, smoke node), `pnpm lint` + `pnpm build` | Node placement, transforms, materials, lights, prefab instances |
| Code models, Blender models, synthesised audio | `action_build(buildProject)` and the bundle proof |
| Layout files (`genesys-level-authoring` bulk layout), prefab plans | Play, the smoke test, captures, `getConsole` |
| `GAME.md` (Assets table, Now, decisions), `TECH.md` (`genesys-tech-design`) | Asset moves that must rewrite references (`action_asset.move`) |

- Write the pending editor work as a numbered list in `GAME.md` → Now, tagged `[MCP]`, so it runs in one pass when MCP returns.
- Re-probe every channel at the start of each new user turn, and once more before the final report of a long build. Do not re-probe in between, and never retry MCP through the shell.
- Report plainly: what is built, what is queued for MCP, and the one action that unblocks it (launch Sandbox Studio, enable MCP, open the project). Include `blockingReasons` when available.
- Do not read `*.genesys-scene`, and do not glob/grep node display names or `@scene/…`, unless the user asks or MCP is genuinely unavailable.
- A failed default channel is never a reason to spawn the play space, a layout, or a material change from `beginPlay`. Report the blocker and keep scene work pending.

## Connection errors

- `app_offline` → tell the user to launch Sandbox Studio.
- `app_restarting` → retry once after a short wait. Do not ask the user to reload MCP solely because Sandbox Studio restarted (a reconnect proxy keeps the URL alive).
- `unauthorized` → re-run Configure, or copy current connection details from Sandbox Studio Genesys AI Settings → MCP.
- `project_none` → ask the user to open a project.

## Localhost rule vs the capture receiver

The rule in `.cursor/rules/genesys-mcp.mdc` against shell calls covers the MCP endpoints (`/mcp`, `/scenario/mcp`). It does not forbid the in-Play capture receiver on `127.0.0.1` that `genesys-verification` runs; that is a local file sink, not MCP. With MCP off and Play already running, the Play listener in `AGENTS.md` (`.genesys/play-server.json`) can still capture frames.
