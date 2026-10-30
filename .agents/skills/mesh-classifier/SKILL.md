---
name: mesh-classifier
description: "Dev tool: classify a folder of GLB meshes (an asset pack, engine models, any 3D set) so agents know what each asset is, how big it is, where its pivot is, how it sits, what it connects to and how to place it. Writes a 3/4 JPG render and a Markdown description next to every GLB, plus an ASSETS.md index per folder. Use when a developer says classify, describe or catalogue these meshes/assets/pack, run the mesh classifier on a folder, or refresh asset descriptions. Not for finding an asset to use in a game (use `genesys-assets`) or building models (use `genesys-code-modeling`)."
---

# Mesh classifier

A developer action, not a creator action. It turns a folder of GLBs into descriptions an agent can read before it places anything. Two stages: **a script measures and renders** (repeatable, seconds per asset), then **you interpret** each asset from its render and its facts (category, purpose, facing, placement rules). Run both stages; a description with `interpretation: pending` is half done.

## Run it

From the project root:

```bash
pnpm exec tsx .agents/skills/mesh-classifier/scripts/classify.ts <folder-or-glb> [more...]
```

- Finds every `.glb` under each folder (skipping dot-folders) and writes three files next to each GLB. **Existing files are overwritten.** When a GLB is byte-identical to the one its card was made from (sha256 in the detail file), the agent's filled fields and *Use it* rules are carried into the new card, so a re-run after a classifier change keeps the interpretation. A field whose meaning changed in a newer classifier comes back `_pending_` and the card returns to `interpretation: pending`; fill only those. A changed mesh gets a fresh, pending card. `--fresh` drops every interpretation.
  - `<Name>.jpg`: the 3/4 render.
  - `<Name>.md`: the **card**, about 400 tokens. Front matter, *Use it* rules and one line per key fact.
  - `<Name>.detail.md`: full measurements (height map, silhouettes, every surface and side, materials, clips). It's for interpreting and debugging, never for choosing assets.
- A folder target also gets `ASSETS.md`: one row per asset, about 40 tokens a row, grouped by category. Its *Pack notes* block survives re-runs.

Context is the constraint. An agent choosing assets reads `ASSETS.md`, then only the cards it picks. Keep every field you write short.
- Needs a local Chrome (headless; pass `--chrome <path>` or set `CHROME_PATH` if it is not found). Options: `--size 512`, `--quality 0.82`, `--verbose` (browser console), `--index-only` (rebuild `ASSETS.md` without re-measuring), `--fresh`.
- A failed asset is listed at the end with its error; the others still complete.

## Interpret each asset

For every `<Name>.md` with `interpretation: pending`:

1. Open `<Name>.jpg` and read the card. Open `<Name>.detail.md` only when the card leaves the shape unclear. In the render:
   - red, green and blue axes at the pivot are +X, +Y and +Z
   - the yellow floor arrow points −Z, the way a Genesys pawn faces
   - the orange figure is a 1.8 m person
   - the grid cell size is listed in the detail file under *Render*
2. Replace each `_pending_` in the front matter. Quote any value that contains a colon.
   - `category`: one word from the list below.
   - `summary`: at most 15 words. Say what it is and the one number that matters, for example "Railed boardwalk ramp; deck climbs 0.97 m (+Z) to 1.90 m (−Z) over one 4.8 m tile". This line is the asset's whole entry in the index.
   - `front`: the side it faces (`-Z`, `+X`, ...), read from the markers. Use `along Z` or `along X` for directional pieces with no face, `none` for symmetric ones, and `unknown` when you cannot tell. Never guess a default.
   - `style`: a few words ("chunky voxel, mossy wood").
   - `collision`: exactly one of these. The comment holds the measured suggestion; keep it when the render agrees.
     - `walk-mesh`: a concave surface the player walks on or through (decks, ramps, lily pads, bridges, arches, climbable rock ledges).
     - `box`: a solid block (walls, crates, plain rocks, hedges, creatures).
     - `trunk W×D at <offset>`: only the trunk or stem collides, for example `trunk 1.5×1.5 at pivot` or `trunk 2.3×0.9 at x 4.06 z 0.54`. Take the numbers from the suggestion or the detail file's *Base* line.
     - `none`: decoration the player passes through (grass, vines, moss, flowers, leaf canopies).
   - `role`: the gameplay role, read from the render: `collectible`, `hazard`, `landmark`, `stepping-platform`, `scatter`, `blocker`. Leave it empty (`role:`) when none fits. The index shows it as a tag.
   - `goes_with`: other assets in the folder it joins or sits beside, by file name.
   - `sits`: starts as the script's guess from the pivot and bounds. When the pivot is far from the footprint centre the script appends it (`pivot near −X/+Z corner; body +X 10.9, −Z 9.8`, `pivot 0.14 m −X of centre; body −X 0.22, +X 0.50`), and a large one-sided overhang past the base (`overhangs −Z 1.9 m past its base`). Keep it when the render agrees. Otherwise correct it, with the number an agent needs to place the asset: `hangs: top 3.8 m above pivot`, `floats: water line at pivot`, `attaches: +X end face at pivot`, `spans a gap; top 0.17 m above pivot`. You may shorten the notes or drop one that means nothing for this asset (an overhang on a creature's beak), but keep the numbers of the rest. The script can't tell a hanging vine from a plant whose pivot is low, so check every hanging, floating and attached piece. The index shows this value.
   - Check the *Stand on* and *Perch* facts against the render: a leaf top, a canopy or a creature's back is measured like a floor. Say so in *Use it* and pick `collision` to match; never edit the facts.
3. Replace the *Use it* bullet with three to five short bullets, most important first. These are the rules an agent follows when it places the asset. Use the measured numbers: deck height, which side joins, what to raise or sink, rotation steps, clearance, where a small prop or creature can sit. Say what *not* to do when a mistake is likely ("do not place at ground level; the pivot is the attachment end"). On a re-interpreted card, keep the existing bullets unless they contradict a field you just set.
4. Set `interpretation: done`.

Do not edit *Facts* or the measured front matter (below `sits`). If a measurement looks wrong, flag it to the developer rather than arguing with it in *Use it*: interpretations are kept across re-runs, so a bullet about a fact that later gets fixed goes stale.

Categories: `floor-tile`, `walkway`, `ramp`, `stairs`, `bridge`, `wall`, `wall-corner`, `door`, `arch`, `structure`, `platform`, `prop`, `container`, `pickup`, `tree`, `foliage`, `ground-cover`, `rock`, `hanging`, `water-surface`, `creature`, `character`, `vehicle`, `part` (attaches to another asset), `other`.

For a whole pack, split the pending descriptions into batches of about ten and give each batch to a subagent with this section as its brief (`genesys-subagents`). Each subagent opens its own renders, edits only the front matter fields that say `_pending_` (plus `sits` and *Use it* where they need it), and reports any measurement that looks wrong instead of editing it.

## Finish the folder

1. Run `classify.ts <folder> --index-only` so `ASSETS.md` picks up categories and summaries.
2. Fill the *Pack notes* block in `ASSETS.md` (between the `pack-notes` comments). Only state what the descriptions support, with numbers taken from the cards.
   - The shared tile or grid size if the modular pieces agree on one, which assets join which, variant families, the facing convention the set uses (for example "creatures face +Z"), heights that repeat (deck height, wall height), and anything that differs from Genesys conventions.
   - **Typical recipes**: 5 to 10 one-line ways to build common layouts from this set, each with real numbers. For example: a walkway over water (where the pivot goes so the deck is flush with the bank), a jump route of stepping platforms (gap sizes), a raised walkway (tile, ramp, raised tiles, end cap), a nook from three walls.
   - **Perches**: which surfaces a small prop or creature can sit on, and at what height above the pivot (wall tops, arch lintels, rock ledges, crates).
   - Keep it short: the notes are read on every visit, before the table.

## Reading the output

An agent that needs assets works in this order:
1. Read `ASSETS.md`.
2. Open the cards for its shortlist.
3. Look at a render only to confirm the look.
4. Open a detail file only to debug a placement.

Index columns: Size (x × y × z), Sits (placement, pivot offset and overhang), Front, Joins, Collision (`walk-mesh`, `box`, `trunk W×D at ...`, `none`), Stand-on (the largest surface a person fits on: height above the pivot, then x × z size, `+N` when the card lists more; `perch <height>` when only a small prop or creature fits; `—` when collision is `none` or `trunk`, because then a measured top holds nothing up), Summary (with a `[role]` tag, clip count, cost when high, `⚠` warnings).

Facts on the card are tagged `(m)` measured or `(g)` guessed. Front matter above `size_m` is the agent's reading of the render; `stand_on` and `perch` below it are measured. Trust measured numbers over names and over the render.

## Known limits (v4)

- Surfaces are the topmost ones only: a floor under a roof is not found.
- Openings are found only at ground level and only straight through along X or Z. When a ledge or jamb overhangs the edge of a passage, the card gives both the full width with its lowest clearance and the width of the tallest part (`5.80 m wide × 1.93 m clear (4.83 m of it 4.35 m clear)`). A window or hole above the ground (a ring frame) is not an opening.
- Volume fill is measured top-down, so a hole you can only see from the side (a window frame) still counts as filled, and the `collision` suggestion may say `box`.
- Joins are sides touched flush across ≥ 80% of their width, plus the side a deck runs out to on a modular piece (a ramp's low end). They show where a side is touched, not the joint's shape; two pieces with a band at the same height on facing sides very likely join. A plain box (a crate) joins on all four sides, which is true but rarely useful. End faces at an angle (a 45° corner piece) are never found as joins.
- *Stand on* lists patches wide enough for a person and within 35° of flat overall. *Perch* lists flat, level tops (within 15°, under 0.15 m of height change) from about 0.3 m wide up to person width, for small props and creatures; sloped rail tops, strands and most creatures' backs are dropped. Widths are measured on the probe grid (1/24 of the longest side), so on a large model a perch narrower than one cell is not found, and the core width a patch needs rounds up to whole cells. Neither can tell a leaf top or a canopy from a floor: decide in *Use it* and `collision`.
- The pivot note in `sits` compares the pivot with the bounding-box centre, and the overhang with the *Base* (cells whose underside is within 10% of the height of the lowest point). A model with several feet (a tree with aerial roots, an arch) has a base as wide as its feet apart.
- The `collision` suggestion is a shape rule (base much smaller than the top → `trunk`; a sloped stand-on patch, or one below higher parts or over open space → `walk-mesh`; mostly empty → `none`). It is often wrong for creatures and foliage, which is why the agent sets the field.
- Hidden or zero-scale nodes are skipped. Draco-compressed GLBs fail (meshopt works).
- The render is one fixed view; small details on the far side may be hidden.
