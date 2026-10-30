# Brief template: a Blender asset batch

Tested on a whole build in which four workers ran in parallel and returned 18 models in 2–5 minutes each, every one at `RESULT ok` with its sheet opened. Fill the angle-bracket fields and send one brief per worker. Group 3–5 related assets per worker (hero + pickups, vehicles, buildings + kit, small props) so each worker's family stays consistent.

Before sending, the parent writes each asset's `asset.json` with its `role` and the expected numbers (size, triangle budget, materials). The runner enforces the role budget on its own, so a worker cannot pass by loosening `expect`. Builds of different folders can run at the same time; each run renders in its own temp folder.

```text
You are building Blender assets for a Genesys game project at <absolute project root> (run all shell commands from that directory).

Goal: build <N> <style> models with the project's headless Blender pipeline: <short list>.

FIRST read: .agents/skills/genesys-blender-modeling/SKILL.md (fully), .agents/skills/genesys-blender-modeling/scripts/gkit.py (helper signatures), and at least two examples under .agents/skills/genesys-blender-modeling/examples/ (<the closest ones, e.g. chest + torch>).

Game: "<title>". <One sentence: what the player is and does, with the gameplay camera distance.> Art direction: <the GAME.md art-direction line>. Palette (use only these hexes, plus <allowed extras such as white, near-black, glass tint>): <the GAME.md palette>.

Conventions: Blender front faces −Y (exports as glTF +Z); bottom centre at the origin; bevel boxes; <shared rules, e.g. "wheels are separate objects wheel_FL/FR/RL/RR with the pivot at the wheel centre">.

Assets (one folder each under blender/; asset.json with "role" and the expected numbers is already written — do not loosen it):
1. blender/<folder> (role <hero|creature|prop|pickup|kit|building|scatter|icon|title>) → <export path>. <What it is, size in metres [w, h, d], triangle budget, materials, named parts, markers.>
2. …

Loop per asset: `.agents/skills/genesys-blender-modeling/scripts/blender.sh build blender/<name>` → read NUMBERS → OPEN the contact sheet .scratch/blender/<name>.png with the file-reading tool and judge it → fix and rerun until it reads at gameplay distance. A shared helper may live in blender/<family>-common/ (no asset.json there).

Rigged characters (heroes, walking enemies): read the skill's "Rigged characters" section and copy examples/character (clothed) or examples/rigid-creature (bony, armoured). Start with mannequin_rig(), model in its T-pose, bind every part (bind_rigid / bind_nearest with region()), skin(), pose_check(), and set "rig": "mannequin" in asset.json. Never move or re-pose the armature. Open every pose-check image.

Constraints: write only under your blender/<folders> and their export paths. Never change "expect" or "role" in asset.json to make a run pass; if a number is wrong for the design, stop and report it with the reason (the parent changes it and records a "why"). Build only your own folders with `blender.sh build blender/<name>`; never `build-all`, which rebuilds other workers' assets while they edit them. Do not touch src/, GAME.md, or the editor. Call no MCP tools. Spawn no subagents. No image textures, no downloads.

Done condition: `blender.sh build blender/<name>` prints RESULT ok for every asset, each GLB exists at its path, and you opened each final sheet. Rigged assets also print `RIG mannequin … 0 problems`, and every pose-check image was opened.

Report back concisely: per asset the final NUMBERS and budget lines, the @project path, a one-line description of the sheet, and any named parts or markers. Sizes the game code needs (wheel radius, socket heights) are Blender markers or numbers in asset.json, which the parent reads from disk; repeat them in the report only as a summary.
```

The parent then opens at least one sheet per worker itself, reads the sizes the code needs from the markers or `asset.json` into `src/const.ts`, sets each Assets row to `landed` row by row, and wires the batch before the next one (`genesys-assets`).
