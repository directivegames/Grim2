/**
 * HedgeActor - Visual-only hedge decoration.
 *
 * Physics disabled so both player and zombies can walk through freely.
 * Purely aesthetic — provides environmental detail without blocking movement.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const HEDGE_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/hedgeredon.glb` as ENGINE.ModelPath;

@ENGINE.GameClass()
export class HedgeActor extends ENGINE.Actor {
  @ENGINE.property({ type: 'number', min: 0.1, max: 5, step: 0.1, category: 'Hedge' })
  public scale: number = 1.0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.GLTFMeshComponent.create({
      modelUrl: HEDGE_MODEL_URL,
      scale: new THREE.Vector3(this.scale, this.scale, this.scale),
      physicsOptions: { enabled: false }, // No collision - walk through
      castShadow: true,
      receiveShadow: true,
    });

    super.initialize({ ...options, rootComponent: root });
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }
}
