/**
 * DeadGraveActor - Physics grave that falls when a zombie dies.
 *
 * Uses an invisible box as the physics root so the collider is ready
 * immediately (not dependent on async GLB loading). The GLB is a visual child.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const GRAVE_MODEL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grave.glb` as ENGINE.ModelPath;

// Shared geometry and material reused across every grave to avoid churning
// Three.js buffers/programs when many graves spawn. The material is invisible
// (the physics root is never rendered) — the visible GLB is a child.
// NOTE: Geometry sized for 0.2 GLB scale (was 0.35,0.55,0.15 for 0.1 scale)
const SHARED_ROOT_GEOMETRY = new THREE.BoxGeometry(0.7, 1.1, 0.3);
const SHARED_ROOT_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

@ENGINE.GameClass()
export class DeadGraveActor extends ENGINE.Actor {

  public override initialize(options?: ActorOptions): void {
    // Invisible box as the physics root - ready immediately, no async loading needed
    const root = ENGINE.MeshComponent.create({
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Dynamic,
        collisionProfile: ENGINE.DefaultCollisionProfile.BlockAllDynamic,
        gravityScale: 1.0,
      },
    });

    // Random rotation for variety
    root.rotation.y = Math.random() * Math.PI * 2;

    // GLB is visual only - no physics on the mesh itself
    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: GRAVE_MODEL_URL,
      scale: new THREE.Vector3(0.2, 0.2, 0.2),
      physicsOptions: { enabled: false },
      castShadow: true,
    });

    root.add(visual);

    super.initialize({ ...options, rootComponent: root });
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }
}
