# First-asset card

Read this before the first model, image or sound of a session, whichever skill you came from. It covers the part of the asset work that real sessions skipped. The model built fine, and then it was a speck, faced backwards, floated, stood on a scene node Play never spawned, or nobody looked at it.

## The eight steps

1. **Row first.** Write the `GAME.md` Assets row before the model: role, route, exact path, status `planned`. The parent writes the row; a worker proposes one. A code model's Path is its exported GLB (`@project/assets/models/<name>.glb`).
2. **Metres.** One unit is one metre. Character 1.8, door 2.2, crate 0.8, pickup 0.25–0.5 (bigger than life so it reads), kit wall 4 × 4. A reused engine model that is the wrong size takes an instance scale. A code model gets its size in its own code.
3. **Front.** Build a code model facing −Z, the pawn's forward. A GLB from Blender exports its front as +Z, so its visual child yaws π: `rotation: new THREE.Euler(0, Math.PI, 0)`.
4. **Pivot.** Put the bottom centre at the origin. On a character pawn the visual child sits at `y = -ENGINE.CHARACTER_HEIGHT / 2`, so the feet touch the capsule bottom.
5. **Role budget.** Keep triangles and materials under the role's row (`genesys-assets` → *Weight budgets*). Share geometry and materials across copies (`genesys-profiler` → Never pay per spawn).
6. **Look at it.** Before the status moves to `landed`, look at the model from the front and from the gameplay camera. For a code model, take an editor screenshot of the placed GLB (or its class) or an in-Play capture (`genesys-code-modeling`). For a Blender model, open `.scratch/blender/<folder>.png`. Ask one question: does it look like the thing at play distance? For glow, glass or pale colours, check them in a Play capture under the game's lighting.
7. **Wire it where Play loads it.** Build the hero and everything Play spawns in the pawn or enemy **class**. Never put them on a node placed in the scene. Place scene props with MCP, then save. Write file paths as one full string literal. Run `asset-check.mjs --prebuild` before `buildProject`.
8. **Capture, then check.** `wired` means referenced **and** seen: an in-Play capture for what the game spawns or shows, an editor screenshot for a scene-placed prop (`genesys-verification`). Then run `asset-check.mjs` and report its warnings.

## What you see and what it means

| You see | It means | Fix |
|---|---|---|
| A speck, or a model as big as a building | the size was never set in metres | set the size in the model code |
| The model floats or sinks | the pivot is not at the bottom centre | move the parts so the lowest point is at y = 0 |
| The front view shows the back | the model faces +Z | build it facing −Z, or yaw the visual child π |
| One plain box, sphere or capsule | a blockout | compose it from many shaped parts (`genesys-code-modeling`) |
| A frame-time spike on every spawn | new geometry or material per copy | create them once and share them |
| Play shows a capsule where the model belongs | the model sits on a scene node, not the class | build it in the pawn or enemy class |
| `buildProject` fails on an image path | code named a file that does not exist yet | make the file in batch 1; run `--prebuild` |

## Commands

```bash
node .agents/skills/genesys-assets/scripts/asset-search.mjs <words>             # reuse first
node .agents/skills/genesys-assets/scripts/asset-check.mjs --prebuild             # before buildProject
node .agents/skills/genesys-assets/scripts/asset-check.mjs                        # before every report
```
