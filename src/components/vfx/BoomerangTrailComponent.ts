import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const MAX_POINTS     = 12;
const POINT_LIFETIME = 0.22;
const DISC_GEO       = new THREE.PlaneGeometry(0.44, 0.44); // Slightly larger for soft texture

/** Path to soft glow texture for trail discs. */
const GLOW_TEXTURE_PATH = '@project/assets/textures/vfx/DustPuffSoft.png';

/** Pre-allocated trail disc — reused from a pool to eliminate per-frame GC. */
interface PooledDisc {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  mat:  THREE.MeshBasicMaterial;
  elapsed: number;
}

@ENGINE.GameClass()
export class BoomerangTrailComponent extends ENGINE.SceneComponent {
  private readonly _pool:   PooledDisc[] = [];
  private readonly _active: PooledDisc[] = [];
  private readonly _free:   PooledDisc[] = [];
  private _active_flag = false;

  // Shared texture - loaded once
  private _glowTexture: THREE.Texture | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public override initialize(options?: ENGINE.SceneComponentOptions): void {
    super.initialize(options);
  }

  public override async beginPlay(): Promise<void> {
    super.beginPlay();
    // Pre-build pool immediately so first boomerang throw doesn't hitch
    const world = this.getWorld();
    if (world) {
      await this._buildPool(world);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public start(): void  { this._active_flag = true; }
  public stop(): void   { this._active_flag = false; }

  public async addPoint(worldPos: THREE.Vector3): Promise<void> {
    if (!this._active_flag) return;
    const world = this.getWorld();
    if (!world) return;

    // Build pool if not ready yet
    if (this._pool.length === 0) {
      await this._buildPool(world);
    }

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

    // Dispose shared texture
    if (this._glowTexture) {
      this._glowTexture.dispose();
      this._glowTexture = null;
    }

    super.endPlay();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _buildPool(world: ENGINE.World): Promise<void> {
    // Load texture once
    if (!this._glowTexture) {
      try {
        const resolvedPath = await ENGINE.resolveAssetPathsInText(GLOW_TEXTURE_PATH);
        this._glowTexture = await new Promise<THREE.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(
            resolvedPath,
            (texture) => {
              texture.wrapS = THREE.ClampToEdgeWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
              resolve(texture);
            },
            undefined,
            (err) => reject(err)
          );
        });
      } catch (e) {
        console.warn('[BoomerangTrailComponent] Failed to load glow texture, using fallback:', e);
      }
    }

    for (let i = 0; i < MAX_POINTS; i++) {
      const disc = this._createDisc(world);
      this._pool.push(disc);
      this._free.push(disc);
    }
  }

  private _createDisc(world: ENGINE.World): PooledDisc {
    const mat = new THREE.MeshBasicMaterial({
      color:       new THREE.Color(0.55, 0.15, 1.0), // purple glow
      transparent: true,
      opacity:     0,
      depthWrite:  false,
      side:        THREE.DoubleSide,
      blending:    THREE.AdditiveBlending, // Additive for magical glow effect
      map:         this._glowTexture || undefined,
      alphaMap:    this._glowTexture || undefined,
      alphaTest:   0.01,
    });
    const mesh = new THREE.Mesh(DISC_GEO, mat);
    mesh.rotation.x = -Math.PI / 2; // flat on ground
    mesh.visible = false;
    world.scene.add(mesh);
    return { mesh, mat, elapsed: 0 };
  }
}
