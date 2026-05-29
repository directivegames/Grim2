import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const REVEAL_RETRY_MS = 16;
const MAX_REVEAL_ATTEMPTS = 8;

/** True when the GLTF mesh is loaded and at least one renderable mesh exists. */
export function isActorVisualReady(actor: ENGINE.Actor): boolean {
  const visual = actor.getComponent(ENGINE.GLTFMeshComponent);
  if (!visual?.isModelLoaded()) {
    return false;
  }

  let hasRenderable = false;
  visual.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      hasRenderable = true;
    }
  });
  return hasRenderable;
}

export interface HordeRevealOptions {
  actor: ENGINE.Actor;
  onReady: () => void;
  onFailed: () => void;
}

/**
 * Reveal an actor only once its GLTF visual is renderable.
 * Retries briefly when isModelLoaded() is true but meshes are not attached yet.
 */
export function revealActorWhenVisualReady(options: HordeRevealOptions): void {
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
