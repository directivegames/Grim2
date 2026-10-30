# Rigged characters on the engine mannequin rig

How a Blender model plays the engine's animations: the build steps, the rig, weighting, the animation config, and the code that puts it on a pawn or an enemy. The rules that make it deform are in the skill's *Rigged characters* section. Tested examples: `examples/character` (soft clothing) and `examples/rigid-creature` (a skeleton).

## Build steps

Role `hero` or `creature`.

| Step | Script | Check |
|---|---|---|
| 1. Rig | `mannequin_rig()` imports the armature untouched and removes the mannequin body | `PRINT rig bones 65 … rest T-pose height 1.79 m` |
| 2. Model in the rest pose | Build around `joint('LeftForeArm')` etc. Arms run along ±X (T-pose); the left side is +X | Sheet shows a T-posed figure on the joints |
| 3. Weight each part as it is made | Rigid: `bind_rigid(part, 'Head')` for heads, hair, hands, bony or armoured pieces, carried props. Soft: `bind_nearest(part, region('arm', 'Left'))` for cloth and limbs | Every part is bound before `skin` |
| 4. Skin | `skin('SKM_Name', parts)` joins, binds, limits to 4 influences, normalises | `PRINT skin … unweighted 0` (it raises otherwise) |
| 5. Pose check | `pose_check('name')` plays Walk, Run and Jump and renders three views each | Open every `.scratch/blender/<name>-<clip>.png`: limbs follow, nothing stretches |
| 6. Export | `asset.json`: `"export": ".../SKM_Name.glb", "rig": "mannequin"`. A scene with an armature exports skinned, modifiers kept | `RIG mannequin: 65 animated bones checked … 0 problems` |

`region()` lists the bones each body part may follow: `torso`, `chest`, `spine`, `neck`, `pelvis`, `arm`, `forearm`, `leg`, `foot`.

## Why the mannequin rig

`CharacterPawn` builds its animation node from `@engine/assets/character/config/mannequin.animconfig.json`. That config lists `"externalAnimationSources": ["@engine/assets/character/mannequinG.glb"]` and drives the states `idle`, `run` and `jump` from the parameters `isRunning`, `isJumping`, `forward`, `back`, `left` and `right`. The clips are bound to the visual model **by bone name**. A model with the same armature plays every clip; a model with its own rig plays none of them.

| Fact | Value |
|---|---|
| Bones | 65, named `mixamorig:Hips`, `mixamorig:Spine` … `mixamorig:LeftHandThumb4` |
| Rest pose | T-pose; arms along ±X; feet at z = 0; the head top at about 1.79 m |
| Root node | `Armature`, rotation X +90°, scale 0.01 (Mixamo centimetres) |
| Clips | `Idle`, `Walk`, `Run`, `RunBackward`, `StrafeLeft`, `StrafeRight`, `Jump` |
| Facing | Same as every Blender asset: front −Y in Blender, glTF +Z; the pawn's visual child yaws π |

Source: `.engine/src/const.ts` (`DEFAULT_CHARACTER_MODEL_URL`, `DEFAULT_CHARACTER_ANIMATION_CONFIG_URL`); `node_modules/@gnsx/genesys.js/assets/character/config/mannequin.animconfig.json`

## Weighting

| Part | Call | Why |
|---|---|---|
| Head, face, hair, helmet | `bind_rigid(part, 'Head')` | Moves as one piece; never smears |
| Hands, mitts, gloves | `bind_rigid(part, 'LeftHand')` | Fingers are not weighted unless modelled per finger |
| Bones, armour plates, robot limbs | `bind_rigid(piece, <its bone>)` | One bone per piece is the ideal case |
| Props carried on the body (bag, holster, quiver) | `bind_rigid(prop, 'Hips' or 'Spine2')` | Stays attached; does not stretch |
| Torso cloth | `bind_nearest(part, region('torso'))` | Follows the spine and shoulders only |
| Sleeves | `bind_nearest(sleeve, region('arm', side))` | Never pulled by the other arm or the spine below |
| Trouser legs | `bind_nearest(leg, region('leg', side))` | One leg never pulls the other |
| Shoes | `bind_nearest(shoe, region('foot', side))` | The heel follows `Foot` and the toe follows `ToeBase` |
| Straps, belts, drawstrings | `bind_nearest(strap, region('spine'))` or `bind_rigid` | A strap that follows an arm flies off in the run pose |

`bind_nearest` weights each vertex to its two nearest bone segments among the listed bones (inverse distance to the 4th power). `skin` keeps at most 4 influences per vertex and normalises them. The examples land at 1–2 influences per vertex and no unweighted vertices.

Blender's bone-heat weighting (`ARMATURE_AUTO`) was tried on the example character. It left 86 of 780 soft vertices unweighted, made the strap follow the arms, and flared the shins on deep knee bends. Region weights fixed all three.

## A different clip set per creature

The pawn's animation node can point at a project config. Copy the engine config and change the states: an enemy that shambles uses `Walk` where the player runs.

Source: `node_modules/@gnsx/genesys.js/assets/character/config/mannequin.animconfig.json` (structure)
```json
{ "$root": { "$bc": "ENGINE.AnimationConfigResource",
  "externalAnimationSources": ["@engine/assets/character/mannequinG.glb"],
  "initialState": "idle",
  "clipOptions": { "Idle": { "loop": "LoopRepeat" }, "Walk": { "loop": "LoopRepeat" } },
  "parameters": { "isRunning": false, "isJumping": false, "forward": 0, "back": 0, "left": 0, "right": 0 },
  "states": {
    "idle": { "clip": "Idle", "transitions": [ { "to": "run", "blendDuration": 0.2, "condition": { "isRunning": true } } ] },
    "run": { "blend": [ { "clip": "Walk", "weightParam": "forward" }, { "clip": "RunBackward", "weightParam": "back" },
                        { "clip": "StrafeRight", "weightParam": "right" }, { "clip": "StrafeLeft", "weightParam": "left" } ],
             "transitions": [ { "to": "idle", "blendDuration": 0.2, "condition": { "isRunning": false } } ] } } },
  "$version": 2 }
```
Save it as `assets/animations/<creature>.animconfig.json`.

## Wiring in the game

The player pawn swaps only the model; the default animation node and config stay.

Source: `.engine/src/entities/CharacterPawn.ts` (`setupVisualNode`, `setupAnimationNode`, `getAnimationParameters`)
```ts
protected override setupVisualNode(): ENGINE.SceneNode | null {
  const mesh = ENGINE.ModelMeshNode.create({
    name: 'MeshNode',
    modelUrl: '@project/assets/models/characters/SKM_Hero.glb',
    rotation: new THREE.Euler(0, Math.PI, 0),
    position: new THREE.Vector3(0, -ENGINE.CHARACTER_HEIGHT / 2, 0),
    physicsOptions: { enabled: false },
    castShadow: true,
  });
  this.add(mesh);
  return mesh;
}
```

An enemy also points its animation node at its own config. `CharacterPawn` sets `isRunning` only above `runSpeedThreshold` (default 2 m/s), which suits the player but leaves a slow walker in `idle`. Lower it for creatures that walk.

```ts
protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null {
  const node = ENGINE.AnimationStateMachineNode.create({
    name: 'AnimationNode', configUrl: '@project/assets/animations/walker.animconfig.json',
  });
  this.add(node);
  return node;
}

public override initialize(options?: ENGINE.CharacterPawnOptions): void {
  super.initialize(options);
  this.runSpeedThreshold = 0.3; // the run clip plays from walking speed
}
```

Procedural moments sit on the visual node, not on the bones, because the animation mixer writes the bones every frame. Examples:
- rising out of the ground (the visual node's y);
- a telegraph lean (its x rotation);
- a hit pulse (its scale).

Pausing works through tick: the animation node is a child node, so toggling `setTickEnabled` on every gameplay node also freezes the clips (`genesys-game-boot`).

## Traps

- The model stands in T-pose in game → it was exported without a skin, or its bone names differ. Rebuild with `"rig": "mannequin"` in `asset.json` and read the `RIG` line.
- The model is half a body height in the floor or floating → it was not placed like the mannequin. Use rotation `(0, π, 0)` and y `−CHARACTER_HEIGHT / 2` on the visual node.
- Arms or bones jump to odd angles only in game → the rig was moved or re-posed in Blender. `RIG … rest pose differs` reports it; rebuild from `mannequin_rig()`.
- Pose renders show a strap or sleeve flying off → it was weighted to bones outside its region. `bind_nearest(part, region(...))`.
- `skin` raises "vertices have no weight" → a part was joined without a bind call.
- Code that looked up named parts (`skel_arm_L`) finds nothing → a skinned model is one mesh. Animate through clips, and use the visual node for whole-body moves.
