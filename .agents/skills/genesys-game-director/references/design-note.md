# Design note: GAME.md

Create `GAME.md` at the project root for a whole build or a step-by-step build. A focused change updates it only if it already exists.

The editor holds scene truth: nodes, transforms, materials, lights, and prefab instances. `GAME.md` holds what the editor cannot: the design, the asset plan, the decisions, and the status of the work. It is not a production bible, a level script, or an outliner copy. *How* the game is built (engine mapping, modules, contracts, work packages) lives in `TECH.md` (`genesys-tech-design`), so the two files never repeat each other.

Tell the creator in one line that the plan is in `GAME.md` and they can redirect it.

## Template

```markdown
# <Title> — <one-line genre description>

## Design
- **Fantasy** — <their words, plus the stakes you decided: who the player is, what opposes them>
- **Reference read** — <one line per image or named reference: form of each key object, play-space shape and size, camera distance; "none" if no reference>
- **Verb** — <what the player does every few seconds, including how they aim or act>
- **Pressure** — <what can make them fail or lose time; "none — sandbox" is valid>
- **Goal and end** — <what a run is, what ends it, what the result screen shows>
- **Retry** — <the one action back into play; same launch as Start>
- **Camera** — <layout, distance or height, what stays in frame on the title>
- **Controls** — <keys / mouse / touch, including pause>
- **Space** — <the play space, its bound, what supplies the geometry>
- **Pacing** — <run length target, how difficulty rises>
- **Art direction** — <one sentence: style, materials, mood; every asset reuses it>
- **Palette** — <5–8 hex colours with a word each: `#6b665f` stone, `#ff9a40` torchlight, …>
- **UI direction** — <derived from the art direction: display font + body font (Google Fonts links are allowed), one shape language (rounded, skewed, square or ornate), colours from the palette, one signature element (a reticle, a meter shape, a banner style); never the default widget look (`genesys-ui`)>
- **Art routes** — <copied from AGENTS.md, then the creator's words applied, e.g. "reuse, code — Blender off, Scenario off">
- **Audio** — <music mood, key sounds>
- **Players** — <solo | online co-op | online versus>
- **Tuning** — every tunable number lives in `src/const.ts`, grouped by system (`genesys-game-boot`)
- **Out of scope** — <what this game is not, and what you are not adding>

## Status
1. **Requested outcome** — <the user's request, quoted or close to it, plus every follow-up they asked for; never shrunk without a Decisions line>
2. **Working mode** — whole build | step by step | focused change
   **Concept** — full brief | built with my picks | shaped with creator | skipped — <why> (`BRIEF.md`, [concept-check](concept-check.md))
3. **Now** — <current state, in status words: Built? Played? Say "blockout" for any primitive stand-in>
4. **Done when** — <all six first-delivery rows from genesys-game-director, each with its concrete version for this game>
5. **Lanes** — <skills read for this work>
6. **Open commitments** — <only extra scope the user named, or probed blockers>
7. **Design** — <`GAME.md` only (one agent) | `TECH.md` + contracts + work packages (workers or handoff) | none (focused change)>

## Assets
| Role | Route | Path | Reuse | Done when | Status |
|---|---|---|---|---|---|
| <hero body> | <reuse / code / scene / synth / blender (blender/<dir>) / scenario> | <exact @project/... or @engine/... path; a code model row names its GLB; a code row with no asset file names its src/... file> | <instances or sharers> | <visible or playable test> | <planned / building / requested — job id / landed / wired / cut — reason> |

## Scope
- **Cut** — <part of the request you are not building, why, and its Decisions date; "none">
- **Proposed** — <an idea beyond the request (yours or a critic's EXTRAS), one per line, with status: asked <date> / yes — building / no — dropped>

## Keep list
- <something that already works, with the capture that shows it: "hero framed on the title — .scratch/play/s01-title.jpg"; at most 8, kept from critic rounds>

## Decisions
- <YYYY-MM-DD> — <decision or change, and why; the creator's redirects; "gate: shaped with creator", "brief approved"; "assumed — not answered: …">

## Verification evidence
- <YYYY-MM-DD> — <what ran (bundle proof, smoke N/N, captures in .scratch/play/…) and what it proves>
```

## Rules

- On a whole build, fill every Design bullet before the first code or editor edit. Take defaults from [genre-defaults](genre-defaults.md) and write them as decisions.
- Update a bullet when the user changes that decision. A focused fix does not invent a new design.
- **Now** never says *playable* before *Built* and *Played* (`genesys-verification`).
- **Reference read** is written before the Space, Camera and Controls bullets. They must agree with it.
- **Requested outcome** only grows with the creator's words. A feature the creator names on a built game ("add a boss rush mode") is a follow-up, not an *extra*: append it here and to `BRIEF.md` → **Added later** ([concept-check](concept-check.md) → When it runs). A mode, mechanic or system the creator never named (*extra*) goes under **Scope** → *Proposed*, is offered once, and is built only after a yes; making what they asked for *richer* is ordinary design work (`genesys-game-director` → *Never grow it silently either*). A *no* is final: never offer the same idea again. A cut, a scale reduction or a swapped mechanic gets a dated **Decisions** line and one sentence to the creator.
- The Design bullets are your working version of `BRIEF.md` ([game-brief](game-brief.md)). Where they differ, the brief wins unless a Decisions line records the creator changing it. A change to the brief gets a dated Decisions line.
- **Decisions** is append-only and dated. It records every creator redirect ("crash returns to the hangar", "arcade and forgiving"), every assumption made without an answer, and every cut. A resumed session reads it to avoid undoing a decision.
- **Verification evidence** gets a line each time something is Built or Played. A claim in **Now** points to its evidence line.
- Update `GAME.md` when the moment happens, not at the end: a creator redirect, a wired batch, a Built or Played step. Change Assets statuses row by row after checking each one; a bulk find-and-replace of statuses is a defect.
- **Keep list** holds at most 8 items, each with its capture. Merge the critic's list after each round, drop items the creator changed, and re-check every item after a fix round (`genesys-verification`). Worker briefs that touch a listed module or asset carry the list (`genesys-subagents`).
- **Open commitments** never contain a first-delivery row: loop, space, flow, feedback, presentation, or built-and-played.
- The **Assets** table is written with the Design, before the first code or editor edit, and kept current as rows move (`genesys-assets`). `asset-check.mjs` reads it.
- A Scenario job id sits in its row's Status (`requested — job <id>`), so a resumed session can `jobs_wait` on it. Credit totals do not go here.
- A resumed session reads `AGENTS.md`, `BRIEF.md`, `GAME.md`, `TECH.md` if present, the brief of any work package in progress, and the skill for the **Now** step, then follows the latest user request.
