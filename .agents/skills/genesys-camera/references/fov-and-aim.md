# FOV, aim and look feel

The short version is in [SKILL.md → Decide](../SKILL.md#decide) (look feel defaults) and [SKILL.md → Build](../SKILL.md#build). This file holds the look-feel numbers, the FOV kick and aim-down-sights pawn, and the GSS and vehicle variants. Sensitivity and invert-Y code: [camera-system](camera-system.md#look-sensitivity-and-invert-y).

## Look feel defaults

**Look feel defaults.** Every FOV here is the vertical FOV in degrees (`camera.fov`); the engine default `ENGINE.CAMERA_FOV` is 60. Mouse 0.001 rad per pixel (engine default on both stacks), Y not inverted, sensitivity multiplier 0.5–2 on the settings screen when the game has mouse look. Aim-down-sights FOV 45. FOV kick on dash, boost or a big hit: +8–12° (default 10), 0.2 s in, 0.4 s out. Camera lookahead on top-down, side and chase cameras: 10–20 % of the screen toward travel (default 15 %).

## FOV kick and zoom-on-aim

The engine calls `updateProjectionMatrix()` on the active perspective camera every frame, so writing `camera.fov` is enough. Ease it per tick with `MathUtils.damp`, which is frame-rate independent. Right mouse and the right bumper already call `altFire()` on a `DefaultCharacterPawn`.

Source: .engine/src/game/GameLoop.ts (`renderFrame` projection update), .engine/src/entities/DefaultCharacterPawn.ts (`altFire`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export const FOV = { base: 70, aim: 45, kick: 10, aimLambda: 12, kickLambda: 6 }; // λ 12 ≈ 0.2 s in, λ 6 ≈ 0.4 s out (90 %)

@ENGINE.GameClass()
export class AimPlayer extends ENGINE.DefaultCharacterPawn {
  private aiming = false;
  private kick = 0;
  /** Dash, boost, big hit: widen the view, then settle back (~0.4 s). */
  public kickFov(degrees = FOV.kick): void { this.kick = Math.max(this.kick, degrees); }
  // RMB / right bumper call altFire: aim while held, keep any alt-fire equipment working.
  public override altFire(): boolean { super.altFire(); this.aiming = true; return true; }
  public override endAltFire(): boolean { super.endAltFire(); this.aiming = false; return true; }
  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    if (!(this.camera instanceof THREE.PerspectiveCamera)) return;
    this.kick = THREE.MathUtils.damp(this.kick, 0, FOV.kickLambda, dt);
    const target = (this.aiming ? FOV.aim : FOV.base) + this.kick;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, target, FOV.aimLambda, dt);
  }
}
```

On a GSS pawn, catch the right mouse button in a `GSSPlayerController` subclass (`handleMouseDown`/`handleMouseUp`) and set the same flag. A vehicle boost calls `kickFov` on its own pawn the same way. Scale mouse sensitivity by `FOV.aim / FOV.base` while aiming if aim feels twitchy.
