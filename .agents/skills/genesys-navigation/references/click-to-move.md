# Click-to-move

The short version is in [SKILL.md → Click-to-move](../SKILL.md#click-to-move).

Ray from the camera through the click, snap the hit to the navmesh, hand it to the hero's `NpcMovementNode`. The hero is any `CharacterPawn` whose `createMovementNode` returns an `NpcMovementNode` (it extends `CharacterMovementNode`, so WASD still works). The controller consumes left click, so left click no longer fires.

Source: .engine/src/entities/DefaultPlayerController.ts (`handleMouseDown`), .engine/src/navigation/NavigationServer.ts, .engine/src/nodes/movement/NpcMovementNode.ts, .engine/demos/examples/plugin-demo/plugins/tic-tac-toe.ts (click ray)
```ts
@ENGINE.GameClass()
export class ClickMoveHero extends ENGINE.DefaultCharacterPawn {
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.NpcMovementNode.create({
      maxSpeed: 6, lookRightSpeed: 10, stopDistance: 0.3,
      pathFollowingAccuracy: 0.5, actorFollowingDistance: 4,
    });
  }
}

@ENGINE.GameClass()
export class ClickMoveController extends ENGINE.DefaultPlayerController {
  private readonly raycaster = new THREE.Raycaster();

  public override handleMouseDown(button: ENGINE.MouseButton, e: MouseEvent): boolean {
    const world = this.getWorld();
    const camera = world?.getActiveCamera();
    const pawn = this.getPawn();
    const mover = pawn instanceof ENGINE.MovementPawn ? pawn.movementNode : null;
    if (button !== ENGINE.MouseButton.Left || !world || !camera || !pawn
      || !(mover instanceof ENGINE.NpcMovementNode)) {
      return super.handleMouseDown(button, e);
    }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, camera);
    const hit = pawn.getPhysicsEngine()?.raycast({
      origin: this.raycaster.ray.origin, direction: this.raycaster.ray.direction,
      maxDistance: 500, ignoredRootNodes: [pawn] });
    if (!hit) return true;                                // clicked the sky

    const nav = world.gameLoop?.navigationServer;
    const goal = nav?.isReady()
      ? nav.getClosestPointOnNavigationMesh(hit.hitLocation, { maxSnapDistance: 2 })
      : hit.hitLocation;                                  // no navmesh: straight line
    mover.setTargetPosition(goal, 0.3);                   // stop 0.3 m short
    return true;                                          // consumed: no fire on left click
  }
}
```

Register both in the GameMode's pawn and controller factories (`genesys-game-boot`). `NpcMovementNode` turns the pawn with look input, so the camera must not inherit the pawn's yaw: use a fixed top-down or isometric rig with the cursor visible (`genesys-camera`). Show a marker at `goal` for 0.5 s so the click reads (`genesys-vfx`). A GSS hero cannot use this: its `GSSPlayerController` owns the input, and `AIController.moveToPosition(dest, acceptanceRadius)` (the GSS path follower) only drives a pawn it possesses, so it cannot steer the player's possessed hero. Use `DefaultCharacterPawn` for click-to-move; keep `AIController` for GSS NPCs. Verify in Play that WASD and click-to-move do not fight.

## Limitations

- Click-to-move hero spins the camera → the camera inherits the pawn's yaw → fixed rig (`genesys-camera`).

## Traps

- Click-to-move does nothing → the click ray hit the pawn or a trigger, or the hit snapped more than `maxSnapDistance` from any poly, so `calculatePath` got an off-mesh point and returned `[]` → ignore the pawn root in the ray (`ignoredRootNodes`), keep triggers out (`includeTriggers` defaults false), raise `maxSnapDistance` to 2–3 m.
