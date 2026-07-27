---
name: gltf-spawn-reveal
description: Use when spawning or respawning actors whose GLTF model loads asynchronously in a Genesys project. Covers a readiness check that waits until the mesh is loaded and renderable before calling your reveal callback, with automatic retry and failure fallback.
---

Copy [assets/GltfSpawnReveal.ts](assets/GltfSpawnReveal.ts) into your project.

## The problem this solves

Unhiding an actor before its GLTF mesh has finished loading shows an invisible physics body that moves but renders nothing. Calling `softReset` on a hidden actor whose mesh is mid-load causes the first frame of its animation to be skipped. This utility gates the reveal until the mesh is confirmed renderable.

## Basic usage

```ts
import { revealActorWhenVisualReady } from './GltfSpawnReveal.js';

// Hide the actor first, then immediately gate the reveal:
actor.setHiddenInGame(true);

revealActorWhenVisualReady({
  actor,
  onReady: () => {
    actor.softReset(spawnPosition);
    actor.setHiddenInGame(false);
    // play VFX, audio, etc.
  },
  onFailed: () => {
    // mesh never became ready — re-queue or destroy
    actor.destroy();
  },
});
```

## Retry behaviour

1. If the actor has no `GLTFMeshComponent`, `onReady` fires immediately on the next frame.
2. If the model is already loaded and meshes are attached, `onReady` fires immediately.
3. If the model is loading, the utility waits for `waitForLoad()` then checks for renderable meshes.
4. If the model is loaded but meshes are not yet attached to the scene graph, it retries up to 8 times at 16ms intervals.
5. If all retries fail, `onFailed` fires.

## Check readiness without a callback

```ts
import { isActorVisualReady } from './GltfSpawnReveal.js';

if (isActorVisualReady(actor)) {
  // safe to unhide and show
}
```

## Constraints

- `onReady` and `onFailed` both fire asynchronously. Do not assume they run before the next frame.
- Always check `actor.getWorld()` inside `onReady` — the actor may have been destroyed while waiting (e.g. mission reset). If `getWorld()` returns null, do nothing.
- `onFailed` fires if the actor is destroyed while waiting (its world reference becomes null). Always handle `onFailed` — silence it only if you are certain the actor lifetime exceeds the retry window.
- If an actor's model is pre-loaded via `ENGINE.resourceManager.loadModel()` before spawning, the readiness check completes in one pass with no retry delay.
