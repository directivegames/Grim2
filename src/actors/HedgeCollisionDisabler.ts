/**
 * HedgeCollisionDisabler — One-time scan to disable collision on walk-through decorations.
 *
 * At game start, finds GLTF mesh actors whose model filename matches the old hedge
 * asset (removed from art) and disables their physics. Runs once then removes itself.
 * Zero ongoing performance cost.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';

import type { PrimitiveNodeOptions } from '@gnsx/genesys.js';

/** Filename only — avoid embedding a missing @project asset path in the bundle. */
const HEDGE_MODEL_FILENAME = 'hedgeredon.glb';

@ENGINE.GameClass()
export class HedgeCollisionDisabler extends GameRootNode {
  public override initialize(options?: PrimitiveNodeOptions): void {
    const root = ENGINE.SceneNode.create({ name: 'Root' });
    super.initialize(options);
    this.add(root);
  }

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }// Delay slightly to ensure all scene actors are initialized
    globalThis.setTimeout(() => {
      this.disableHedgeCollisions();
      // Self-destruct after work is done — zero ongoing cost
      this.destroy();
    }, 100);
  
    return true;
  }

  private disableHedgeCollisions(): void {
    const world = this.getWorld();
    if (!world) return;

    let disabledCount = 0;

    for (const actor of world.getRootNodes()) {
      // Check if this is a GLTFMeshActor with the hedge model
      const gltfActor = actor as unknown as {
        modelUrl?: string;
        physicsOptions?: { enabled?: boolean };
        setPhysicsOptions?: (options: { enabled: boolean }) => void;
      };

      if (gltfActor.modelUrl?.endsWith(HEDGE_MODEL_FILENAME)) {
        // Disable physics on the placeable root
        if (gltfActor.physicsOptions) {
          gltfActor.physicsOptions.enabled = false;
        }

        if (gltfActor.setPhysicsOptions) {
          gltfActor.setPhysicsOptions({ enabled: false });
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
