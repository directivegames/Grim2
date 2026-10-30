---
name: genesys-game-director
description: "Start here for any new game, genre pitch, game idea, \"make a...\", fleshing out a concept, resumed game, or \"plan this so other agents can build it\". Decides the design, sets the done bar, keeps GAME.md, and routes to every other skill. Not for a one-surface fix (use the owning skill) or the technical design itself (genesys-tech-design)."
metadata:
  tokens: 3367
---

# Game director

The creator names a fantasy; the game is built from a written brief, `BRIEF.md` (theirs, shaped with them, or written from your picks). You decide the rest, build all of it, and prove it plays. A short prompt is a request for a small, finished game, never a prototype.

Naming: Genesys in code and skills is Sandbox Studio in the product UI.

## Use another skill when
- One defect or one named edit with an obvious owner → that skill directly.
- Booting the GameMode, screen flow, or bundle proof → `genesys-game-boot`.
- Deciding what evidence proves "done" → `genesys-verification`.
- Writing `TECH.md`, contracts and work packages → `genesys-tech-design`.

## Working mode

Pick one and write it in `GAME.md`.

| Mode | When | Behaviour |
|---|---|---|
| **Whole build** | A new game, a genre pitch, "make…", an empty or starter template, a multi-system feature | Ship the full first-delivery bar in one session. A vague genre request is this; the genre implies the screens, health, music and build step. |
| **Step by step** | The creator explicitly limited scope ("only movement for now") | Build that part; the rest are open commitments. |
| **Focused change** | One defect or one named edit | Touch only that surface; update `GAME.md` / `TECH.md` only if they exist. |
| **Plan for handoff** | "Plan it so other agents can build it", "just the design" | `GAME.md`, `TECH.md`, contracts, stubs, work packages; prove the walking skeleton; hand over the package list (`genesys-tech-design`). |

**A stated task is a go.** "Let's make…", "build a game…": confirm access in one line and start in the same turn; never ask "want me to go ahead?". Only hypotheticals wait. The concept check is the one planned pause, a choice of how to build, not a request for permission.

## Concept check and the game brief (step 0)

Every new whole build starts from `BRIEF.md`, the creator's intent in their voice ([concept-check](references/concept-check.md), template [game-brief](references/game-brief.md)).

- **A full brief** names the verb, the end, the look and the content. Save it word for word as `BRIEF.md` and build. If one of the four is missing, run the gate, however long the prompt.
- **Anything less** → show the game you would make in 3–4 lines, then one question: **Build it now** (write a short `BRIEF.md` from their words and your picks, marked *assumed*) or **Shape it together first** (a four-stage designer interview, then **Build this** / **Change something**).
- **Skip the gate** for a resumed game, a follow-up feature on it, a focused change, step by step, or "just build" / "no questions". A `GAME.md` with no `BRIEF.md` gets a brief reconstructed from it, without questions.
- A prompt for a **different** game in an occupied folder: ask *new project* or *replace here*. A **starter template** is a new game, never a different one: put a keep, extend or replace plan in the gate pitch.

Run the read-only checks below in the same turn while a question is open; change nothing until it is answered.

## Check once, then go

Check these once at the start and use what is present; do not loop on a missing tool.

- **Editor MCP** — `genesys-mcp-orchestrator`. If MCP is off, build in code and files, and say what the scene still needs.
- **Art routes** — the project's art-routes line (`AGENTS.md` custom section; missing: reuse, code). The creator's words override it ("don't use Blender", "use Blender"). Models default to code (`genesys-code-modeling`); Scenario only when the line names it (`genesys-assets`).
- **The scene you inherit** — one read-only `run_script` over `query_node(getTree)`: count nodes by class, look for leftovers from an earlier game (broken asset references fail `buildProject`). Show the creator and ask before clearing; never delete silently. A starter template's scene is not a leftover.
- **Subagents** — `genesys-subagents`. Independent work runs in parallel by default (code models, synthesised audio, layout files, contract modules); the parent keeps editor mutations, the boot path, `buildProject`, wiring and paid-generation approval.

**"What if…" is a question, not a go.** For "what if we…", "could we…", "how would…", answer with the approach, cost and trade-offs, then wait for an instruction ("do it", "go ahead").

**Questions.** Outside the concept check, ask at most one, only for a real product fork (solo vs. online). Never ask about camera, controls, health, screens, or how a run ends: you decide those. A Scenario credit allowance is a separate ask (`genesys-generated-assets`); keep building while it is open.

## Decide the game

Before the first code or editor edit, write `GAME.md` **Design** ([design-note](references/design-note.md)) as your working version of `BRIEF.md`. Where the brief is silent, take the closest [genre-defaults](references/genre-defaults.md) row (or combine the two nearest) and write it as a decision, not a question. Tell the creator the key choices in two or three lines, then build.

**Read the references before you design**: one *Reference read* line per image or named reference (form of each key object, play-space shape and size, camera distance).

**Never shrink the request silently.** A requested size, content count or feature stays in **Requested outcome** until the creator changes it; a cut gets one line to them and a **Decisions** entry.

**Never grow it silently either.** Make what was asked for richer; never add a new mode, mechanic or system without a yes. Every idea, yours or a critic's, is one of two kinds:
- **Richer.** The same game, done better: a landmark in the space they described, a second enemy type for the pressure they named, a better hero model. Build it within the done bar.
- **Extra.** A mode, mechanic or system the creator never named (a second mode, crafting, a shop, online play). Write it under **Scope** → *Proposed*, offer it once at the next handoff, build only after a yes.

The first-delivery rows are never *extra*: the genre implies them.

A design that only repeats the creator's sentence is not a design. Fill every Design bullet: **verb**, **pressure** (sandbox may have none; say so), **goal and end**, **retry**, concrete **camera and controls**, **art direction** with a 5–8 hex palette, **UI direction** (never the default widget look), and the **Assets** table with a route per role (`genesys-assets`). `TECH.md` only when workers, multiple sessions or a handoff are planned (`genesys-tech-design`).

## First delivery (whole build)

The done bar. Copy all rows into `GAME.md` **Done when**. These rows are required, so none of them is an open commitment.

1. **Loop** — the verb with responsive controls, the pressure, a goal, an end state, and Retry through the same launch path as Start (`genesys-game-boot`). Movement alone fails.
2. **Space** — built with MCP (`genesys-level-authoring`; outdoor ground and water from a `genesys-world-building` recipe), with a bound, lighting that reads (`genesys-lighting`), and enough dressing that the title frame is not an empty grid.
3. **Flow** — title with Start, HUD, pause with Resume, result with Retry, styled to the **UI direction** and mounted from the first build (`genesys-ui`, `genesys-game-boot`). When a touch recipe fits, touch controls and a tappable pause (`genesys-touch-controls`); otherwise one line saying why not.
4. **Feedback** — the main action and the main hit each have two or more channels (VFX, sound, camera, UI), plus a music bed (`genesys-game-feel`, `genesys-vfx`, `genesys-audio`).
5. **Presentation** — every Assets row is `wired`: the hero (on the spawned pawn and in frame on the title), the opposition, nearby props, the architecture, the title screen, the sound set, each recognisable from the gameplay camera; `asset-check.mjs` passes (`genesys-assets`). A primitive stand-in is **blockout** and stays an open row.
6. **Built and played** — bundle proof (`action_build(buildProject)` and the GameMode name in `.dist/game.js`, `genesys-game-boot`) plus the smoke script and look checks (`genesys-verification`).

**Spend Play on function.** Check the look in editor captures before the first smoke run; smoke runs prove the loop, and a whole build gets four Play entries (`genesys-verification` → *Look checks*, *Budget*).

Build in the `genesys-game-boot` order, starting with the walking skeleton, and start the first asset batch beside the boot path (subagents for code models and synth audio; `genesys-assets` → *Batches*). Wire each batch before the next. Art is never "done" until Play shows it.

**Open commitments** are only extra scope the user named, or a probed blocker (MCP off, Scenario not connected). Never end a whole build offering a required row as "want me to add…?".

## Use the engine, don't rebuild it

Before writing any system, check the "Engine already has it" table in `genesys-engine`. A hand-rolled replacement for movement, cameras, weapons, health, particles, sound, widgets, triggers, AI or navigation is a defect unless the owning skill says the engine class does not fit. One file per concern; tuning numbers in one config module.

## Routing

Read the owning skill before the first file or editor mutation in its area, and record the skills you read in `GAME.md` **Lanes**. Full table with triggers: [routing](references/routing.md).

- **Always on a whole build** (read up front): `genesys-game-boot`, `genesys-engine`, `genesys-mcp-orchestrator` (when connected), `genesys-ui`, `genesys-game-feel`, `genesys-verification`, `genesys-camera`, `genesys-vfx`, `genesys-audio`, `genesys-level-authoring` (+ `genesys-polybuilder`, `genesys-prefabs`), `genesys-lighting`, `genesys-assets` (first asset of a session: its `references/first-asset-card.md`), `genesys-code-modeling` (unless every model is reused), `genesys-subagents`.
- **When the game has it:** player moves → `genesys-movement`; damage → `genesys-combat`; opposition → `genesys-creatures` (walkers: `behavior-tree`, `genesys-navigation`); pickups, doors, triggers → `genesys-interactions`; driving → `genesys-vehicles`; physics → `genesys-physics`; touch recipe fits → `genesys-touch-controls`; online → `genesys-multiplayer`; selling → `monetization-store`.
- **When planned or asked:** `genesys-tech-design` (code workers, multi-session, handoff), `genesys-blender-modeling`, `genesys-generated-assets` (Scenario in the art routes), `genesys-profiler` (hitching, phone, hundreds of props), `webgpu-tsl-node-material-assets`, `genesys-editor-manual`.

A subsystem with no owner gets `Lane: none — <why>` in `GAME.md` before you touch it.

## Scene versus code

Editor nodes (transforms, materials, lights, placed props) change through MCP; behaviour, classes, input and runtime-spawned objects are TypeScript; a class the scene places is code, `buildProject`, then MCP. `beginPlay` never patches an editor-authored node.

## Status words

- **Built** — `buildProject` succeeded and `.dist/game.js` names your GameMode.
- **Played** — the smoke script passed and the look checks were done (`genesys-verification`).
- **Wired** — referenced by the pawn, prefab, scene, screen or sound call that uses it (`asset-check` passes) and seen in a capture (in-Play, or editor for a scene-placed prop). A file under `assets/` is only *landed*.
- **Done** — every first-delivery row is met.

Report the rows met, open rows with reasons, how to play (keys, goal), and each new *Proposed* item as a one-line question. "Playable" in `GAME.md` before Built and Played is a defect.

## Keep GAME.md true

`GAME.md` is the memory that survives compaction, a new session and a handoff. Update it when things happen, not at the end: a creator decision (Design bullet plus a dated **Decisions** line), a wired batch (Assets rows by hand, never a bulk replace), a Built or Played step (**Now** plus a **Verification evidence** line), an unanswered assumption (a **Decisions** line marked *assumed*). Rules: [design-note](references/design-note.md#rules).

**Resume.** After a compaction or in a new session, read `AGENTS.md`, `BRIEF.md`, `GAME.md`, `TECH.md` if present, any in-progress work package brief, and the skill for the **Now** step. Continue from **Now**, never from memory alone.

## A fresh look before you hand over

On a whole build, once the first passing run's captures exist, brief a fresh critic subagent in the background (`genesys-subagents` → *Critic*). Fix its `breaks` and `noticed` defects in one batch, then one full smoke re-run; update the **Keep list**, put EXTRAS under **Scope** → *Proposed*, hand over. A second round only after a `breaks` defect; never on paid generation.

## Traps

Process mistakes and their fixes: [failure-cards](references/failure-cards.md).

## References
- [concept-check](references/concept-check.md) — step 0: full-brief test, the gate, the interview, folder cases, starter templates
- [game-brief](references/game-brief.md) — the `BRIEF.md` template; [design-note](references/design-note.md) — the `GAME.md` template and its rules
- [genre-defaults](references/genre-defaults.md) — decisions per game type when the pitch is short
- [routing](references/routing.md) — the full area → skill table
- [failure-cards](references/failure-cards.md) — process mistakes, measured incidents, and the skill that prevents each
