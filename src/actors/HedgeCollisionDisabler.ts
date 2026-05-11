/**
 * HedgeCollisionDisabler — One-time scan to disable collision on all hedges.
 *
 * At game start, finds all GLTFMeshActor instances using hedgeredon.glb
 * and disables their physics. Runs once then removes itself.
 * Zero ongoing performance cost.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const HEDGE_MODEL_URL = '@project/assets/models/hedgeredon.glb';

@ENGINE.GameClass()
export class HedgeCollisionDisabler extends ENGINE.Actor {
  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    // Delay slightly to ensure all scene actors are initialized
    globalThis.setTimeout(() => {
      this.disableHedgeCollisions();
      // Self-destruct after work is done — zero ongoing cost
      this.destroy();
    }, 100);
  }

  private disableHedgeCollisions(): void {
    const world = this.getWorld();
    if (!world) return;

    let disabledCount = 0;

    for (const actor of world.getActors()) {
      // Check if this is a GLTFMeshActor with the hedge model
      const gltfActor = actor as unknown as {
        modelUrl?: string;
        rootComponent?: {
          physicsOptions?: { enabled?: boolean };
          setPhysicsOptions?: (options: { enabled: boolean }) => void;
        };
      };

      if (gltfActor.modelUrl === HEDGE_MODEL_URL) {
        // Disable physics on the root component
        if (gltfActor.rootComponent) {
          // Try to disable via physics options
          if (gltfActor.rootComponent.physicsOptions) {
            gltfActor.rootComponent.physicsOptions.enabled = false;
          }

          // Also try via setPhysicsOptions if available
          if (gltfActor.rootComponent.setPhysicsOptions) {
            gltfActor.rootComponent.setPhysicsOptions({ enabled: false });
          }
        }

        disabledCount++;
      }
    }

    if (disabledCount > 0) {
      console.log(`[HedgeCollisionDisabler] Disabled collision on ${disabledCount} hedges`);
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }
}
