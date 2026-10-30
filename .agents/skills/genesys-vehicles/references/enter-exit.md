# Enter and exit a vehicle

Source: engine demo `.engine/demos/examples/vehicle/` — `player.ts` (`VehicleGamePlayer`),
`base-vehicle.ts` (`BaseVehicle`), `VehicleGamePlayerController.ts`, `game.ts`.
`Controller.possess` / `unpossess`: `.engine/src/entities/Controller.ts`.

There is no seat component and no enter-vehicle method in the engine. Both the on-foot pawn and the
vehicle are real pawns; entering is a possession swap.

## Wiring in the demo

- `game.ts` creates both vehicles, the player pawn, and a `VehicleGamePlayerController`, calls
  `controller.possess(player)`, and adds all of them to the world.
- `VehicleGamePlayerController` extends `DefaultPlayerController`. On `E` it calls
  `tryEnterVehicle()` when the possessed pawn is the player and `exitVehicle()` when it is a vehicle;
  on `F` it calls `flipVehicle()` on the vehicle; every other key goes to `super.handleKeyDown`.
- `BaseVehicle` checks for a nearby player each frame (`onTickPostPhysics`) within
  `interactionDistance` 5 and exposes `canBeEntered()` / `getNearbyPlayer()`.

## Enter

Source: .engine/demos/examples/vehicle/player.ts
```ts
protected enterVehicle(vehicle: BaseVehicle): void {
  const controller = this.getController();
  if (!controller) return;
  vehicle.setEnteredPlayer(this);
  controller.unpossess();
  controller.possess(vehicle);
  this.visible = false;
  vehicle.onPlayerEntered(); // enteredPlayer.setPhysicsEnabled(false, false): root only
}
```

## Exit

Source: .engine/demos/examples/vehicle/base-vehicle.ts
```ts
public exitVehicle(): void {
  if (!this.enteredPlayer) return;
  const controller = this.getController();
  if (!controller) return;
  const exit = this.position.clone()
    .add(new THREE.Vector3(1, 0, 0).applyEuler(this.rotation).multiplyScalar(2).setY(1));
  this.enteredPlayer.position.copy(exit);
  const fwd = this.forwardDirection(); fwd.y = 0; fwd.normalize();
  this.enteredPlayer.rotation.set(0, Math.atan2(fwd.x, fwd.z) + Math.PI, 0); // face the car's heading
  this.enteredPlayer.visible = true;
  this.enteredPlayer.setPhysicsEnabled(true, false);
  controller.unpossess();
  controller.possess(this.enteredPlayer);
  this.enteredPlayer = null;
}
```

## Notes

- The camera handoff is automatic: the world renders the possessed pawn's camera.
- In a shipped game, route the enter prompt and key through the interaction system
  (`genesys-interactions`, `GameplayPawn.interact`) and show the prompt as a widget (`genesys-ui`).
  The demo's controls panel is raw HTML on the document. Build HUD text in the game's UI under `world.gameContainer` (`genesys-ui`).
- The demo's on-foot pawn is a classic `CharacterPawn`, so writing `position` works. A GSS on-foot
  pawn owns its pose in the sim; move it on exit through the sim (`genesys-movement`).
- Before placing the driver, check the exit spot with `overlapShape` (`genesys-physics`) and fall back
  to the other side when it is blocked.
- Multiplayer: the server authorises both possessions; clients request enter/exit by RPC
  (`genesys-multiplayer`).
