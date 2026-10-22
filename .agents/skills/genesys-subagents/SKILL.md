---
name: genesys-subagents
description: When and how to delegate work to subagents (the Task tool in Cursor, the subagent tool in Sandbox Studio) - parallel independent workstreams, writing briefs, keeping editor changes in the parent, verifying worker results. Use for subagent, parallel, delegate, or Task tool requests.
metadata:
  tokens: 683
---

# Genesys Subagents

Naming: Genesys in skills/docs/code = Sandbox Studio in the product UI.

Subagents are isolated workers with their own context. The parent agent plans, delegates, and verifies. Workers do bounded jobs and report back.

## Tools by agent

| Agent | Delegation tool | Parallel form |
|-------|-----------------|---------------|
| Cursor | `Task` | Several `Task` calls in one turn |
| Sandbox Studio | `subagent` | `{ tasks: [{ label?, task, model? }, ...] }` or single `{ task, label?, model? }` |

Check the tool's own description in your tool list for the current limits. In Sandbox Studio the tool accepts a capped number of tasks per call, runs only a few at once, and truncates very long worker output. Split bigger batches into waves. Workers cannot start their own subagents.

In Sandbox Studio workers use the parent model unless `model` (`provider/model-id`) is set. Set it only when the user asks for a specific model. An unknown or unauthenticated model fails the whole call before any worker starts, and the error lists the models that work.

## When to delegate

Delegate when the work splits into independent pieces that need no shared decisions:

- Investigating or editing several unrelated files or areas.
- Producing several independent assets or documents.
- Read-heavy research whose raw output would clutter the parent context.

Do not delegate:

- A single small edit.
- Sequential steps where each depends on the previous result.
- Anything that changes the live editor (see below).

## Writing a brief

The worker sees only the brief, not the conversation. Each brief must be self-contained:

1. Goal, in one or two sentences.
2. Exact file paths to read and to write.
3. Constraints (conventions to follow, files not to touch).
4. Expected output: ask for a concise summary of what changed and anything unresolved.

Parallel workers must write to disjoint files. Never ask two workers to edit the same file.

## Tools workers use

- Workers read and write files and run shell commands.
- Sandbox Studio workers can also read editor state with read-only `query_*` tools. Treat those as inspection only.
- Keep every `action_*`, `run_script`, and `batch_execute` call in the parent. This keeps approvals, undo grouping, and scene state under one agent. Cursor workers may technically see these tools; they must not use them.

If a worker discovers editor changes are needed, it reports them and the parent applies them.

## After workers finish

Never relay a worker's claim as fact.

1. Read each result. A failed worker means retry it with a sharper brief or do the task inline.
2. Check the actual changes (read the files or diffs) and run the project's typecheck or tests when code changed.
3. Apply any editor changes from the parent.
4. Report what was verified and what failed.
