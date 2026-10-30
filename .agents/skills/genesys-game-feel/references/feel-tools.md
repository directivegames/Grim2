# Feel tools: shake, hit flash, hitstop

The short version is in [SKILL.md → Build](../SKILL.md#build). The engine has no screen shake, hit flash or hitstop; these three small runtime tools fill the gap. Numbers come from SKILL.md → *Defaults*.

## Screen shake

Decaying noise on the active camera's **local** position and rotation. Every engine rig moves the camera's parent (`SpringArmNode` sets its own position, `FollowNode` its own position and look-at, `CharacterPawn` rotates the pivot) and never writes the camera's local transform, so the offset rides on top of any rig. Add one node to the world at Play start and call `addTrauma` from gameplay.

Source: .engine/src/nodes/movement/SpringArmNode.ts, .engine/src/nodes/FollowNode.ts, .engine/src/entities/CharacterPawn.ts (`setupCamera`) — composed, typechecked against 18.1.0-alpha.317
```ts
const SHAKE_SECONDS = 0.18;   // trauma 1 → 0
const SHAKE_OFFSET = 0.12;    // m at trauma 1
const SHAKE_ANGLE = 0.03;     // rad (~1.7°) at trauma 1

/** One per world. addTrauma(0.3) small hit, 0.6 explosion, 1.0 player death. */
@ENGINE.GameClass()
export class CameraShakeNode extends ENGINE.SceneNode {
  private trauma = 0;
  private time = 0;
  private camera: THREE.Camera | null = null;
  private readonly basePos = new THREE.Vector3();
  private readonly baseRot = new THREE.Euler();

  public addTrauma(amount: number): void {
    if (this.trauma === 0) {                       // capture the rest pose once per shake
      this.camera = this.getWorld()?.getActiveCamera() ?? null;
      if (!this.camera) return;
      this.basePos.copy(this.camera.position);
      this.baseRot.copy(this.camera.rotation);
    }
    this.trauma = Math.min(1, this.trauma + amount);
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    const cam = this.camera;
    if (!cam || this.trauma === 0) return;
    this.trauma = Math.max(0, this.trauma - deltaTime / SHAKE_SECONDS);
    const s = this.trauma * this.trauma;           // trauma² falloff
    const t = (this.time += deltaTime) * 30;
    const n = (a: number, b: number): number => Math.sin(t * a + b) * 0.6 + Math.sin(t * 2.31 * a + b) * 0.4;
    cam.position.set(this.basePos.x + SHAKE_OFFSET * s * n(1.0, 0.0),
      this.basePos.y + SHAKE_OFFSET * s * n(1.13, 1.7), this.basePos.z);
    cam.rotation.set(this.baseRot.x + SHAKE_ANGLE * s * n(0.91, 3.1),
      this.baseRot.y + SHAKE_ANGLE * s * n(1.07, 4.3), this.baseRot.z + SHAKE_ANGLE * s * n(0.83, 5.9));
    if (this.trauma === 0) { cam.position.copy(this.basePos); cam.rotation.copy(this.baseRot); this.camera = null; }
  }
}
```

## Hit flash and scale pop

Flash only a material this instance owns. `ModelMeshNode` shares the loaded GLB's materials across instances, so flashing one flashes every enemy of that model. `useDynamicMaterials: true` makes the engine clone this instance's materials once, when the model loads in Play. Scale pop needs no material and costs nothing; it is the default for crowds (10+ alive), since per-instance materials also break batching (`genesys-profiler`).

Source: .engine/src/nodes/visual/ModelMeshNode.ts (`useDynamicMaterials`, `cloneMaterials`), .engine/src/systems/TweenManager.ts — composed, typechecked against 18.1.0-alpha.317
```ts
// At spawn: the engine clones this instance's materials once when the model loads in Play.
export const enemyBody = ENGINE.ModelMeshNode.create({
  modelUrl: '@engine/assets/models/SM_Capsule.glb',  // blockout; the real enemy model
  useDynamicMaterials: true,
});

/** White emissive flash for ~120 ms. Only on a ModelMeshNode created with useDynamicMaterials. */
export function hitFlash(model: ENGINE.ModelMeshNode, seconds = 0.12): void {
  const lit: { color: THREE.Color; was: THREE.Color }[] = [];
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of [o.material].flat()) {
      const emissive = (m as { emissive?: unknown }).emissive;
      if (emissive instanceof THREE.Color) lit.push({ color: emissive, was: emissive.clone() });
    }
  });
  for (const e of lit) e.color.setRGB(1, 1, 1);
  world.timerSystem.setTimeout(() => { for (const e of lit) e.color.copy(e.was); }, seconds);
}

/** Scale pop 1 → 1.15 → 1 over ~120 ms. Free: no material change. */
export function scalePop(node: ENGINE.SceneNode, peak = 1.15, ms = 120): void {
  const base = node.scale.clone();
  const s = { k: 1 };
  world.tweenManager.createTween(s)
    .to({ k: peak }, ms / 2).yoyo(true).repeat(1)
    .onUpdate(() => node.scale.copy(base).multiplyScalar(s.k))
    .onComplete(() => node.scale.copy(base))
    .start(world.tweenManager.getCurrentTime());
}
```

Pop the visual child (the model), not a physics root: scaling a root rescales its collider. Restore the pose in `onComplete` so overlapping pops never drift the scale.

## Hitstop

`World.pause` and `slomo` are private console commands. Freeze only the two bodies in the exchange: `setTickEnabled(false)` stops a node's `tickPrePhysics` and `tickPostPhysics` (`TickManager` skips it), and `AnimationStateMachineNode` advances its mixer only in `tickPostPhysics`, so the pose holds. The tick manager hands a re-enabled node a normal frame delta, so nothing jumps on release.

Source: .engine/src/nodes/SceneNode.ts (`setTickEnabled`), .engine/src/game/TickManager.ts, .engine/src/nodes/visual/AnimationStateMachineNode.ts (`tickPostPhysics` → `mixer.update`), .engine/src/systems/TimerSystem.ts — composed, typechecked against 18.1.0-alpha.317
```ts
/**
 * Freeze attacker and victim for 40–60 ms (80–120 ms for a boss hit or the player's death).
 * Everything else keeps running. Single-player or local-only visuals; never online sim state.
 */
export function hitstop(world: ENGINE.World, roots: ENGINE.SceneNode[], seconds = 0.05): void {
  const frozen: ENGINE.SceneNode[] = [];
  for (const root of roots) {
    const nodes = [root, ...root.getNodes(ENGINE.BasePawnMovementNode),
      ...root.getNodes(ENGINE.AnimationStateMachineNode)];
    for (const node of nodes) {
      if (!node.isTickEnabled()) continue;          // already frozen by an earlier hit
      node.setTickEnabled(false);                    // stops tickPre/PostPhysics; anim mixer stops advancing
      frozen.push(node);
    }
  }
  world.timerSystem.setTimeout(() => { for (const n of frozen) n.setTickEnabled(true); }, seconds);
}
```

Projectiles, particles, other enemies and the music keep running, which is what makes it read as impact rather than lag. On a GSS pawn this freezes the animation but the simulation keeps stepping (verify in Play); online, hitstop is visual and local only and never pauses other players (`genesys-multiplayer`).
