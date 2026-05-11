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

/** Ensure grave collision profile exists — blocks everything except Pawn. */
function ensureGraveCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile('DeadGraveNoPawnBlock');
  if (existing) return;

  const profile = new ENGINE.CollisionProfile(
    'DeadGraveNoPawnBlock',
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.WorldDynamic,
    [
      { channel: ENGINE.CollisionChannel.WorldStatic, response: ENGINE.CollisionResponse.Block },
      { channel: ENGINE.CollisionChannel.WorldDynamic, response: ENGINE.CollisionResponse.Block },
      { channel: ENGINE.CollisionChannel.Pawn, response: ENGINE.CollisionResponse.Ignore },
    ]
  );
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

/** Seconds before grave auto-destroys to prevent physics/shadow accumulation. */
const GRAVE_LIFETIME_SEC = 30;

/** Max simultaneous graves — oldest gets recycled when limit hit. */
const MAX_GRAVES = 25;

// Grave pool management
interface PooledGrave {
  actor: DeadGraveActor;
  spawnTime: number;
}

let gravePool: PooledGrave[] = [];

@ENGINE.GameClass()
export class DeadGraveActor extends ENGINE.Actor {
  private _spawnTime = 0;
  private _isPooled = false;

  public override initialize(options?: ActorOptions): void {
    ensureGraveCollisionProfile();

    // Invisible box as the physics root - ready immediately, no async loading needed
    // Use custom collision profile that ignores Pawn so zombies can walk through graves
    const root = ENGINE.MeshComponent.create({
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Dynamic,
        collisionProfile: 'DeadGraveNoPawnBlock',
        gravityScale: 3.5,
        density: 3.0,
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

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    this._spawnTime = performance.now();

    // Apply heavy damping so the gravestone settles quickly and feels weighty
    const physics = this.getPhysicsEngine();
    const root = this.rootComponent as ENGINE.MeshComponent;
    if (physics && root) {
      // Use string literals that match the enum values
      type ScalarParam = 'linearDamping' | 'angularDamping' | 'gravityScale';
      physics.setScalarParam(root, 'linearDamping' as ScalarParam as any, 0.6);
      physics.setScalarParam(root, 'angularDamping' as ScalarParam as any, 0.8);
    }
  }

  public override tickPrePhysics(_deltaTime: number): void {
    super.tickPrePhysics(_deltaTime);
    // Auto-cleanup after lifetime to prevent physics/shadow accumulation
    if (performance.now() - this._spawnTime > GRAVE_LIFETIME_SEC * 1000) {
      this.destroy();
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }

  /**
   * Spawn a grave at the given position with velocity.
   * Uses pooling — recycles oldest grave if at cap.
   */
  public static spawnAt(
    world: ENGINE.World,
    position: THREE.Vector3,
    velocity?: THREE.Vector3
  ): DeadGraveActor {
    // Clean up destroyed graves from pool (check if actor is still in world)
    gravePool = gravePool.filter(g => g.actor.getWorld() !== null);

    // If at cap, recycle the oldest grave
    if (gravePool.length >= MAX_GRAVES) {
      // Sort by spawn time, oldest first
      gravePool.sort((a, b) => a.spawnTime - b.spawnTime);
      const oldest = gravePool.shift();
      if (oldest) {
        oldest.actor.recycle(position, velocity);
        gravePool.push({ actor: oldest.actor, spawnTime: performance.now() });
        return oldest.actor;
      }
    }

    // Create new grave
    const grave = DeadGraveActor.create({ position: position.clone() });
    grave._isPooled = true;
    world.addActor(grave);

    // Apply velocity if provided
    if (velocity) {
      const physics = world.getPhysicsEngine();
      const root = grave.rootComponent as ENGINE.MeshComponent;
      if (physics && root) {
        type VectorParam = 'linearVelocity' | 'angularVelocity';
        physics.setVectorParam(root, 'linearVelocity' as VectorParam as any, velocity.toArray() as [number, number, number]);
      }
    }

    gravePool.push({ actor: grave, spawnTime: performance.now() });
    return grave;
  }

  /**
   * Recycle this grave to a new position with new velocity.
   */
  private recycle(position: THREE.Vector3, velocity?: THREE.Vector3): void {
    // Reset position
    this.rootComponent.position.copy(position);
    this.rootComponent.updateMatrixWorld();

    // Reset rotation for variety
    this.rootComponent.rotation.y = Math.random() * Math.PI * 2;

    // Reset spawn time
    this._spawnTime = performance.now();

    // Apply new velocity
    const world = this.getWorld();
    if (world && velocity) {
      const physics = world.getPhysicsEngine();
      const root = this.rootComponent as ENGINE.MeshComponent;
      if (physics && root) {
        type VectorParam = 'linearVelocity' | 'angularVelocity';
        physics.setVectorParam(root, 'linearVelocity' as VectorParam as any, velocity.toArray() as [number, number, number]);
      }
    }
  }
}
