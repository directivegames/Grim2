# Aim Resolution Reference

## Mouse to world direction

To launch the boomerang toward the mouse cursor, cast a ray from the camera through the NDC mouse position onto a horizontal plane at the player's Y.

```ts
const raycaster   = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mouseHit    = new THREE.Vector3();
const playerPos   = new THREE.Vector3();

function resolveAimDirection(world, player, out) {
  const camera = world.getActiveCamera();
  const ndcMouse = world.inputManager.getMousePosition();
  player.rootComponent.getWorldPosition(playerPos);

  // Push the plane to match the player's height
  groundPlane.constant = -playerPos.y;
  raycaster.setFromCamera(ndcMouse, camera);

  if (raycaster.ray.intersectPlane(groundPlane, mouseHit)) {
    const dx = mouseHit.x - playerPos.x;
    const dz = mouseHit.z - playerPos.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.01) {
      out.set(dx / len, 0, dz / len);
      return;
    }
  }

  // Fallback: use player facing yaw
  const yaw = player.getFacingYaw?.() ?? 0;
  out.set(Math.sin(yaw), 0, Math.cos(yaw));
}
```

`resolveAimDirection` is also exported from `BoomerangSystem.ts`.

## Launch offset

Spawn the blade slightly ahead of the player rather than at the player center. This prevents self-hits on launch:

```ts
player.rootComponent.getWorldPosition(launchPos);
launchPos.y += BOOMERANG_HEIGHT;           // e.g. 0.8 units above feet
launchPos.addScaledVector(dir, LAUNCH_OFFSET); // e.g. 0.5 units forward
this._boomerang.launch(launchPos, dir, { bladeCount: 3 });
```

## Fan spread

Three blades with a half-angle of 0.35 rad (~20°) produce a spread of 40° total. The outer blades hit targets that a single blade would miss, making the ability feel high-impact at level 2.

Yaw offsets for three blades: `[-0.35, 0, 0.35]`.

Use `rotateDirAroundY(dir, yawOffset, out)` (exported from `BoomerangSystem.ts`) to compute each blade's direction.

## Mobile aim

On touch devices the mouse position is often not meaningful. Substitute the player's movement joystick direction or the player's facing yaw:

```ts
const yaw = player.getMovementYaw?.() ?? 0;
out.set(Math.sin(yaw), 0, Math.cos(yaw));
```
