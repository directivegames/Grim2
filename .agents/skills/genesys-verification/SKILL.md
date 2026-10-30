---
name: genesys-verification
description: "Evidence before calling anything done: node queries, bundle proof, console errors, in-Play captures through the capture receiver, the one-shot in-game smoke test that plays the game via MCP, two-client checks, and a fresh-critic pass. Use before saying built, playable, working, or done, and for test it, playtest, screenshot Play, see the game, does it work, smoke test. Not for frame-time investigations (use `genesys-profiler`) or the build sequence itself (use `genesys-game-boot`)."
metadata:
  tokens: 3423
---

# Verification

Different claims need different evidence, and a pretty picture proves none of them. This skill matches each claim to the tool that proves it, so "playable" is checked by playing, not discovered by the creator. The rule: **label every piece of evidence**, and assert what the player sees over seconds, not on the first frame.

## Use another skill when
- Running MCP calls (gate, readiness, dispatch) → `genesys-mcp-orchestrator`.
- The build sequence, bundle proof and build-failure triage → `genesys-game-boot`.
- Frame time, hitches, memory beyond the volley step → `genesys-profiler`.
- Writing the verification plan into a technical design (`TECH.md`) → `genesys-tech-design`. It cites the step ids defined here.
- Replication rules for an online game → `genesys-multiplayer`.

## Evidence by claim

| Claim | Evidence |
|---|---|
| A node exists, sits where intended, has the property | `query_node` (`find`, `getTree`, `getDetails`), `query_editor` |
| Code compiles | `pnpm build` and `pnpm lint` |
| Play runs my code | Build sequence and bundle proof (`genesys-game-boot`) |
| Play starts cleanly | `query_diagnostics(getConsole)` after `enterPlayMode`: no errors, no `Failed to load` |
| The loop or a mechanic works | **Smoke run** PASS lines; a mechanic step holds input 3–5 s and asserts the sustained outcome |
| **In-Play look** (title, framing, hero in shot, dark phases) | **Play capture through the receiver**: `.scratch/play/<step>.jpg`, opened with the file-reading tool |
| The space from outside | Editor `captureScreenshot` with a stated thing-to-check (edit mode; during Play the default `target: "auto"` captures the game, and only `target: "editor"` fails) |
| HUD and menus readable | `uiOverlaps`, `textOverflow`, `clickByText` in the smoke run (widgets are DOM, not in the canvas capture) |
| A rigged hero animates; it makes sound | Per-state Play captures (idle, run, jump); `AudioMeter` in the step (audible, silent, unknown) |
| Online play works | Two-client run (below) |
| Assets are in the game | `asset-check.mjs` (`genesys-assets`) passes, and Play captures show the hero, opposition and key props as models |
| A model reads as the thing | Editor screenshot or Play capture (`genesys-code-modeling`); Blender: its contact sheet `.scratch/blender/<name>.png` |
| It feels right | The `genesys-game-feel` Done list, measured in the smoke run where possible; the creator confirms the rest |

A capture never proves a node id, a bound, or a saved property. A query never proves a look.

**Label the evidence.** Each report line names its kind: `query`, `bundle`, `console`, `smoke S07 PASS`, `Play capture .scratch/play/s02-hud.jpg`, `editor capture (not Play)`, `creator confirmed`, `unmeasured`, or `unverified`. Never invent a screenshot. A step that could not measure its claim is `unmeasured`, reported apart from passes and fails with what would measure it.

**Where captures go.** Play captures go to `.scratch/play/`. Editor captures land in `.editor/captures/<date>/` (git-ignored, never shipped); copy kept ones to `.scratch/captures/`. `saveLocation: 'assets'` is only for an image the game ships.

## How much to check

| Change | Check |
|---|---|
| Focused scene edit | Re-query the changed node or field. Capture only if the user asked how it looks. |
| Focused code fix | `pnpm build`, `pnpm lint`, the build sequence if runtime classes changed, and one smoke step that exercises the fix |
| New verb, screen, or HUD element | One sustained-outcome step plus its Play capture |
| **Whole build** (new game) | Bundle proof, a clean console, the **full smoke run** with captures, `asset-check.mjs` passing, and one critic round |

## Budget

Verification serves the handoff; it never replaces it. Keep to these limits on every build.

- **Play entries.** Every `enterPlayMode` counts, including a Play started only to look. A whole build gets **four**: the first full run, at most two fix re-checks, one post-critic re-run. If FAILs remain when they are spent, hand over as **Built**, not **Played**, with each open FAIL and its evidence.
- **Re-check only what changed** with a step filter (`1:S09,S16`). The full tour runs again only after the critic, or after a change to boot, screens or the GameMode.
- **Look before Play** (*Look checks*). Smoke runs prove function; an art or lighting defect found in Play waits for the post-critic batch.
- **Critic rounds.** One, from the first passing run's captures; a second only after a `breaks` defect (*Fresh critic*).
- **Stop rules.** Play not active within 90 s of `enterPlayMode`, or the editor stuck on "world not loaded" / reset for 90 s: stop, report, carry on with work that needs no Play (ask the creator to reopen a stuck scene). One step failing twice with the same message: stop retrying and report the suspected cause.

## Verification plan

Write the plan in `GAME.md`, or in `TECH.md` §8 when a technical design exists: one row per module.

| Module | Step | Sustained outcome asserted | Capture |
|---|---|---|---|
| Movement | S04, S05 | 4 s forward hold ≥ 3 m, no slide back; right is screen-right | `s04-anim-run` |

Step ids are stable: S01… for the solo loop, N01… for networked checks. Add new ids at the end, and never renumber an id. Work-package briefs and `genesys-tech-design` cite these ids.

## Smoke run

The smoke node is required verification, not test code. It ships in `src/debug/`, and nothing runs unless the receiver was armed for this Play (the one-shot gate), so the creator's own Play never runs it. Copy both templates and wire them in ([smoke-test](references/smoke-test.md)). Default steps, adapted per game (full asserts: [smoke-test](references/smoke-test.md#default-steps)):

S01 title frames the pawn · S02 `clickByText('start')` reaches Playing · S03 centre luma ≥ 0.08 · S04 hold forward 4 s, ≥ 3 m, no slide back · S05 right is screen-right · S06 jump ≥ 0.5 m and lands · S07/S08 look right and look up · S09 main action, first hit ≥ 2 m away, logged · S10 40-shot volley, no frame over 2× median · S11 an enemy damages the player within 20 s · S12/S13 `P` pauses and Resume resumes · S14 kill through the damage path → Result · S15 Retry resets health, score, enemies · S16 clean console.

Climbing and flying games replace S06 with a sustained climb; rigged heroes capture idle, run and jump in S04 and S06. The smoke test presses `P`, not Escape: in a pointer-locked game the browser spends Escape on releasing the lock (F8 always leaves Play).

### Run it

Announce it first in one line ("…the `[SMOKE]` console lines are mine, not bugs"). Details and fallbacks: [smoke-test](references/smoke-test.md#running-it-step-by-step).

1. `query_editor(operation="getPlayModeState")`. If Play is active, decide whose it is: one that started within ~30 s of your own build or `enterPlayMode` with the receiver armed is yours (look for `[SMOKE] START`); never exit or take over the creator's.
2. Canonical build sequence and bundle proof (`genesys-game-boot`).
3. Start the armed receiver in the background: `node .agents/skills/genesys-verification/scripts/capture-receiver.mjs --clean --arm` (already running: `curl -X POST http://127.0.0.1:8765/arm -d 1`).
4. `action_editor(action="enterPlayMode")` as its own call.
5. Poll `query_diagnostics(operation="getConsole")` from one `run_script` until `[SMOKE] DONE`.
6. `action_editor(action="exitPlayMode")`, only for the Play you started.
7. Open every `.scratch/play/*.jpg` and read `.scratch/play/smoke.log`.
8. Fix each FAIL and non-smoke error, rebuild, and re-check with a step filter (`-d 1:S09,S10`, plus prerequisites: S13 needs S12, S15 needs S14). Each re-check is a Play entry.

No `[SMOKE] START` within 5 s: exit and enter Play once more; still silent, fall back to `SMOKE_FORCE = true` for one run and set it back before reporting. When the receiver cannot run at all, ask the creator one specific question about the screens.

## Look checks

**Before the first smoke run**, take editor captures (labelled `editor capture`) from the player's height: the spawn view, the main arena and the darkest corner. Check lighting, materials, fog, and that the hero and opposition read as models; fix in the editor and re-capture before entering Play. These cost seconds; the same fix through a smoke run costs a Play entry.

Then open each Play capture and say what it must show. Write every defect as a [defect code](references/defect-codes.md) plus its capture: `look.hovering — crates by the gate — s04-anim-run.jpg`.
- **Title (`s01-title`).** The hero in frame, not the editor grid; the scene lit; the title card a centred panel, not a full-width bar.
- **Play (`s02-hud`, `s04-*`).** The action in the centre, the HUD on the corners; hero, opposition and key props read as models, not capsules.
- **Pause and result (`s12-pause`, `s14-result`).** The scene behind is frozen; outcome text passes `textOverflow`; Retry is clickable.
- **Animation (`s04-anim-idle`, `s04-anim-run`, `s06-anim-jump`).** No T-pose; legs move in run, feet leave the ground in jump, the upper body is not frozen.

Optional scans for z-fighting and stretched textures run as a report-only smoke step ([scene-scans](references/scene-scans.md)).

## Two-client evidence (online)

Set clients to 2 in the toolbar **Network** menu and arm the receiver with `net:60000`. Assert N01 (the owner's move shows within 2 frames), N02 (the other client's copy follows within 1.5 s) and N03 (replicated fields match across clients after the server accepts a change), from both clients' lines in `smoke.log`. A capture of one window is not this test ([smoke-test](references/smoke-test.md#two-client-evidence-online-games)).

## Fresh critic (whole builds)

Start the critic once the **first passing run** (start, main action, fail and retry pass, even with smaller FAILs) has captures and `smoke.log`: a fresh background subagent with the [critic-brief](../genesys-subagents/references/critic-brief.md), reading `BRIEF.md`, `GAME.md` and the evidence, never the builder's summary. Fix every `breaks` and `noticed` defect in **one batch**, with any held-back art notes, then **exactly one** full re-run; merge its Keep list into `GAME.md`. A second round only after a `breaks` defect. EXTRAS are questions for the creator, never fixes.

## Status words

- **Loaded:** the skill was read.
- **Built:** bundle proof passed.
- **Played:** the smoke run passed, and every Play capture was opened and checked.
- **Done:** the owning skill's Done list is met. For a new game, that means every first-delivery row in `genesys-game-director`.

## Done (whole build)
- Bundle proof passed, and the console is clean on a fresh Play.
- `[SMOKE] DONE pass N fail 0 errors 0`, with `SMOKE_FORCE` false.
- Every `.scratch/play/*.jpg` was opened, and each report line carries its evidence label.
- `asset-check.mjs` passes. No `breaks` defect from the critic is open. Each `noticed` defect is fixed or listed as open in the handoff.
- Every **Keep list** item in `GAME.md` still holds in the latest captures.

## Traps

- "Playable" claimed from `pnpm build` alone → that only proves the code typechecks.
- A screenshot used to prove a node exists or a transform landed → query the node.
- An editor capture reported as the game → label it "editor capture" and take the Play capture.
- A smoke PASS on a mechanic the creator finds broken → the step checked the first frame; hold 3–5 s and log the first hit's time and distance.
- The agent's Play collides with the creator's → check `getPlayModeState` first; never exit a Play you did not start.
- Look tuned through smoke runs, one Play entry per tweak; a one-step fix re-checked with the full tour → editor captures first; a step filter for re-checks.
- `SMOKE_FORCE` left true after a fallback → the game plays itself for the creator; set it false and rebuild before reporting.
- A test framework or test files added → the in-game smoke node, `pnpm build` and `pnpm lint` only.
- A step that could not measure reported as PASS → label it `unmeasured`.
- A critic fix broke something that already worked → re-check the `GAME.md` **Keep list** after every fix round.
- Smoke-run mechanics (`clickByText`, waiting on your own Play, `editor_busy`, world-space controls, one look axis): [smoke-test](references/smoke-test.md#traps).

## References
- [smoke-test](references/smoke-test.md): files, default steps, running it in detail, receiver gate and mount, step filter, input, sustained outcomes, captures, audio, UI checks, two-client steps, log format, smoke traps.
- [scene-scans](references/scene-scans.md): optional z-fight and texture-stretch scans.
- [defect-codes](references/defect-codes.md): the shared `area.name` defect codes and the skill that fixes each.
- Tooling: `.agents/skills/genesys-verification/scripts/capture-receiver.mjs`, `.agents/skills/genesys-verification/templates/smoke-test.ts`, `.agents/skills/genesys-verification/templates/smoke-steps.example.ts`.
