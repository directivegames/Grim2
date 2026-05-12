import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Max number of samples stored in the ribbon history. */
const MAX_SAMPLES = 48;

/** How long (seconds) the full ribbon fades out after the swing ends. */
const TRAIL_LIFETIME = 0.55;

/** Radius from player center where the inner edge of the ribbon starts. */
const INNER_RADIUS = 0.5;

/** Width of the main bright core ribbon. */
const CORE_WIDTH = 2.2;

/** Width of the feathered outer edge (total). */
const FEATHER_WIDTH = 3.5;

/** Width of the glow layer underneath. */
const GLOW_WIDTH = 4.5;

/**
 * Pre-allocated sample slot – Vector3 objects are reused each frame so there
 * are zero per-frame heap allocations while a trail is active.
 * Now has inner (core), mid (feather start), outer (feather end), and glow.
 */
interface TrailSample {
  inner: THREE.Vector3;
  mid: THREE.Vector3;
  outer: THREE.Vector3;
  glow: THREE.Vector3;
}

@ENGINE.GameClass()
export class WeaponSlashComponent extends ENGINE.SceneComponent {
  // Core ribbon mesh (bright center)
  private _coreMesh: THREE.Mesh | null = null;
  private _coreGeometry: THREE.BufferGeometry | null = null;
  private _corePosAttr: THREE.BufferAttribute | null = null;
  private _coreColAttr: THREE.BufferAttribute | null = null;
  private _coreIndexAttr: THREE.BufferAttribute | null = null;

  // Glow mesh (wide, dim, underneath)
  private _glowMesh: THREE.Mesh | null = null;
  private _glowGeometry: THREE.BufferGeometry | null = null;
  private _glowPosAttr: THREE.BufferAttribute | null = null;
  private _glowColAttr: THREE.BufferAttribute | null = null;
  private _glowIndexAttr: THREE.BufferAttribute | null = null;

  // ── Circular buffer – pre-allocated, zero runtime allocation ───────────────
  private readonly _pool: TrailSample[] = Array.from({ length: MAX_SAMPLES }, () => ({
    inner: new THREE.Vector3(),
    mid: new THREE.Vector3(),
    outer: new THREE.Vector3(),
    glow: new THREE.Vector3(),
  }));
  private _poolHead  = 0;
  private _poolCount = 0;

  private _isActive     = false;
  private _decaying     = false;
  private _decayElapsed = 0;

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  public override beginPlay(): void {
    super.beginPlay();
    this._buildMeshes();
  }

  public override endPlay(): void {
    this._destroyMeshes();
    this._poolCount = 0;
    this._poolHead  = 0;
    super.endPlay();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public startTrail(): void {
    this._poolCount    = 0;
    this._poolHead     = 0;
    this._isActive     = true;
    this._decaying     = false;
    this._decayElapsed = 0;
  }

  public addSample(
    playerPos: THREE.Vector3,
    orbitAngle: number,
    _outerRadius: number, // kept for API compatibility, but we calculate widths
    height: number,
  ): void {
    if (!this._isActive) return;

    const writeIdx = (this._poolHead + this._poolCount) % MAX_SAMPLES;
    const slot = this._pool[writeIdx];

    const cos = Math.cos(orbitAngle);
    const sin = Math.sin(orbitAngle);

    // Inner edge (start of bright core)
    slot.inner.set(
      playerPos.x + cos * INNER_RADIUS,
      height,
      playerPos.z + sin * INNER_RADIUS,
    );

    // Mid (end of bright core, start of feather)
    slot.mid.set(
      playerPos.x + cos * (INNER_RADIUS + CORE_WIDTH),
      height,
      playerPos.z + sin * (INNER_RADIUS + CORE_WIDTH),
    );

    // Outer (end of feather fade)
    slot.outer.set(
      playerPos.x + cos * (INNER_RADIUS + FEATHER_WIDTH),
      height,
      playerPos.z + sin * (INNER_RADIUS + FEATHER_WIDTH),
    );

    // Glow (wide underneath layer)
    slot.glow.set(
      playerPos.x + cos * (INNER_RADIUS + GLOW_WIDTH),
      height,
      playerPos.z + sin * (INNER_RADIUS + GLOW_WIDTH),
    );

    if (this._poolCount < MAX_SAMPLES) {
      this._poolCount++;
    } else {
      this._poolHead = (this._poolHead + 1) % MAX_SAMPLES;
    }
  }

  public stopTrail(): void {
    this._isActive     = false;
    this._decaying     = true;
    this._decayElapsed = 0;
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (this._poolCount === 0) return;

    if (this._decaying) {
      this._decayElapsed += deltaTime;
      if (this._decayElapsed >= TRAIL_LIFETIME) {
        this._poolCount = 0;
        this._poolHead  = 0;
        this._clearMeshes();
        return;
      }
    }

    this._rebuildCoreGeometry();
    this._rebuildGlowGeometry();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _buildMeshes(): void {
    const world = this.getWorld();
    if (!world) return;

    // Core mesh: 3 vertices per sample (inner, mid, outer) for feathered edges
    this._buildCoreMesh(world);
    // Glow mesh: 2 vertices per sample (inner glow anchor, outer glow)
    this._buildGlowMesh(world);
  }

  private _buildCoreMesh(world: ENGINE.World): void {
    const maxVerts   = MAX_SAMPLES * 3; // inner, mid, outer
    const maxIndices = (MAX_SAMPLES - 1) * 12; // 4 triangles per segment (2 strips)

    const positions = new Float32Array(maxVerts * 3);
    const colors    = new Float32Array(maxVerts * 4);
    const indices   = new Uint16Array(maxIndices);

    this._coreGeometry  = new THREE.BufferGeometry();
    this._corePosAttr   = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this._coreColAttr   = new THREE.BufferAttribute(colors,    4).setUsage(THREE.DynamicDrawUsage);
    this._coreIndexAttr = new THREE.BufferAttribute(indices,   1).setUsage(THREE.DynamicDrawUsage);

    this._coreGeometry.setAttribute('position', this._corePosAttr);
    this._coreGeometry.setAttribute('color',    this._coreColAttr);
    this._coreGeometry.setIndex(this._coreIndexAttr);
    this._coreGeometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
      side:         THREE.DoubleSide,
    });

    this._coreMesh = new THREE.Mesh(this._coreGeometry, material);
    this._coreMesh.frustumCulled = false;
    world.scene.add(this._coreMesh);
  }

  private _buildGlowMesh(world: ENGINE.World): void {
    const maxVerts   = MAX_SAMPLES * 2; // inner anchor, outer glow
    const maxIndices = (MAX_SAMPLES - 1) * 6;

    const positions = new Float32Array(maxVerts * 3);
    const colors    = new Float32Array(maxVerts * 4);
    const indices   = new Uint16Array(maxIndices);

    this._glowGeometry  = new THREE.BufferGeometry();
    this._glowPosAttr   = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this._glowColAttr   = new THREE.BufferAttribute(colors,    4).setUsage(THREE.DynamicDrawUsage);
    this._glowIndexAttr = new THREE.BufferAttribute(indices,   1).setUsage(THREE.DynamicDrawUsage);

    this._glowGeometry.setAttribute('position', this._glowPosAttr);
    this._glowGeometry.setAttribute('color',    this._glowColAttr);
    this._glowGeometry.setIndex(this._glowIndexAttr);
    this._glowGeometry.setDrawRange(0, 0);

    // Glow material: very transparent, soft, additive
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
      side:         THREE.DoubleSide,
      opacity:      0.5,
    });

    this._glowMesh = new THREE.Mesh(this._glowGeometry, material);
    this._glowMesh.frustumCulled = false;
    this._glowMesh.renderOrder = -1; // render before core so it appears underneath
    world.scene.add(this._glowMesh);
  }

  private _destroyMeshes(): void {
    if (this._coreMesh) {
      this._coreMesh.removeFromParent();
      this._coreGeometry?.dispose();
      (this._coreMesh.material as THREE.Material).dispose();
      this._coreMesh      = null;
      this._coreGeometry  = null;
      this._corePosAttr   = null;
      this._coreColAttr   = null;
      this._coreIndexAttr = null;
    }
    if (this._glowMesh) {
      this._glowMesh.removeFromParent();
      this._glowGeometry?.dispose();
      (this._glowMesh.material as THREE.Material).dispose();
      this._glowMesh      = null;
      this._glowGeometry  = null;
      this._glowPosAttr   = null;
      this._glowColAttr   = null;
      this._glowIndexAttr = null;
    }
  }

  private _clearMeshes(): void {
    this._coreGeometry?.setDrawRange(0, 0);
    this._glowGeometry?.setDrawRange(0, 0);
  }

  private _rebuildCoreGeometry(): void {
    if (!this._coreGeometry || !this._corePosAttr || !this._coreColAttr || !this._coreIndexAttr) return;

    const n = this._poolCount;
    if (n < 2) {
      this._coreGeometry.setDrawRange(0, 0);
      return;
    }

    const positions = this._corePosAttr.array  as Float32Array;
    const colors    = this._coreColAttr.array  as Float32Array;
    const idxArr    = this._coreIndexAttr.array as Uint16Array;

    const decayFactor = this._decaying
      ? Math.max(0, 1 - this._decayElapsed / TRAIL_LIFETIME)
      : 1;

    for (let i = 0; i < n; i++) {
      const sample = this._pool[(this._poolHead + i) % MAX_SAMPLES];
      const tNorm  = i / (n - 1); // 0 = oldest, 1 = newest
      const alpha  = tNorm * tNorm * decayFactor;

      // Color gradient: Bright white/cyan at tip (newest) → Electric purple at tail (oldest)
      // Tip (tNorm=1): bright cyan-white (0.9, 1.0, 1.0)
      // Tail (tNorm=0): deep electric purple (0.8, 0.2, 1.0)
      const r = THREE.MathUtils.lerp(0.8, 0.9, tNorm);
      const g = THREE.MathUtils.lerp(0.2, 1.0, tNorm);
      const b = 1.0; // Always max blue

      const vi = i * 3;

      // Inner vertex (start of core)
      positions[vi * 3]     = sample.inner.x;
      positions[vi * 3 + 1] = sample.inner.y;
      positions[vi * 3 + 2] = sample.inner.z;
      colors[vi * 4]     = r * 0.6; // dimmer at inner edge
      colors[vi * 4 + 1] = g * 0.6;
      colors[vi * 4 + 2] = b * 0.8;
      colors[vi * 4 + 3] = alpha * 0.3; // very soft at inner

      // Mid vertex (bright core center)
      positions[(vi + 1) * 3]     = sample.mid.x;
      positions[(vi + 1) * 3 + 1] = sample.mid.y;
      positions[(vi + 1) * 3 + 2] = sample.mid.z;
      colors[(vi + 1) * 4]     = r;      // full brightness
      colors[(vi + 1) * 4 + 1] = g;
      colors[(vi + 1) * 4 + 2] = b;
      colors[(vi + 1) * 4 + 3] = alpha;  // peak alpha at core

      // Outer vertex (feather edge)
      positions[(vi + 2) * 3]     = sample.outer.x;
      positions[(vi + 2) * 3 + 1] = sample.outer.y;
      positions[(vi + 2) * 3 + 2] = sample.outer.z;
      colors[(vi + 2) * 4]     = r * 0.8;
      colors[(vi + 2) * 4 + 1] = g * 0.8;
      colors[(vi + 2) * 4 + 2] = b;
      colors[(vi + 2) * 4 + 3] = alpha * 0.15; // feathered soft edge
    }

    this._corePosAttr.needsUpdate = true;
    this._coreColAttr.needsUpdate = true;

    // Build triangle strip: inner→mid→next inner→next mid, plus mid→outer→next mid→next outer
    let idxPos = 0;
    for (let i = 0; i < n - 1; i++) {
      const base = i * 3;
      const next = (i + 1) * 3;

      // Core strip (inner-mid to next inner-mid)
      idxArr[idxPos++] = base;     // inner
      idxArr[idxPos++] = base + 1; // mid
      idxArr[idxPos++] = next;     // next inner
      idxArr[idxPos++] = base + 1; // mid
      idxArr[idxPos++] = next + 1; // next mid
      idxArr[idxPos++] = next;     // next inner

      // Feather strip (mid-outer to next mid-outer)
      idxArr[idxPos++] = base + 1; // mid
      idxArr[idxPos++] = base + 2; // outer
      idxArr[idxPos++] = next + 1; // next mid
      idxArr[idxPos++] = base + 2; // outer
      idxArr[idxPos++] = next + 2; // next outer
      idxArr[idxPos++] = next + 1; // next mid
    }

    this._coreIndexAttr.needsUpdate = true;
    this._coreGeometry.setDrawRange(0, idxPos);
  }

  private _rebuildGlowGeometry(): void {
    if (!this._glowGeometry || !this._glowPosAttr || !this._glowColAttr || !this._glowIndexAttr) return;

    const n = this._poolCount;
    if (n < 2) {
      this._glowGeometry.setDrawRange(0, 0);
      return;
    }

    const positions = this._glowPosAttr.array  as Float32Array;
    const colors    = this._glowColAttr.array  as Float32Array;
    const idxArr    = this._glowIndexAttr.array as Uint16Array;

    const decayFactor = this._decaying
      ? Math.max(0, 1 - this._decayElapsed / TRAIL_LIFETIME)
      : 1;

    for (let i = 0; i < n; i++) {
      const sample = this._pool[(this._poolHead + i) % MAX_SAMPLES];
      const tNorm  = i / (n - 1);
      const alpha  = tNorm * tNorm * decayFactor * 0.25; // glow is dimmer

      const vi = i * 2;

      // Inner anchor (close to player center)
      positions[vi * 3]     = sample.inner.x;
      positions[vi * 3 + 1] = sample.inner.y;
      positions[vi * 3 + 2] = sample.inner.z;
      colors[vi * 4]     = 0.4; // purple
      colors[vi * 4 + 1] = 0.1;
      colors[vi * 4 + 2] = 0.6;
      colors[vi * 4 + 3] = alpha * 0.3;

      // Outer glow vertex
      positions[(vi + 1) * 3]     = sample.glow.x;
      positions[(vi + 1) * 3 + 1] = sample.glow.y;
      positions[(vi + 1) * 3 + 2] = sample.glow.z;
      colors[(vi + 1) * 4]     = 0.3;
      colors[(vi + 1) * 4 + 1] = 0.4;
      colors[(vi + 1) * 4 + 2] = 0.8;
      colors[(vi + 1) * 4 + 3] = alpha;
    }

    this._glowPosAttr.needsUpdate = true;
    this._glowColAttr.needsUpdate = true;

    let idxPos = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      idxArr[idxPos++] = a;
      idxArr[idxPos++] = b;
      idxArr[idxPos++] = c;
      idxArr[idxPos++] = b;
      idxArr[idxPos++] = d;
      idxArr[idxPos++] = c;
    }

    this._glowIndexAttr.needsUpdate = true;
    this._glowGeometry.setDrawRange(0, idxPos);
  }
}
