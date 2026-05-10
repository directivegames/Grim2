import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const MAX_POINTS     = 12;
const POINT_LIFETIME = 0.22;
const DISC_GEO       = new THREE.CircleGeometry(0.22, 8);

/** Pre-allocated trail disc — reused from a pool to eliminate per-frame GC. */
interface PooledDisc {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  mat:  THREE.MeshBasicMaterial;
  elapsed: number;
}

@ENGINE.GameClass()
export class BoomerangTrailComponent extends ENGINE.SceneComponent {
  private readonly _pool:   PooledDisc[] = [];
  private readonly _active: PooledDisc[] = [];
  private readonly _free:   PooledDisc[] = [];
  private _active_flag = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public override beginPlay(): void {
    super.beginPlay();
    // Pre-build pool immediately so first boomerang throw doesn't hitch
    const world = this.getWorld();
    if (world) {
      this._buildPool(world);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public start(): void  { this._active_flag = true; }
  public stop(): void   { this._active_flag = false; }

  public addPoint(worldPos: THREE.Vector3): void {
    if (!this._active_flag) return;
    const world = this.getWorld();
    if (!world) return;

    // Pool is already built in beginPlay, but check just in case

    let disc: PooledDisc;
    if (this._free.length > 0) {
      disc = this._free.pop()!;
    } else if (this._active.length >= MAX_POINTS) {
      // Evict the oldest (front of active list)
      disc = this._active.shift()!;
    } else {
      // Should never reach here after pool is built, but be safe
      disc = this._createDisc(world);
      this._pool.push(disc);
    }

    disc.elapsed = 0;
    disc.mat.opacity = 0.75;
    disc.mesh.position.copy(worldPos);
    disc.mesh.visible = true;
    this._active.push(disc);
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    for (let i = this._active.length - 1; i >= 0; i--) {
      const p = this._active[i];
      p.elapsed += deltaTime;
      const progress = p.elapsed / POINT_LIFETIME;
      p.mat.opacity = 0.75 * Math.max(0, 1 - progress);

      if (progress >= 1) {
        p.mesh.visible = false;
        // Swap-with-last removal — O(1), no array shifting
        this._active[i] = this._active[this._active.length - 1];
        this._active.pop();
        this._free.push(p);
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const p of this._pool) {
      p.mat.dispose();
      p.mesh.removeFromParent();
    }
    this._pool.length   = 0;
    this._active.length = 0;
    this._free.length   = 0;
    super.endPlay();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _buildPool(world: ENGINE.World): void {
    for (let i = 0; i < MAX_POINTS; i++) {
      const disc = this._createDisc(world);
      this._pool.push(disc);
      this._free.push(disc);
    }
  }

  private _createDisc(world: ENGINE.World): PooledDisc {
    const mat = new THREE.MeshBasicMaterial({
      color:       new THREE.Color(0.55, 0.15, 1.0),
      transparent: true,
      opacity:     0,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(DISC_GEO, mat);
    mesh.rotation.x = -Math.PI / 2; // flat on ground
    mesh.visible = false;
    world.scene.add(mesh);
    return { mesh, mat, elapsed: 0 };
  }
}
