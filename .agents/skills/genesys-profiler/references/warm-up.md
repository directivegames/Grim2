# Warm-up and the volley check

The short rule is in [SKILL.md → Never pay per spawn](../SKILL.md#never-pay-per-spawn). This file holds the warm-up snippet and the volley check.

## Warm-up

On the title screen, draw each gameplay-only model, skinned enemy and particle effect once, inside the camera frustum but hidden under the floor, then remove it after about 1.5 s. The renderer has no occlusion culling, so the hidden copy compiles its shader. Prefabs spawned in bursts: `await ENGINE.spawnAsync` one copy here too, so the file is cached (`genesys-prefabs` → *Spawn from code*).

Source: `.engine/src/nodes/visual/ModelMeshNode.ts`; `.engine/src/entities/GlobalParticleManager.ts` (`spawnVFX`); `.engine/src/systems/TimerSystem.ts` (`setTimeout` in seconds)
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/**
 * pawn: the player pawn. Pawn forward is its local −Z and three's getWorldDirection() returns world +Z,
 * hence negate(). Passing a camera instead? Its getWorldDirection() is already the view direction: drop negate().
 * effects: the game's own one-shot spawners (impact, death burst, pickup), each spawning its effect by its shared name.
 */
export function warmUpGameplay(world: ENGINE.World, pawn: ENGINE.SceneNode, effects: Array<(at: THREE.Vector3) => void>): void {
  const fwd = pawn.getWorldDirection(new THREE.Vector3()).negate().setY(0).normalize();
  const at = pawn.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 8).setY(-2.5); // under the floor, in frustum
  const nodes = [
    ENGINE.ModelMeshNode.create({ isRoot: true, position: at.clone(), physicsOptions: { enabled: false },
      modelUrl: '@project/assets/models/props/SM_Projectile.glb' }),
    ENGINE.ModelMeshNode.create({ isRoot: true, position: at.clone(), physicsOptions: { enabled: false },
      modelUrl: '@project/assets/models/creatures/SKM_Enemy.glb' }),
  ];
  for (const n of nodes) world.add(n);
  for (const spawnEffect of effects) spawnEffect(at.clone());
  world.timerSystem.setTimeout(() => nodes.forEach((n) => n.destroy()), 1.5);
}
```
Call it once the player pawn exists, passing that pawn (`genesys-engine` owns the local-vs-world direction rules).

## Check it

The smoke test fires the main action 30–50 times in a row while Insights is on (`genesys-verification`). The report shows no frame over 2× the median during the volley. A spike on the first shot only means the warm-up missed something; a spike on every shot means something is paid per spawn.
