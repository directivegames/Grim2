/**
 * GrassClumpActor — spawns a cluster of 3D grass shard meshes with varied scale and rotation.
 *
 * Visual-only (no physics). Place on ground where grass detail is needed.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const GRASS_SHARD_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/grassshard.glb` as ENGINE.ModelPath;

/** Simple LCG for deterministic clump layout from {@link GrassClumpActor.seed}. */
function createSeededRandom(seed: number): () => number {
  let state = (Math.floor(seed) % 2147483646) + 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

@ENGINE.GameClass()
export class GrassClumpActor extends ENGINE.Actor {
  @ENGINE.property({ type: 'number', min: 1, max: 24, step: 1, category: 'Grass Clump' })
  public bladeCount: number = 7;

  @ENGINE.property({ type: 'number', min: 0.05, max: 3, step: 0.05, category: 'Grass Clump' })
  public spreadRadius: number = 0.35;

  @ENGINE.property({ type: 'number', min: 0.1, max: 3, step: 0.05, category: 'Grass Clump' })
  public scaleMin: number = 0.65;

  @ENGINE.property({ type: 'number', min: 0.1, max: 3, step: 0.05, category: 'Grass Clump' })
  public scaleMax: number = 1.35;

  @ENGINE.property({ type: 'number', min: 0.1, max: 5, step: 0.05, category: 'Grass Clump' })
  public overallScale: number = 1.0;

  @ENGINE.property({ type: 'number', min: -0.15, max: 0.15, step: 0.01, category: 'Grass Clump' })
  public tiltAmount: number = 0.06;

  @ENGINE.property({ type: 'number', category: 'Grass Clump' })
  public seed: number = 42;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
    this.rebuildClump();
  }

  public override postLoad(): void {
    super.postLoad();
    this.rebuildClump();
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    this.rebuildClump();
  }

  protected override doBeginPlay(): void {
    this.rebuildClump();
    super.doBeginPlay();
  }

  private rebuildClump(): void {
    const root = this.rootComponent;
    if (!(root instanceof ENGINE.SceneComponent)) return;

    const existing = root.getComponents(ENGINE.GLTFMeshComponent);
    for (const child of existing) {
      child.removeFromParent();
    }

    const rand = createSeededRandom(this.seed);
    const count = Math.max(1, Math.round(this.bladeCount));
    const spread = Math.max(0.01, this.spreadRadius);
    const sMin = Math.min(this.scaleMin, this.scaleMax);
    const sMax = Math.max(this.scaleMin, this.scaleMax);
    const base = Math.max(0.01, this.overallScale);

    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * spread;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const y = (rand() - 0.5) * 0.02;

      const t = rand();
      const uniformScale = (sMin + (sMax - sMin) * t) * base;
      const scaleY = uniformScale * (0.85 + rand() * 0.35);

      const yaw = rand() * Math.PI * 2;
      const tiltX = (rand() - 0.5) * this.tiltAmount;
      const tiltZ = (rand() - 0.5) * this.tiltAmount;

      const shard = ENGINE.GLTFMeshComponent.create({
        modelUrl: GRASS_SHARD_MODEL_URL,
        position: new THREE.Vector3(x, y, z),
        rotation: new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'),
        scale: new THREE.Vector3(uniformScale, scaleY, uniformScale),
        physicsOptions: { enabled: false },
        castShadow: true,
        receiveShadow: true,
      });

      root.add(shard);
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }
}
