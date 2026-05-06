import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Max number of samples stored in the ribbon history. */
const MAX_SAMPLES = 48;

/** How long (seconds) the full ribbon fades out after the swing ends. */
const TRAIL_LIFETIME = 0.55;

/** Radius from player center where the inner edge of the ribbon starts. */
const INNER_RADIUS = 0.5;

interface TrailSample {
  inner: THREE.Vector3;
  outer: THREE.Vector3;
  age: number;
}

@ENGINE.GameClass()
export class WeaponSlashComponent extends ENGINE.SceneComponent {
  private _mesh: THREE.Mesh | null = null;
  private _geometry: THREE.BufferGeometry | null = null;
  private _posAttr: THREE.BufferAttribute | null = null;
  private _colAttr: THREE.BufferAttribute | null = null;

  private readonly _samples: TrailSample[] = [];
  private _isActive = false;
  private _decaying = false;
  private _decayElapsed = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  public override beginPlay(): void {
    super.beginPlay();
    this._buildMesh();
  }

  public override endPlay(): void {
    this._destroyMesh();
    this._samples.length = 0;
    super.endPlay();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public startTrail(): void {
    this._samples.length = 0;
    this._isActive = true;
    this._decaying = false;
    this._decayElapsed = 0;
  }

  public addSample(playerPos: THREE.Vector3, orbitAngle: number, outerRadius: number, height: number): void {
    if (!this._isActive) return;

    const inner = new THREE.Vector3(
      playerPos.x + Math.cos(orbitAngle) * INNER_RADIUS,
      height,
      playerPos.z + Math.sin(orbitAngle) * INNER_RADIUS,
    );
    const outer = new THREE.Vector3(
      playerPos.x + Math.cos(orbitAngle) * outerRadius,
      height,
      playerPos.z + Math.sin(orbitAngle) * outerRadius,
    );

    this._samples.push({ inner, outer, age: 0 });

    if (this._samples.length > MAX_SAMPLES) {
      this._samples.shift();
    }
  }

  public stopTrail(): void {
    this._isActive = false;
    this._decaying = true;
    this._decayElapsed = 0;
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (this._samples.length === 0) return;

    if (this._decaying) {
      this._decayElapsed += deltaTime;
      if (this._decayElapsed >= TRAIL_LIFETIME) {
        this._samples.length = 0;
        this._clearMesh();
        return;
      }
    }

    this._rebuildGeometry();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _buildMesh(): void {
    const world = this.getWorld();
    if (!world) return;

    // Allocate enough for MAX_SAMPLES quad strips: 2 verts per sample, each vert = xyz
    const maxVerts = MAX_SAMPLES * 2;

    const positions = new Float32Array(maxVerts * 3);
    const colors = new Float32Array(maxVerts * 4); // rgba

    this._geometry = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this._colAttr = new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage);
    this._geometry.setAttribute('position', this._posAttr);
    this._geometry.setAttribute('color', this._colAttr);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this._mesh = new THREE.Mesh(this._geometry, material);
    this._mesh.frustumCulled = false;
    world.scene.add(this._mesh);
  }

  private _destroyMesh(): void {
    if (this._mesh) {
      this._mesh.removeFromParent();
      this._geometry?.dispose();
      (this._mesh.material as THREE.Material).dispose();
      this._mesh = null;
      this._geometry = null;
      this._posAttr = null;
      this._colAttr = null;
    }
  }

  private _clearMesh(): void {
    if (!this._geometry || !this._posAttr) return;
    this._geometry.setDrawRange(0, 0);
  }

  private _rebuildGeometry(): void {
    if (!this._geometry || !this._posAttr || !this._colAttr) return;

    const n = this._samples.length;
    if (n < 2) {
      this._geometry.setDrawRange(0, 0);
      return;
    }

    const positions = this._posAttr.array as Float32Array;
    const colors = this._colAttr.array as Float32Array;

    const decayFactor = this._decaying
      ? Math.max(0, 1 - this._decayElapsed / TRAIL_LIFETIME)
      : 1;

    // Purple/blue glow — computed per sample below

    for (let i = 0; i < n; i++) {
      const sample = this._samples[i];
      const tNorm = i / (n - 1); // 0 = oldest, 1 = newest
      const alpha = tNorm * tNorm * decayFactor; // quadratic: bright at tip, fades toward start

      // Blend from deep purple (old) → electric blue (new)
      const r = THREE.MathUtils.lerp(0.6, 0.2, tNorm);
      const g = THREE.MathUtils.lerp(0.05, 0.35, tNorm);
      const b = 1.0;

      const vi = i * 2;

      // Inner vertex
      positions[vi * 3 + 0] = sample.inner.x;
      positions[vi * 3 + 1] = sample.inner.y;
      positions[vi * 3 + 2] = sample.inner.z;
      colors[vi * 4 + 0] = r;
      colors[vi * 4 + 1] = g;
      colors[vi * 4 + 2] = b;
      colors[vi * 4 + 3] = alpha * 0.6;

      // Outer vertex
      positions[(vi + 1) * 3 + 0] = sample.outer.x;
      positions[(vi + 1) * 3 + 1] = sample.outer.y;
      positions[(vi + 1) * 3 + 2] = sample.outer.z;
      colors[(vi + 1) * 4 + 0] = r;
      colors[(vi + 1) * 4 + 1] = g;
      colors[(vi + 1) * 4 + 2] = b;
      colors[(vi + 1) * 4 + 3] = alpha;
    }

    this._posAttr.needsUpdate = true;
    this._colAttr.needsUpdate = true;

    // Build triangle strip index: quads from consecutive sample pairs
    const indices: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }

    this._geometry.setIndex(indices);
    this._geometry.setDrawRange(0, indices.length);
  }
}
