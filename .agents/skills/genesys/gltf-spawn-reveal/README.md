# gltf-spawn-reveal

Extracted from Grim2's horde spawn system (`src/horde/horde-spawn-utils.ts`).

## Why this pattern is necessary

In a Genesys project, GLTF models load asynchronously. An actor can exist in the world with its physics body active before its mesh has attached to the scene graph. Unhiding such an actor shows a floating invisible object — the physics capsule moves and collides but nothing renders for that frame (or several frames).

The specific failure mode in pooled enemy systems: the actor is hidden, parked at (0, -1000, 0), and a new spawn is requested. The manager calls `softReset(position)` to move it and unhide it. If the GLTF hasn't loaded yet, the mesh stays invisible even after unhide. With 60+ pooled actors being recycled rapidly, this happens frequently on first load and after returning from a background tab.

## Why 8 retries at 16ms

After `waitForLoad()` resolves, Three.js needs at least one frame to attach the parsed mesh objects to the scene graph. A single 16ms retry is usually enough. The 8-retry cap (~130ms total) covers cases where the GPU is busy with multiple uploads simultaneously. Beyond 130ms, the model has likely failed to parse or the actor has been destroyed.

## Pre-loading as the real fix

`revealActorWhenVisualReady` is a safety net, not the primary solution. The primary solution is to call `ENGINE.resourceManager.loadModel(url)` before the first spawn, during scene load or at horde activation. When the model is pre-loaded, the readiness check passes on the first attempt with no retry delay. Use both: pre-load where possible, reveal-gate as the fallback.

## Source

Direct copy of `src/horde/horde-spawn-utils.ts` in Grim2. Renamed `HordeRevealOptions` to `ActorRevealOptions` and added a `true` fast-path for actors with no `GLTFMeshComponent`. No logic was changed.
