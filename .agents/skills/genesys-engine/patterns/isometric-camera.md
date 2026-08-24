Use when the user wants a fixed-angle, top-down, or isometric perspective that follows the player.

- Change the camera to THREE.OrthographicCamera.
- Enable camera absolute transform via `useAbsolutePosition` / `useAbsoluteRotation` / `useAbsoluteScale` on the camera Object3D (see [threejs-extension](../references/threejs-extension.md)).
- Manually update the camera position/angle in the tick so it follows the player.
