import * as ENGINE from '@gnsx/genesys.js';

/** Actors already queued for teardown via {@link destroyActorWhenGltfIdle}. */
const gltfIdleDestroyScheduled = new WeakSet<ENGINE.Actor>();

/**
 * Destroy an actor only after all GLTFMeshComponents finish loading (or fail).
 * Avoids engine "ensure failed" from Object3D.add() in async load callbacks.
 */
export function destroyActorWhenGltfIdle(actor: ENGINE.Actor): void {
  if (!actor.getWorld() || gltfIdleDestroyScheduled.has(actor)) {
    return;
  }
  gltfIdleDestroyScheduled.add(actor);

  const pending = actor
    .getComponents(ENGINE.GLTFMeshComponent)
    .filter(mesh => mesh.isLoading());

  if (pending.length === 0) {
    actor.destroy();
    return;
  }

  void Promise.all(pending.map(mesh => mesh.waitForLoad().catch(() => undefined))).then(() => {
    if (actor.getWorld()) {
      actor.destroy();
    }
  });
}
