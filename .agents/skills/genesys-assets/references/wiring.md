# Wiring a GLB onto a pawn, and asset QA

Where each kind of asset goes is the table in [SKILL.md → Wire it](../SKILL.md#wire-it). This file holds the pawn code and the QA bars.

## A GLB on a pawn Play spawns

A pawn that Play spawns does not exist in the editor. Attach its GLB mesh in its class. Never add a `GLTFLoader`.

Source: .engine/src/entities/CharacterPawn.ts (`setupVisualNode`, `setupAnimationNode`), .engine/src/entities/DefaultCharacterPawn.ts
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// Rigged on the mannequin: the inherited animation node plays the engine clips on it.
@ENGINE.GameClass()
export class Hero extends ENGINE.DefaultCharacterPawn {
  protected override setupVisualNode(): ENGINE.SceneNode | null {
    const mesh = ENGINE.ModelMeshNode.create({
      name: 'HeroMesh',
      modelUrl: '@project/assets/models/characters/SKM_Hero.glb', // one full string literal
      rotation: new THREE.Euler(0, Math.PI, 0), // glTF front (+Z) → pawn forward (−Z)
      position: new THREE.Vector3(0, -ENGINE.CHARACTER_HEIGHT / 2, 0), // feet on the capsule bottom
      physicsOptions: { enabled: false }, // the pawn's capsule collides, not the mesh
      castShadow: true,
    });
    this.add(mesh);
    return mesh;
  }
}

// Static (unrigged) model: the same visual node, and no animation node to drive.
@ENGINE.GameClass()
export class Slime extends ENGINE.DefaultCharacterPawn {
  protected override setupVisualNode(): ENGINE.SceneNode | null {
    const mesh = ENGINE.ModelMeshNode.create({
      name: 'SlimeMesh',
      modelUrl: '@project/assets/models/creatures/SM_Slime.glb',
      rotation: new THREE.Euler(0, Math.PI, 0),
      position: new THREE.Vector3(0, -ENGINE.CHARACTER_HEIGHT / 2, 0),
      physicsOptions: { enabled: false },
    });
    this.add(mesh);
    return mesh;
  }

  protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null {
    return null;
  }
}
```

The same overrides exist on `GSSCharacterPawn` (`.engine/src/gameplay-sim/entities/GSSCharacterPawn.ts`) for online heroes. For a pawn that is not a character pawn, create the same child in `initialize` after `super.initialize(options)`.

## QA

| Check | Bar | How |
|---|---|---|
| Size in metres | Matches the role (character ~1.8 m, door ~2.2 m, crate ~0.8 m, coin ~0.3 m) | The model's bounding box (`genesys-code-modeling`), `asset-search` for existing models, Blender `NUMBERS` |
| Front | The model faces the pawn's forward (−Z) | Editor screenshot or capture from the front |
| Pivot | Bottom centre at the origin; props sit on the floor, characters stand on the pawn's feet | Bounding box `min.y` is 0 |
| Weight | The role's row in *Weight budgets* | Triangle and material counts; `asset-check` for files |
| Engine look | Colours hold under the sun and tone mapping; glow, glass and pale colours read | A Play capture under the game's lighting (Blender: the `--look` tile) |
| Reads in game | Recognisable from the gameplay camera at play distance | A capture (`genesys-verification`) |

Reused engine assets may take an instance scale (a 0.66 m `LowPoly` tree scaled to 4 m is fine); a code model gets its size in its own code.
