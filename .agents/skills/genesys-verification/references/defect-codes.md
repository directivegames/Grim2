# Defect codes

A fixed list of codes for problems visible from the gameplay camera or measured in Play. Look checks, the critic and `GAME.md` (**Now** and the **Keep list**) all use the same codes, so a defect found by one agent can be found again, fixed by the right skill, and checked off by the next session.

A code is `<area>.<name>`. Always write it with the thing and the proof: `look.stand-in — the enemy is a capsule — .scratch/play/s11-pressure.jpg`. A code on its own says nothing.

## look — what the models and the space show

| Code | You see | Fixed in |
|---|---|---|
| `look.stand-in` | A single plain primitive (box, capsule, sphere, plane) where a person, creature, prop or vehicle should be: a blockout. | `genesys-code-modeling`, `genesys-assets` |
| `look.shapeless` | Rocks, foliage or a creature with no readable outline: lumps and noise. | `genesys-code-modeling`, `genesys-assets` |
| `look.untextured` | A big surface in one plain colour where the art direction calls for a material. | `genesys-assets`, `genesys-level-authoring` |
| `look.mixed-styles` | Pieces from different families side by side: stock kit next to code-built props in another style, toon next to realistic. | `genesys-assets` |
| `look.scale` | A model is clearly the wrong size for the hero: a door they can't fit through, a coin as big as a car. | `genesys-assets` |
| `look.facing` | A model points sideways or backwards relative to how it moves or aims. | `genesys-code-modeling`, `genesys-assets` |
| `look.hovering` | A gap between an object and the floor or wall it should touch. | `genesys-level-authoring` |
| `look.buried` | An object sunk into the floor or a wall. | `genesys-level-authoring` |
| `look.flicker` | Two surfaces in the same plane shimmer or show stripes. | `genesys-level-authoring` ([scene-scans](scene-scans.md)) |
| `look.smeared` | A texture pulled long across a scaled mesh. | `genesys-level-authoring` ([scene-scans](scene-scans.md)) |
| `look.empty-shot` | The title or play frame shows the editor grid, empty space, or no hero. | `genesys-game-boot`, `genesys-camera` |
| `look.bind-pose` | A rigged character stands in its bind pose (T or A shape), or slides without moving its legs. | `genesys-code-modeling`, `genesys-blender-modeling`, `genesys-movement` |

## light — exposure and atmosphere

| Code | You see | Fixed in |
|---|---|---|
| `light.too-dark` | Shapes and text can't be read. Smoke step S03 measures centre-weighted luma under 0.08. | `genesys-lighting` |
| `light.overexposed` | Large patches burnt to white: sky, glow, bloom. | `genesys-lighting` |
| `light.washed-out` | Fog or a haze layer flattens the whole frame into one colour. | `genesys-lighting` |

## screen — widgets and text

| Code | You see | Fixed in |
|---|---|---|
| `screen.covered` | Widgets sit over the middle of the action, or overlap each other (`uiOverlaps`). | `genesys-ui` |
| `screen.clipped-text` | Text cut off or running out of its panel (`textOverflow`). | `genesys-ui` |
| `screen.default-look` | The UI shows the default widget look (rounded translucent cards, system font) instead of the game's UI direction. | `genesys-ui` |
| `screen.title-bar` | The title card is a full-width bar or sits in a corner instead of a centred panel. | `genesys-ui` |

## play — what the smoke run measures

| Code | The smoke run shows | Fixed in |
|---|---|---|
| `play.no-response` | Holding a control changes nothing. | `genesys-movement`, `genesys-game-boot` |
| `play.reversed` | Right moves left on screen, or looking up looks down. | `genesys-movement`, `genesys-camera` |
| `play.single-cue` | A key moment (main action, main hit, pickup, death) has only one kind of feedback. | `genesys-game-feel` |
| `play.silent` | A moment that should make a sound measures silent (`AudioMeter`), or nothing plays under the game. | `genesys-audio` |
| `play.harmless` | The opposition (enemies, hazards, a rival) never reaches or hurts the player (S11). | `genesys-creatures` |

## proof — problems with the evidence itself

| Code | Problem | Fix |
|---|---|---|
| `proof.editor-shot` | An editor screenshot offered as proof of how Play looks. | Take a Play capture (`genesys-verification`) |
| `proof.unmeasured` | The step could not check the claim: no receiver, no state field, a failed capture. It is neither a pass nor a fail. | Report it and say what would measure it |

## How to use them

- **Codes are for things the brief or `GAME.md` asked for.** A mode, mechanic or system nobody asked for is not a defect and gets no code. The critic lists it under EXTRAS ([critic-brief](../../genesys-subagents/references/critic-brief.md)), and it becomes a question for the creator (`genesys-game-director` → *Never grow it silently either*).
- **Each code carries a weight.** `breaks`: the loop doesn't work, or the game isn't recognisably what the brief describes. `noticed`: obvious within a minute of playing. `polish`: everything else.
- **A code that comes back gets a check.** If the same code shows up in two critic rounds, add a smoke step or a scene scan that measures it, so the next regression is caught automatically.
