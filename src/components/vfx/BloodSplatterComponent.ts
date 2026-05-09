/**
 * BloodSplatterComponent — optimized blood VFX with material/mesh pooling.
 *
 * PERFORMANCE: All materials and meshes are pre-created to avoid per-burst
 * GPU allocations. Only transforms and velocities are dynamic.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PARTICLE_LIFETIME = 0.55;
const SPLATTER_COUNT    = 6;  // Reduced from 12 for performance
const MAX_POOL_SIZE     = 50; // Maximum pooled meshes

// Circle geometry for round blood drops — single shared instance
const DROP_GEO = new THREE.CircleGeometry(0.18, 8); // Reduced segments (10 -> 8)

// PRE-CREATED SHARED MATERIALS — never disposed, never re-created
const SHARED_MATERIALS = [
  new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: false, depthWrite: true, side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: 0xff1111, transparent: false, depthWrite: true, side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: false, depthWrite: true, side: THREE.DoubleSide }),
];

/** Shared scratch vectors for orientation math in burst(). */
const _up   = new THREE.Vector3(0, 1, 0);
const _dir  = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _scratchPos = new THREE.Vector3();

interface BloodDrop {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  velocity: THREE.Vector3;
  active: boolean;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

@ENGINE.GameClass()
export class BloodSplatterComponent extends ENGINE.SceneComponent {
  private readonly _drops: BloodDrop[] = [];
  private readonly _meshPool: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];
  private _poolIndex = 0;

  public override initialize(options?: ENGINE.SceneComponentOptions): void {
    super.initialize(options);

    // PRE-WARM: Create mesh pool at initialization to avoid runtime allocation
    for (let i = 0; i < MAX_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(DROP_GEO, SHARED_MATERIALS[0]);
      mesh.visible = false;
      this._meshPool.push(mesh);
    }
  }

  public override beginPlay(): void {
    super.beginPlay();

    // Add pooled meshes to scene once (they stay in scene graph, just toggle visibility)
    const world = this.getWorld();
    if (world) {
      for (const mesh of this._meshPool) {
        world.scene.add(mesh);
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public burst(worldPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    for (let i = 0; i < SPLATTER_COUNT; i++) {
      // Get next available mesh from pool (round-robin)
      const mesh = this._getPooledMesh();
      if (!mesh) break; // Pool exhausted

      // Random material from shared set
      mesh.material = SHARED_MATERIALS[Math.floor(Math.random() * SHARED_MATERIALS.length)];

      // Position and reset
      mesh.position.copy(worldPos);
      mesh.position.y += randomBetween(0.2, 0.7);
      mesh.visible = true;

      // Random velocity with upward/outward bias
      const angle  = randomBetween(0, Math.PI * 2);
      const upBias = randomBetween(0.6, 1.2);
      const speed  = randomBetween(5, 11);
      const outwardBias = 1.3;

      _scratchPos.set(
        Math.cos(angle) * speed * outwardBias,
        upBias * speed,
        Math.sin(angle) * speed * outwardBias,
      );

      // Orient drop along velocity
      _dir.copy(_scratchPos).normalize();
      _axis.crossVectors(_up, _dir).normalize();
      const ang = Math.acos(Math.min(1, _up.dot(_dir)));
      if (_axis.lengthSq() > 0.001) {
        mesh.quaternion.setFromAxisAngle(_axis, ang);
      }

      // Track this drop
      const existing = this._drops.find(d => d.mesh === mesh);
      if (existing) {
        existing.elapsed = 0;
        existing.velocity.copy(_scratchPos);
        existing.active = true;
      } else {
        this._drops.push({
          mesh,
          elapsed: 0,
          velocity: _scratchPos.clone(),
          active: true,
        });
      }
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateDrops(deltaTime);
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _getPooledMesh(): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null {
    // Round-robin through pool
    const mesh = this._meshPool[this._poolIndex];
    this._poolIndex = (this._poolIndex + 1) % MAX_POOL_SIZE;
    return mesh ?? null;
  }

  private _updateDrops(deltaTime: number): void {
    const drops = this._drops;
    let writeIndex = 0;

    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      if (!drop.active) continue;

      drop.elapsed += deltaTime;
      const progress = drop.elapsed / PARTICLE_LIFETIME;

      // Physics update
      drop.velocity.y -= 12 * deltaTime;
      drop.mesh.position.x += drop.velocity.x * deltaTime;
      drop.mesh.position.y += drop.velocity.y * deltaTime;
      drop.mesh.position.z += drop.velocity.z * deltaTime;

      if (progress >= 1) {
        // Deactivate (hide) instead of destroying
        drop.mesh.visible = false;
        drop.active = false;
      } else {
        // Keep active drops packed at front of array
        if (writeIndex !== i) {
          drops[writeIndex] = drop;
        }
        writeIndex++;
      }
    }

    // Trim inactive entries (they're at the end now)
    drops.length = writeIndex;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const mesh of this._meshPool) {
      mesh.visible = false;
    }
    this._drops.length = 0;
    super.endPlay();
  }
}
