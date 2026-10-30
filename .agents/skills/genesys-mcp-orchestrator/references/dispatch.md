# Dispatch: limits, approvals, discovery

Open this before a large `run_script` / `batch_execute` (dozens of mutations or a long loop), when an approval is rejected, or when a tool seems to be missing.

## Cost and time

| Fact | Consequence |
|---|---|
| Each mutation (`add`, `setProperties`, `delete`) takes about 0.6 s in the editor, so a placed node (`add` + `setProperties`) costs about 1.2 s | A few hundred nodes take minutes. Rule-based placement goes through a layout file and one `instantiate` (`genesys-level-authoring` → *Bulk placement*). |
| `action_node.add` ignores `properties`; the new node has default values | Always follow `add` with `setProperties` on `affectedComponentIds[0]` |
| The MCP client can give up on a call after 60 s, even when `run_script` `timeoutMs` is higher. The script may stop part-way. | Keep each apply call under ~150 mutations. Make loops resumable: name nodes by their slot and skip names that already exist, then re-query counts before continuing. |
| The MCP client can give up at 60 s while the script keeps running; a world build inside a script returns `operation_still_running` after 50 s | Keep each script under about 45 s |
| `action_prefab.createFromNode` saves under `assets/` and ignores `directory` | Read the returned `prefabPath`; move it with `action_asset.move` if it must live elsewhere |

Every tool call is a model turn that re-reads the conversation, so merge steps whose inputs you already know into one script: survey, post-apply finds, look and material edits, audit. Return counts next to lists so an empty result shows as `0`, not as a silent miss.

## Hard limits

Sandbox Studio MCP constants:

| Limit | Value |
|---|---|
| `run_script` `code` | ≤ 100,000 characters; 256 MB heap; console log ≤ 100,000 bytes |
| `run_script` wall clock | default 300 s, max 900 s via `timeoutMs` (the client may still abort at 300 s, above) |
| `batch_execute` operations | 500 supported, 750 hard maximum after `foreach` expansion |
| `batch_execute` per-operation timeout | default 60 s, max 120 s; total response ≤ 1.5 MB, per operation ≤ 200 KB |

`run_script` runs in a worker with `setTimeout` but no `window` or `localStorage`; it reaches the editor only through `genesys.*`.

## Approvals

| Path | Approval |
|------|----------|
| Direct tools (`action_build`, `action_node`, `action_scene`, …) | Auto-mint per call in `auto` mode |
| `batch_execute(apply)` | Auto-derive scopes from `operations` when omitted |
| `run_script(apply)` | Pass `approval.operations` or rely on auto-derivation from `genesys.*` calls |

Use `genesys_request_approval` / `approvalId` only for prompt-mode pre-approval or token reuse. An explicit `approval.operations` list must name every scope the script calls, including the save: `["action_node.add", "action_node.setProperties", "action_scene.save"]`. A missing scope fails the script with "Add … to run_script approval.operations", and an omitted `action_scene.save` means nothing persists. Either list every scope or omit `operations` and let it derive.

`readOnly` scripts cannot call any `action_*` tool (including `actionBuild`). Use direct `dryRun: true` or `run_script(mode="dryRun")` for previews.

## Discovery

Before saying a capability is unavailable, do not stop at IDE tool-name search (catalog names and truncated descriptions miss router ops). Check, in order:

1. Known compact routers and their ops (`action_editor`, `action_node`, `action_scene`, `action_build`, `query_editor`, `query_node`, `query_project`, …). Call directly, or via `run_script` / `batch_execute`.
2. Genesys `search_tools(query=…)` (names, descriptions, and ops) or [workflows.md](workflows.md).
3. Known hidden tool → `run_script` (`genesys.*`) or `batch_execute` (`tool:`). See [compact-hidden-tools.md](compact-hidden-tools.md). Do not `describe_tool` first.
4. Use `search_tools` / `describe_tool` only for exploration, unknown tools, or after a schema/validation failure, never both for the same tool in one task.

Skip `select` / `focus` / `frameSelection` unless the user asks or the next step needs selection. For captures use `frameNodes` (no selection needed).

## Version gate

`action_polybuilder`, `query_polybuilder`, `action_profiler`, `query_profiler`, `action_asset_generation`, `query_asset_generation`, and `action_store(linkGame)` exist only in Sandbox Studio 18.1+. If `search_tools` does not find them, the app is older: say so in one line and use the UI route (`genesys-editor-manual`). Do not fall back to code or file edits for these.
