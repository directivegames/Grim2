import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const REVEAL_RETRY_MS = 16;
const MAX_REVEAL_ATTEMPTS = 8;

/** Returns true when the actor's GLTF mesh is loaded and at least one renderable mesh is attached. */
export function isActorVisualReady(actor: ENGINE.Actor): boolean {
  const visual = actor.getComponent(ENGINE.GLTFMeshComponent);
  if (!visual) return true;

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
  onReady: () => void;
  onFailed: () => void;
}

/** Gate reveal until GLTF mesh is renderable. Fires onFailed if actor is destroyed during wait. */
export function revealActorWhenVisualReady(options: ActorRevealOptions): void {
  const { actor, onReady, onFailed } = options;
  const visual = actor.getComponent(ENGINE.GLTFMeshComponent);

  const tryReveal = (attemptsLeft = MAX_REVEAL_ATTEMPTS): void => {
    if (!actor.getWorld()) { onFailed(); return; }
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
