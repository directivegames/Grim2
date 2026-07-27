import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const REVEAL_RETRY_MS = 16;
const MAX_REVEAL_ATTEMPTS = 8;

/**
 * Returns true when the actor's GLTF mesh is loaded and at least one
 * renderable mesh is attached to the scene graph.
 *
 * Returns true immediately if the actor has no GLTFMeshComponent.
 */
export function isActorVisualReady(actor: ENGINE.Actor): boolean {
  const visual = actor.getComponent(ENGINE.GLTFMeshComponent);
  if (!visual) return true; // no GLTF component — treat as always ready

  if (!visual.isModelLoaded()) return false;

  let hasRenderable = false;
  visual.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      hasRenderable = true;
    }
  });
  return hasRenderable;
}

export interface ActorRevealOptions {
  actor: ENGINE.Actor;
  /** Called once when the actor's visual is confirmed renderable. */
  onReady: () => void;
  /** Called if the actor is destroyed or all retries are exhausted. */
  onFailed: () => void;
}

/**
 * Gate the reveal of an actor until its GLTF mesh is loaded and renderable.
 *
 * Fires onReady once the mesh is ready (may be synchronous if already loaded).
 * Fires onFailed if the actor is destroyed while waiting, or if all retries fail.
 *
 * Always check actor.getWorld() inside onReady — the actor may have been
 * destroyed by a mission reset during the async wait.
 */
export function revealActorWhenVisualReady(options: ActorRevealOptions): void {
  const { actor, onReady, onFailed } = options;
  const visual = actor.getComponent(ENGINE.GLTFMeshComponent);

  const tryReveal = (attemptsLeft = MAX_REVEAL_ATTEMPTS): void => {
    if (!actor.getWorld()) {
      onFailed();
      return;
    }

    if (!isActorVisualReady(actor)) {
      if (attemptsLeft > 0) {
        window.setTimeout(() => tryReveal(attemptsLeft - 1), REVEAL_RETRY_MS);
        return;
      }
      onFailed();
      return;
    }

    onReady();
  };

  if (!visual || visual.isModelLoaded()) {
    tryReveal();
    return;
  }

  void visual.waitForLoad().then(() => tryReveal()).catch(() => onFailed());
}
