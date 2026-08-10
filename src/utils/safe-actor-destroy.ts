import * as ENGINE from '@gnsx/genesys.js';

/** Roots already queued for teardown via {@link destroyActorWhenGltfIdle}. */
const gltfIdleDestroyScheduled = new WeakSet<ENGINE.SceneNode>();

/**
 * Destroy a root only after all GLTFMeshComponents finish loading (or fail).
 * Avoids engine "ensure failed" from Object3D.add() in async load callbacks.
 */
export function destroyActorWhenGltfIdle(actor: ENGINE.SceneNode): void {
  if (!actor.getWorld() || gltfIdleDestroyScheduled.has(actor)) {
    return;
  }
  gltfIdleDestroyScheduled.add(actor);

  const pending = actor
    .getNodes(ENGINE.ModelMeshNode)
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
