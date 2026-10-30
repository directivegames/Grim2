# Failure cards

These are mistakes agents have actually made when building a game from a short prompt. Find the matching row and read the fix's owner. API-level mistakes (`new` vs `.create`, decorators, unsafe HTML) are listed in the **Traps** section of each owning skill.

The last section lists incidents measured in real test builds, with their cost, so the size of each mistake is visible.

## Scope and design

| Mistake | Fix |
|---|---|
| Shipped a movement prototype and listed enemies, UI, and art as "next steps" | The first-delivery bar is required (`genesys-game-director`) |
| Asked the creator to choose camera, controls, health, or screens | Decide from [genre-defaults](genre-defaults.md) and write the decision in `GAME.md` |
| `GAME.md` Design repeats the prompt with no verb, pressure, end, or retry | Fill every Design bullet ([design-note](design-note.md)) |
| A combat or dodge game where the player cannot lose | Add pressure and an end state (`genesys-creatures`, `genesys-combat`) |
| Retry rebuilds differently from Start, or reloads the page | One `launchRun` for both (`genesys-game-boot`) |
| Authored an asset pack, custom material system, or tooling during a genre build nobody asked for | Stay on the bar. Using an installed pack is fine (`genesys-level-authoring`) |
| Started building after the creator asked "what if we…" | Answer with the approach and its cost; wait for a go (`genesys-game-director`) |
| Built a system, mode or mechanic the creator never named because it seemed like a good idea or a critic suggested it | Deepen, don't add: write it under **Scope** → *Proposed* and ask once (`genesys-game-director` → *Never grow it silently either*) |
| A fix round broke something that already worked (the title framing, a control, the HUD) | Keep the `GAME.md` **Keep list** and re-check it after each fix round (`genesys-verification`) |

## Integration

| Mistake | Fix |
|---|---|
| `pnpm build` passed, but Play still runs the empty template | `buildProject` and a grep of `.dist/game.js` (`genesys-game-boot`) |
| "Playable" written before bundle proof and a playtest | Status words (`genesys-verification`) |
| Art started at the end and was cut when the session ran long | Start the first asset batch with the boot path (`genesys-assets` → Batches) |
| Many asset files generated or exported, the game still shows blockouts | Wire each batch before the next; run `asset-check.mjs` (`genesys-assets`) |
| "Scenario not connected" left the hero as a capsule | The next art route owns the row: reuse or code (`genesys-assets`) |
| The prompt said "Do not use Blender" and the agent built Blender folders anyway | The creator's words override the routes line; models default to code (`genesys-assets`, `genesys-code-modeling`) |
| Every asset priced and approved one at a time | One allowance for the batch total (`genesys-generated-assets`) |
| Title, pause, or result left unmounted while waiting for title art | Mount the shell on the first build; attach art later (`genesys-game-boot`) |
| `hideTitle()` and `isPaused` flags with no state machine or no mounted widget | One enum, one `transitionToState` (`genesys-game-boot`) |
| Model saved under `assets/` but not on any pawn, prefab, or screen | Wire every asset (`genesys-assets`) |
| Hero model placed as a static scene node while the spawned pawn is a primitive | Put the model on the pawn class the factory spawns (`genesys-assets`) |
| The title frame shows the editor camera on an empty grid | Keep the pawn spawned and framed on the title (`genesys-game-boot`) |
| `buildProject` fails on asset paths the game never used | The scene still holds an earlier game's nodes. Show the creator and ask before clearing (`genesys-game-director` → Check once) |

## Engine use

| Mistake | Fix |
|---|---|
| Hand-rolled movement integration, a raw camera, a projectile pool, or a health field | Check "Engine already has it" in `genesys-engine`, then the owning skill (`genesys-movement`, `genesys-camera`, `genesys-combat`) |
| One GameMode file doing input, combat, enemies, FX, and UI | Split by concern (`genesys-game-director`, Use the engine) |
| Scene layout, colours, or materials patched in `beginPlay` | MCP edits (`genesys-mcp-orchestrator`) |
| A hitch on every shot, hit or spawn | A light, material or geometry made per spawn; warm-up missing (`genesys-profiler` → Never pay per spawn) |
| The arena exists only as a hand-edited `*.genesys-scene` diff | MCP placement and `query_node` re-query (`genesys-level-authoring`) |
| `Failed to load texture` in the console for a floor or prop in use | Fix or replace the material before calling the space done (`genesys-level-authoring`) |

## Feel and presentation

| Mistake | Fix |
|---|---|
| Main action has one channel, or none | Two channels per moment (`genesys-game-feel`, `genesys-vfx`, `genesys-audio`) |
| No music | A music bed is part of the bar (`genesys-audio`) |
| A primitive called "the ship", "the hero", or "the car" | Call it a blockout until a model is placed (`genesys-assets`) |
| The hero is the stock engine mannequin or one capsule | Build it in code from many parts, with procedural motion (`genesys-code-modeling`); Blender on the mannequin rig only when the creator asks |
| A code creature slides like a statue | Swing limb pivots from speed, add an idle bob and squash (`genesys-code-modeling`) |
| A dark or horror mood pass left the level unreadable | Tune the existing sky and sun, keep fill, thin fog, one change per capture (`genesys-lighting`) |
| Model flies sideways or is huge | Orientation and scale QA (`genesys-assets`, `genesys-code-modeling`) |
| A model was marked done without anyone looking at it | An editor screenshot or capture before `landed` (`genesys-code-modeling`) |
| Every game's HUD looked the same: stock widgets, rounded translucent cards, system fonts | A **UI direction** per game; a custom HUD layer is allowed (`genesys-ui`) |
| Reused engine kit and modelled props in clashing styles | One family per space, palette for everything modelled (`genesys-assets`) |
| A control labelled right moves screen-left | Screen-direction check (`genesys-movement`, `genesys-verification`) |
| Shots "explode in the hand" in a third-person shooter | They hit the floor ahead: camera pitched too far down, projectile gravity too high (`genesys-camera`, `genesys-combat`) |
| Title card is a full-width bar at the top, or Start sits top-left | `setPosition` after `initialize()` (`genesys-ui`) |

## Measured in test builds (October 2026)

Four whole builds of three games, plus earlier runs. Each row is what happened, what it cost, and the rule that now prevents it.

| Incident | Cost | Rule now |
|---|---|---|
| Asked "want me to go ahead?" after a stated build task | 7 min idle; the creator: "I'm confused why you didn't in the first place" | A stated task is a go; anything less than a full brief gets the concept check's build-now-or-shape-it choice, never "go ahead?" (`genesys-game-director`) |
| Pitch "a backyard" and a reference image became a 600 m strip of yards with a handheld slingshot | 3 redesigns of launcher, level and distances | *Reference read* line before the design (`design-note`) |
| Smoke flag left on; the creator played the self-playing build ("about 10,000 coins") while the agent's Play calls failed | Lost test time; `[SMOKE]` lines reported as bugs; 17 `buildProject` calls in one session | One-shot runtime gate; never take over a Play you didn't start (`genesys-verification`) |
| Smoke PASS on "throw" and "stick back = nose up" while the pumpkin exploded in the hand and the plane would not climb | Bugs found by the creator after "Played" | Assert sustained outcomes (`genesys-verification`) |
| Code referenced `title.jpg` / `plane-tier-2.png` before the files existed | `buildProject` failed 3 times | Make every image the code references in batch 1; build the title and icons in code where possible; `asset-check --prebuild` (`genesys-assets`) |
| 33 Assets rows flipped planned → wired with one regex | A ledger that said nothing | Row by row, after checking (`design-note`) |
| 615 level nodes placed one MCP call each | 16 min and a 300 s client timeout | `layout.mjs` → one generated prefab, one `instantiate` (`genesys-level-authoring`) |
| 416 separate scatter nodes (grass, hedges, lawn tiles) | About 1,800 draw calls on a mobile target | Instance repeated dressing (`genesys-level-authoring`, `genesys-profiler`) |
| Night mood: sky deleted, sun 6 → 0.6, fog 0.034 `#211b2a` | Unreadable level; 9 creator complaints in 6 minutes | Tune the existing sky; one change per capture (`genesys-lighting`) |
| Fog colour and a ground material set through MCP read back fine but did not persist | Black fog after reload; grey ground in Play | Save, re-query, prefer asset paths (`genesys-mcp-orchestrator`) |
| A light on every projectile | A hitch on every shot | Never pay per spawn (`genesys-profiler`) |
| Post-process snippet without config casts | TS2353 in two separate builds | Every snippet in the pack is typechecked before it ships (pack authoring rule) |
| Blender workers raised their own `asset.json` limits after a FAIL (materials 6 → 12) | Gates that pass anything | Role budgets enforced by the runner; the parent owns expectations (`genesys-blender-modeling`) |
| Four Blender builds at once shared temp render files | A sheet showing another model; failed builds | Per-run temp dirs (`genesys-blender-modeling`) |
| "Do not use Blender" in the prompt; the skills made Blender the default for models, so the agent built 8 Blender folders | The slowest of two builds of one prompt; the code-built rival looked better | Models default to code; the creator's words override the routes line (`genesys-assets`) |
| Stock widgets with the default kit look on a stylised game | The HUD read as a generic dashboard next to a bespoke one | **UI direction** in `GAME.md`; custom HUD layer allowed (`genesys-ui`) |
| Play transition hung while smoke loops repeated | 7+ minutes stalled in one session | Verification budget: two smoke-and-fix loops, one critic round, 90 s Play-start timeout (`genesys-verification`) |
| Tuning literals spread through logic files | The creator asked for one file to tune | Every tunable in `src/const.ts` (`genesys-game-boot`) |
| Hero shipped as the stock mannequin; a skeleton enemy as rigid parts swung in code | "Obviously our character is just the default one" | Build it in code with procedural motion (`genesys-code-modeling`); Blender on the mannequin rig only when the creator asks |
