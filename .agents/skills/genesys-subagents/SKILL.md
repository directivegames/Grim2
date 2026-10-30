---
name: genesys-subagents
description: "Delegate parallel work to subagents: when to split, which model tier, brief contents (skills to read, owned files, done condition), what the parent keeps (editor edits, boot, builds, paid generation), checking results, and the fresh critic. Use for parallel, delegate, subagent, Task, worker, critic, cheaper model. Not for writing TECH.md or work packages (genesys-tech-design)."
metadata:
  tokens: 2582
---

# Genesys Subagents

Genesys in skills and code is Sandbox Studio in the product UI. Subagents are isolated workers with their own context. The parent plans, delegates, owns the editor and the boot path, and verifies. Workers do bounded jobs on disjoint files and report back.

## Use another skill when
- Making any editor or scene change → `genesys-mcp-orchestrator` (always in the parent)
- Planning a whole game and its milestones → `genesys-game-director`
- Splitting code into modules, contracts and work-package briefs → `genesys-tech-design`
- GameMode, boot path, `buildProject`, bundle proof → `genesys-game-boot` (always in the parent)
- Paid generation and its approval → `genesys-generated-assets`
- Which assets exist and their routes → `genesys-assets`
- Checking a worker's result in Play → `genesys-verification`

## Tools by agent

| Agent | Delegation tool | Parallel form |
|-------|-----------------|---------------|
| Cursor | `Task` | Several `Task` calls in one turn |
| Claude Code | `Agent` (older builds: `Task`) | Several calls in one turn |
| Sandbox Studio | `subagent` | `{ tasks: [{ label?, task, model? }, ...] }` or single `{ task, label?, model? }` |

Check the tool's own description in your tool list for current limits. In Sandbox Studio the tool accepts a capped number of tasks per call, runs only a few at once, and truncates very long worker output. Split bigger batches into waves.

**Model per worker.** In Claude Code, give each worker the cheapest tier that can meet its done condition without making a design decision (tiers table in `genesys-tech-design`). Claude Code's `Agent` takes a `model` (`opus`, `sonnet`, `haiku`). Where your tool has no model choice, the worker inherits yours; a cheaper run is then a handoff: the creator starts a session on the work-package file.

**Background, then integrate.** Launch workers in the background and keep building. Every worker is a bounded task you collect: wire and verify each batch before the next (`genesys-assets` → Batches). Never fire-and-forget a batch and move on.

In Sandbox Studio workers use the parent model unless `model` (`provider/model-id`) is set. Set it only when the user asks for a specific model. An unknown or unauthenticated model fails the whole call before any worker starts, and the error lists the models that work.

## When to delegate

Delegate when the work splits into independent pieces that need no shared decisions:

- Investigating or editing several unrelated files or areas.
- Producing several independent assets: code models, synthesised audio, approved Scenario rows, and Blender folders when the creator asked for Blender ([blender-brief](references/blender-brief.md)).
  - A code-model worker owns one builder in `tools/models/<model>.ts`, plus its runtime class in `src/models/` when the model moves (`genesys-code-modeling`). Its done condition: `pnpm build` passes, and the builder exports its build function. The worker never runs the GLB export, because every export rewrites the shared palette and materials. The parent adds the `MODELS` entry, runs the export once for the batch, places the model and looks at it.
  - None of this work needs the editor, so it starts at minute one of a whole build.
- Implementing a code module against a `TECH.md` contract, once the walking skeleton builds: one worker per work package (`genesys-tech-design`).
- Authoring scene content as files: a layout JSON, a prefab, a VFX definition. The parent places it with one MCP call.
- Read-heavy research whose raw output would clutter the parent context.

Keep in the parent:

- A single small edit.
- Sequential steps where each depends on the previous result.
- Anything that changes the live editor.
- The boot path: `GameMode`, `main()`, pawn/controller factories, the screen state machine, and the game class.
- `action_build(buildProject)` and the `.dist/game.js` bundle proof.
- Paid-generation approval. A worker generates only rows the parent already marked as approved spend. New wants come back as proposals.
- Shared netcode decisions in a multiplayer game.

## Writing a brief

For a Blender asset batch, start from the tested template: [blender-brief](references/blender-brief.md). For a code module, the brief is its work-package file (`design/tasks/WPnn-<name>.md`, template in `genesys-tech-design`): send "Implement `<path>`" plus the project root, and nothing the file does not already say. For the critic, use [critic-brief](references/critic-brief.md).

The worker sees only the brief, not the conversation. Each brief is self-contained:

1. **Goal**, in one or two sentences.
2. **Skill files to read** — name each skill the worker must open before it starts (for example `genesys-ui` for a HUD widget file, `genesys-vfx` for an effect definition). Give the path to each `SKILL.md`.
3. **Exact file paths** to read and to write.
4. **Constraints** — conventions to follow, files not to touch, no editor mutations, no `buildProject`, no unapproved paid generation, no further subagents. Workers never edit `src/contracts.ts`, add `GAME.md` Assets rows, or change `asset.json` expectations: they stop and report what they need.
5. **Decisions already made** — the engine classes, numbers and look the worker must use. A brief that leaves a design choice open gets a guess.
6. **Done condition** — one observable check the parent can confirm without trusting the worker's word: "`pnpm lint` passes and `src/ui/hud.ts` exports `HudController`", "three PNGs exist under `assets/ui/` at 1024×1024". It checks the result in the game (it exists, stays under a limit, or holds up in Play), never a minimum quantity (`genesys-tech-design` → work-package rules).
7. **Keep list** — paste the `GAME.md` **Keep list** when the worker touches a module or asset it names.
8. **Expected output** — a concise summary of what changed, the done-condition result, and anything unresolved, including editor changes the parent must make. Numbers the parent needs (sizes, socket heights, ids) go into a file the parent reads (`asset.json`, a JSON sidecar, `src/const.ts`), not only into prose.

Parallel workers write to disjoint files. Never ask two workers to edit the same file.

## Tools workers use

- Workers read and write files and run shell commands.
- Sandbox Studio workers can also read editor state with read-only `query_*` tools. Treat those as inspection only.
- Every `action_*`, `run_script`, and `batch_execute` call stays in the parent. This keeps approvals, undo grouping, and scene state under one agent. Cursor and Claude Code workers may technically see these tools; they must not use them.
- Only the parent starts workers; a worker never starts its own.

If a worker finds that an editor change is needed, it reports it and the parent applies it.

## After workers finish

Never relay a worker's claim as fact.

1. Read each result. A failed worker means retry with a sharper brief, or do the task inline.
2. Check the done condition yourself: read the files or diffs, and run the project's lint/typecheck when code changed.
3. Apply any editor changes from the parent through `genesys-mcp-orchestrator`.
4. Run `buildProject` and bundle proof from the parent when runtime classes changed (`genesys-game-boot`).
5. Record the result where a resumed session will find it: the Assets rows and **Verification evidence** in `GAME.md`, the package status and its `Verified:` line in `TECH.md` / the brief.
6. Report what was verified and what failed.

## Critic

On a whole build, as soon as the first passing run's captures exist, brief one fresh worker as a critic in the background, and keep working the remaining fix re-checks while it reads ([critic-brief](references/critic-brief.md)). It reads `BRIEF.md`, `GAME.md`, the in-Play captures in `.scratch/play/`, the model screenshots (and the Blender contact sheets when Blender is on) and the smoke log. It does not read your summary, and its brief tells it someone else built the game. It returns defects written as [defect codes](../genesys-verification/references/defect-codes.md), each with a weight (`breaks`, `noticed`, `polish`), its capture and the skill that fixes it; the biggest gap; a **Keep list** of what already works; and EXTRAS, features beyond the brief. Fix all the `breaks` and `noticed` defects in one batch, then run exactly one full smoke re-run (`genesys-verification` → *Budget*). Merge the Keep list into `GAME.md`, and ask the creator about EXTRAS once. Run a second round with a new critic only if the first found a `breaks` defect. A critic never edits files, never runs paid generation, and never bypasses an approval.

## Traps

- Two workers edit the same file → one overwrites the other → assign disjoint file sets.
- A worker calls `action_node` or `run_script(apply)` → approvals and undo split across agents → keep mutations in the parent; the worker reports what to change.
- A worker writes the GameMode or runs `buildProject` → the boot path drifts from the parent's plan → the parent owns boot and bundle proof.
- A worker starts a paid generation that was not approved → credits spent without consent → brief lists only approved rows.
- Brief says "build the HUD" with no skill named and no check → the worker reinvents widgets and reports "done" unverified → name the skill file and an observable done condition.
- The parent repeats "worker says it works" → unverified claim → check the done condition before reporting.
- A worker loosens its own gate (edits `asset.json` limits, a contract, a smoke assertion) to pass → the check proves nothing → the parent owns gates; a worker reports the need.
- A done condition sets a minimum quantity ("at least 60 HUD items", "≥ 400 props", "≥ 5k triangles") → the worker pads the number to pass and the game gets worse → check that it exists, stays under a limit, or works in Play.
- A fix round breaks something the critic said already worked → the brief never mentioned it → paste the `GAME.md` **Keep list** into briefs that touch those files.
- A brief leaves "which engine class" or "what size" open → the worker invents one → put the decision in the brief (`genesys-tech-design`).
- Worker results live only in chat → a compaction loses them → record them in `GAME.md` / `TECH.md` as you verify.

## Done
- Every brief named its skill files, file paths, the decisions already made, and an observable done condition.
- Each done condition was checked by the parent, not taken from the worker's report.
- All editor mutations, `buildProject`, and generation approvals happened in the parent.

## References
- [blender-brief](references/blender-brief.md) — tested brief for a parallel Blender asset batch
- [critic-brief](references/critic-brief.md) — brief for the fresh critic on a whole build
