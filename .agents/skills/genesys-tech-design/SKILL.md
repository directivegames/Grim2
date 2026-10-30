---
name: genesys-tech-design
description: "Write the technical design that lets other agents build the game: TECH.md (engine mapping, modules with owned files, compiled contracts, scene plan, verification plan) and self-contained work packages for cheaper models, plus the tech-check. Use for technical design, architecture, TECH.md, plan for handoff, split the work, module contracts, work packages, cheaper agents. Not for what the game is (genesys-game-director) or running the workers (genesys-subagents)."
metadata:
  tokens: 2630
---

# Technical design

`GAME.md` says **what** the game is. `TECH.md` says **how** it is built, so that an agent who never saw the conversation can implement one part correctly. The most important rule: **every decision is made before a worker starts, and the contracts between modules are compiled code, not prose.** A worker that drifts from a contract breaks `pnpm build`; a worker that drifts from prose ships a bug.

## Use another skill when
- Deciding the game, the done bar, or the Assets table → `genesys-game-director`, `genesys-assets`
- Briefing, launching and checking workers → `genesys-subagents`
- The boot path, build sequence and bundle proof → `genesys-game-boot`
- Smoke steps and captures → `genesys-verification`
- Which engine class does a thing → `genesys-engine` ("Engine already has it", then Find an engine class)
- Event and contract patterns (`Delegate`, `isRoot`, local vs world) → `genesys-engine` → `references/contracts.md`

## Decide: how much design

| Request | Write |
|---|---|
| Focused change (one bug, one widget) | Nothing. Read `TECH.md` if it exists and keep it true. |
| Whole build, one agent, one session | No `TECH.md`. `GAME.md` holds the plan. Check "Engine already has it" in `genesys-engine` before each system, and start the walking skeleton. |
| Whole build with code workers, a multi-session build, or **plan for handoff** | Full `TECH.md`, `src/contracts.ts`, stubs, and one `design/tasks/WPnn-<name>.md` per work package. |

**Plan for handoff** is a working mode (`genesys-game-director`): the strong model writes `GAME.md`, `TECH.md`, the contracts, the stubs and the walking skeleton, proves it boots, then stops and hands the creator the work-package list with the one line that runs each ("Implement `design/tasks/WP04-hud.md`"). Any agent in any tool can pick a package up.

## Build the design (architect)

Run these in order. Steps 1–8 touch no editor state, so they can overlap the first asset batch.

1. **Read `GAME.md`.** Design and Assets table exist (`genesys-game-director`, `genesys-assets`). The *Reference read* lines are the source for sizes and shapes.
2. **Engine mapping.** For every system the game needs (pawn, movement, camera, input, combat, enemies, pickups, UI screens, VFX, audio, level, save), find the engine class first: the "Engine already has it" table in `genesys-engine`, then its API digest (Find an engine class) for the exact signature. Write one row per system: engine class, our class and file, owning skill, and why (name the rejected alternative when you chose custom code). Default pawns come from `genesys-engine`; decide them here once so workers never see two answers.
3. **Modules.** Split along **files and contracts**, not along skills. Keep systems whose feel is tuned together in one module (movement + camera + game feel for the hero). Every module owns a disjoint file set. **Boot & flow** (`src/game.ts`, the GameMode, `src/contracts.ts`, the smoke-node mount) always belongs to the parent.
4. **Contracts.** Write `src/contracts.ts`: enums, data types, the GameMode facade screens read, one interface per module boundary, `ENGINE.Delegate` events, and scene node names as constants. Types and constants only, no logic. See *Contracts* below.
5. **Config.** Create `src/const.ts` with one commented section per module (`genesys-game-boot` → tuning rule). Workers add keys only inside their own section.
6. **Stubs.** One file per module that implements its contract with blockout behaviour (a primitive, a fixed number, an empty method), so the whole game compiles and boots before any feature exists.
7. **Scene plan.** Author scene content as files where the pack supports it: layout JSON (`genesys-level-authoring` → `layout.mjs`), prefabs, code model builders (`tools/models/`). Then a worker can write the file, and the parent exports or places it with one call. List the node names code depends on.
8. **Verification plan and budget.** One smoke step id per module behaviour (`S01`…), each asserting a sustained outcome (`genesys-verification`). Performance budget: draw calls and instancing, alive caps, no lights on spawned things, the warm-up list (`genesys-profiler`).
9. **Work packages.** One brief per package from [work-package](references/work-package.md), indexed in `TECH.md` §9 with tier and status.
10. **Walking skeleton (parent).** The build sequence in `genesys-game-boot`, bundle proof, then Title → Start → Playing → Result → Retry with blockouts, and smoke steps `S01`–`S03` passing. Integration is now proven before any feature work.
11. **Check.** `node .agents/skills/genesys-tech-design/scripts/tech-check.mjs` passes. Then fan out (`genesys-subagents`) or, in plan-for-handoff mode, stop and hand over.

The full `TECH.md` template with its section rules: [tech-template](references/tech-template.md).

## Contracts

Source: Composed — typechecked against 18.1.0-alpha.317 (`ENGINE.Delegate` from `.engine/src/utils/Delegate.ts`)
```ts
// src/contracts.ts — written by the architect; workers import it and never edit it.
import * as ENGINE from '@gnsx/genesys.js';

export enum RunState { Title, Playing, Paused, Result }

export interface RunResult { won: boolean; score: number; best: number; seconds: number }

/** What screens read from the GameMode. UI never reaches into gameplay nodes. */
export interface GameFacade {
  readonly onStateChanged: ENGINE.Delegate<[next: RunState, prev: RunState]>;
  readonly onScoreChanged: ENGINE.Delegate<[score: number]>;
  readonly onRunEnded: ENGINE.Delegate<[result: RunResult]>;
  getState(): RunState;
  launchRun(): void;
  togglePause(): void;
}

/** Implemented by src/ui/hud.ts (WP04). */
export interface HudView {
  mount(world: ENGINE.World, game: GameFacade): Promise<void>;
  setVisible(visible: boolean): void;
  setHealth(fraction: number): void;
}

/** Scene node names code looks up. The scene plan places them; only the architect renames one. */
export const SCENE = { playerStart: 'PlayerStart', arenaBounds: 'ArenaBounds' } as const;
```

The GameMode implements `GameFacade` and fires the delegates from its one `transitionToState` (`genesys-game-boot`); `ENGINE.Delegate` has `add`, `remove`, `clear` and `invoke`. A stub implements its interface with empty bodies, and its worker replaces the bodies, never the signatures.

Rules:
- Modules talk through `contracts.ts` types and delegates, never by importing each other's internals.
- A contract change is an architect decision: edit `contracts.ts`, add a dated line to `TECH.md` §10, and update every brief it touches. A worker that needs a change **stops and reports**.
- Delegates are cleared in the owner's `endPlay`/destroy so Retry and level reloads do not double-subscribe.

## Tiers

Pick the cheapest model that can meet the package's done condition without making a design decision.

| Strong (Opus, Fable) | Mid (Sonnet) | Small (Haiku) |
|---|---|---|
| `GAME.md`, `TECH.md`, engine mapping, contracts, stubs | Leaf gameplay on engine classes with a decided design (pickups, a weapon on engine weapon nodes, an enemy with a decided brain) | Synth audio batches (`genesys-audio`) |
| Boot, GameMode, state machine, walking skeleton | UI screens in the game's UI direction | SVG icons in the HUD style |
| New mechanics where feel decides the numbers; hero movement + camera tuning | Code model builders, audio batches | Renames, moving literals into `const.ts`, status bookkeeping |
| Integration, cross-module bugs, every MCP mutation, judging captures | Layout JSON, VFX definitions, smoke steps for its own module | `asset-check` fix-ups |

Field note: Sonnet 5.5 ran a whole build in 22.6 min with a 14/14 smoke pass when the skills were clear. Spec quality limits a worker more than its tier does.

Choose the model per worker where the tool allows (Claude Code `Agent` has a `model` field). Where it does not, plan for handoff and let the creator choose.

## Integrate each wave (parent)

1. Read every report. Run each package's done condition yourself; never relay a claim (`genesys-subagents`).
2. Apply scene items: one `instantiate` per layout or prefab, then save and re-query (`genesys-mcp-orchestrator`).
3. Run the build sequence and bundle proof (`genesys-game-boot`), then the smoke test with captures (`genesys-verification`).
4. Set each package to `done` only after step 3, and record the evidence line in the brief and `GAME.md` → Verification evidence.
5. Run `tech-check.mjs` and `asset-check.mjs`. Start the next wave.

## Traps

- Workers edit the same file → one loses its work → the Modules table gives every file one owner; `tech-check` fails on overlap.
- A worker "fixes" a contract to make its code fit → other modules break at integration → contracts are read-only to workers; stop and report.
- Movement, camera and feel split across three workers → three agents tune against each other → one module for the hero's feel.
- The brief says "use the engine's weapon" → the worker invents an API → the brief names the exact class and method from the API digest.
- Integration left to the end → nothing boots after six parallel packages → walking skeleton first; integrate per wave.
- `TECH.md` lists files that no longer exist → the next session trusts a stale map → `tech-check` before every report; the owner updates the row in the same change.
- A design question reaches a cheap worker → it guesses → the architect answers it in the brief before the package is `ready`.
- A done condition demands a minimum quantity ("≥ 60 HUD items", "≥ 400 props") → the worker pads the number and the game gets worse → check existence, a limit, or behaviour in Play ([work-package](references/work-package.md) → Rules).

## Done
- With code workers, a multi-session build or a handoff: `TECH.md` exists and every system has an engine-mapping row. A single-agent build has no `TECH.md`.
- `src/contracts.ts` and the stubs compile; the walking skeleton boots and `S01`–`S03` pass.
- Every package names its tier, files, skill sections, engine calls and a done condition the parent can run.
- `tech-check.mjs` passes; remaining warnings are reported.

## References
- [tech-template](references/tech-template.md) — the `TECH.md` template and rules per section.
- [work-package](references/work-package.md) — the brief template, a filled example, and the status flow.
- [tech-check.mjs](scripts/tech-check.mjs) — checks module ownership, briefs, contracts and smoke-step ids against the code.
