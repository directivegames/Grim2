# Work packages

A work package is one brief file, `design/tasks/WPnn-<name>.md`, that an agent can implement with no other context than the files it names. It is the unit the parent hands to a worker (`genesys-subagents`) or the creator hands to another session ("Implement `design/tasks/WP04-hud.md`").

## Template

```markdown
# WP04 — <name>
Tier: <strong | mid | small> · Module: <M5> · Depends on: <WP01 skeleton built> · Parallel with: <WP05, WP06>
Status: <draft | ready | in progress | review | done>

## Goal
<One or two sentences with an observable result.>

## Read first
- .agents/skills/<skill>/SKILL.md — sections: <names>
- .agents/skills/<skill>/references/<file>.md — <section>
- TECH.md §2 (rows: …), §4 (contracts: …)
- GAME.md — Design: <bullets>; Assets rows: <roles>

## Owns (write only these)
- <src/ui/hud.ts>
- <src/const.ts — section HUD only>

## Reads (do not edit)
- src/contracts.ts, <other files>

## Implement
- `<Class> implements <Interface>` (contracts.ts) — <methods and what each must do>
- Engine calls, already decided: <exact classes, presets, options, anchors, from TECH.md §2>
- Numbers: <defaults from GAME.md / skills, with units>

## Constraints
- No MCP calls, no `buildProject`, no new dependencies, no subagents.
- Nothing outside **Owns**. Never edit `src/contracts.ts`: if the contract is wrong or missing something, stop and report what you need.
- <Safe UI / asset-path literal / no lights on spawned nodes, as relevant>

## Done when
1. `pnpm lint` and `pnpm build` pass.
2. <grep or file check the parent can run, e.g. `grep -c "class Hud" src/ui/hud.ts` = 1>
3. Smoke step <S07> exists in `src/debug/` and asserts <sustained outcome>. The parent runs it.

## Report
Files changed · output of each done check · deviations (should be none) · anything the parent must do in the editor · machine outputs written to <path>, not described in prose.

Verified: <filled by the parent after integration: date, smoke result, capture>
```

## Rules

- **No open questions in a `ready` brief.** If the worker would have to choose an engine class, a number, a layout or a look, the architect chooses first and writes it in the brief.
- **Name sections, not just skills.** "Read `genesys-ui` → Which widget and Placement" gets read; "see genesys-ui" gets skipped.
- **Done conditions are commands.** Each one is something the parent can run without trusting the worker.
- **Check results, not quantities.** A done condition confirms that something exists (`= 1`, `>= 1`), stays under a limit (draw calls ≤ budget, HUD inside its corners), or holds up in a smoke step. It never demands a minimum number of HUD items, props, nodes, triangles or lines: a worker can always reach a number by padding.
- **Unmeasured is not a pass.** When a check can't run (no state field, no capture), the worker reports it as unmeasured with what would measure it. The parent decides; the worker never rewrites the check to make it pass.
- **Machine outputs over prose.** Sizes, socket heights and ids go into a file (`asset.json`, a JSON sidecar, `const.ts`) that the parent reads.
- **One package per feel-coupled system.** Hero movement + camera + feel is one package for a strong model.
- **Size.** One package is roughly 1–4 files and under an hour of work. Bigger work splits along a contract.
- **Status.** The worker may move its brief to `review`. Only the parent sets `done`, after the integration wave, and fills **Verified**.

## Filled example

```markdown
# WP04 — HUD
Tier: mid · Module: M5 · Depends on: WP01 skeleton built · Parallel with: WP05 (enemies), WP06 (pickups)
Status: ready

## Goal
During Playing, the player sees health top-left, score top-right and the wave number top-centre; all three update the frame their value changes.

## Read first
- .agents/skills/genesys-ui/SKILL.md — Which widget, Placement, Safe UI, Done
- .agents/skills/genesys-ui/references/catalog.md — ProgressBar, NumberDisplay
- TECH.md §4 (GameFacade, HudView)
- GAME.md — Design: Palette

## Owns (write only these)
- src/ui/hud.ts
- src/const.ts — section HUD only

## Reads (do not edit)
- src/contracts.ts, src/game-mode.ts

## Implement
- `Hud implements HudView`: mount the three widgets in `mount()`, subscribe to `game.onScoreChanged`, show only while `RunState.Playing`.
- Engine calls: `ENGINE.ProgressBar` health bar at `setPosition({ top: '16px', left: '16px' })`; `ENGINE.NumberDisplay` for score at top-right and wave at top-centre, each placed after `initialize()`.
- Numbers: health bar 240×18 px; colours from the GAME.md palette (`#e8694a` fill).

## Constraints
- No MCP calls, no `buildProject`, no new dependencies, no subagents.
- Nothing outside Owns; never edit src/contracts.ts.
- Dynamic strings through text setters only (Safe UI).

## Done when
1. `pnpm lint` and `pnpm build` pass.
2. `grep -c "implements HudView" src/ui/hud.ts` = 1.
3. Smoke step S07 drives health 1 → 0.5 → 0 and asserts the bar width follows; the text does not overflow (`scrollWidth ≤ clientWidth`).

## Report
Files changed · done-check output · deviations · editor work for the parent (none expected).

Verified:
```
