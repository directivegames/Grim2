/**
 * HedgeActor - Visual-only hedge/fence decoration.
 *
 * Physics disabled so both player and zombies can walk through freely.
 * Purely aesthetic — provides environmental detail without blocking movement.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';

import type { PrimitiveNodeOptions } from '@gnsx/genesys.js';

/** hedges were removed from art; wooden fence is the current stand-in decoration */
const HEDGE_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/woodenfence.glb` as ENGINE.ModelPath;

@ENGINE.GameClass()
export class HedgeActor extends GameRootNode {
  /** Uniform model scale (Object3D.scale is a Vector3 on Actor). */
  @ENGINE.property({ type: 'number', min: 0.1, max: 5, step: 0.1, category: 'Hedge' })
  public modelScale: number = 1.0;

  public override initialize(options?: PrimitiveNodeOptions): void {
    const root = ENGINE.ModelMeshNode.create({
      name: 'HedgeVisual',
      modelUrl: HEDGE_MODEL_URL,
      scale: new THREE.Vector3(this.modelScale, this.modelScale, this.modelScale),
      physicsOptions: { enabled: false }, // No collision - walk through
      castShadow: true,
      receiveShadow: true,
    });

    super.initialize(options);
    this.add(root);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }
}
