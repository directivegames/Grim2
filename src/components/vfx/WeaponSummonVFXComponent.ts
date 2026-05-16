import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PARTICLE_LIFETIME = 0.25;
const SPARK_LIFETIME = 0.35;
const APPEAR_COUNT      = 14;
const DISMISS_COUNT     = 12;

const STREAK_GEO = new THREE.PlaneGeometry(0.08, 0.25);
const GLOW_GEO = new THREE.SphereGeometry(0.06, 8, 8);

/** Shared scratch vectors for orientation math in burst(). */
const _up   = new THREE.Vector3(0, 1, 0);
const _dir  = new THREE.Vector3();
const _axis = new THREE.Vector3();

interface Spark {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null;
  elapsed: number;
  velocity: THREE.Vector3;
  flickerOffset: number;
  active: boolean;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Electric cyan-to-white palette for lightning effect. */
function sparkColor(tNorm: number): THREE.Color {
  return new THREE.Color(
    THREE.MathUtils.lerp(1.0, 0.0, tNorm),
    THREE.MathUtils.lerp(1.0, 0.8, tNorm),
    THREE.MathUtils.lerp(1.0, 1.0, tNorm),
  );
}

// ── Module-level pool (shared across all WeaponSummonVFXComponent instances) ──

const POOL_SIZE = 60; // max burst is 14; 60 covers two overlapping bursts with glows

const _pool: Spark[] = [];

function _buildPool(): void {
  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(STREAK_GEO, mat);
    mesh.visible = false;

    // Create glow for every particle; only shown on 40% when active
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowMesh = new THREE.Mesh(GLOW_GEO, glowMat);
    glowMesh.visible = false;

    _pool.push({
      mesh,
      glow: glowMesh,
      elapsed: 0,
      velocity: new THREE.Vector3(),
      flickerOffset: 0,
      active: false,
    });
  }
}

function _acquireSpark(): Spark | null {
  for (const s of _pool) {
    if (!s.active) return s;
  }
  return null;
}

@ENGINE.GameClass()
export class WeaponSummonVFXComponent extends ENGINE.SceneComponent {
  private readonly _activeSparks: Spark[] = [];

  // ── Public API ──────────────────────────────────────────────────────────────

  public burst(worldPos: THREE.Vector3, count: number): void {
    const world = this.getWorld();
    if (!world) return;

    if (_pool.length === 0) _buildPool();

    for (let i = 0; i < count; i++) {
      const spark = _acquireSpark();
      if (!spark) break;

      const tNorm = Math.random();
      spark.mesh.material.color.copy(sparkColor(tNorm));
      spark.mesh.material.opacity = 1;
      spark.mesh.position.copy(worldPos);
      spark.mesh.position.y += randomBetween(-0.4, 0.6);
      spark.mesh.visible = true;

      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(8, 18);
      const vy = randomBetween(-0.3, 3);
      spark.velocity.set(Math.cos(angle) * speed, vy, Math.sin(angle) * speed);

      _dir.copy(spark.velocity).normalize();
      _axis.crossVectors(_up, _dir).normalize();
      const ang = Math.acos(Math.min(1, _up.dot(_dir)));
      if (_axis.lengthSq() > 0.001) {
        spark.mesh.quaternion.setFromAxisAngle(_axis, ang);
      }

      world.scene.add(spark.mesh);

      const useGlow = tNorm < 0.4;
      if (useGlow && spark.glow) {
        spark.glow.material.opacity = 1;
        spark.glow.position.copy(spark.mesh.position);
        spark.glow.scale.setScalar(1);
        spark.glow.visible = true;
        world.scene.add(spark.glow);
      } else if (spark.glow) {
        spark.glow.visible = false;
      }

      spark.elapsed = 0;
      spark.flickerOffset = Math.random() * 100;
      spark.active = true;

      this._activeSparks.push(spark);
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateSparks(deltaTime);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _updateSparks(deltaTime: number): void {
    const sparks = this._activeSparks;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i]!;
      spark.elapsed += deltaTime;

      const useLifetime = (spark.glow?.visible) ? SPARK_LIFETIME : PARTICLE_LIFETIME;
      const progress = spark.elapsed / useLifetime;

      const flicker = (Math.sin(spark.elapsed * 40 + spark.flickerOffset) > 0.15) ? 1.0 : 0.2;

      spark.mesh.position.addScaledVector(spark.velocity, deltaTime);
      spark.velocity.y -= 4 * deltaTime;
      spark.mesh.material.opacity = Math.max(0, 1 - progress) * flicker;

      if (spark.glow?.visible) {
        spark.glow.position.copy(spark.mesh.position);
        spark.glow.material.opacity = Math.max(0, 1 - progress * 1.5);
        spark.glow.scale.setScalar(THREE.MathUtils.lerp(1.0, 0.3, progress));
      }

      if (progress >= 1) {
        spark.mesh.removeFromParent();
        spark.mesh.visible = false;
        if (spark.glow) {
          spark.glow.removeFromParent();
          spark.glow.visible = false;
        }
        spark.active = false;
        sparks[i] = sparks[sparks.length - 1]!;
        sparks.pop();
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const spark of this._activeSparks) {
      spark.mesh.removeFromParent();
      spark.mesh.visible = false;
      if (spark.glow) {
        spark.glow.removeFromParent();
        spark.glow.visible = false;
      }
      spark.active = false;
    }
    this._activeSparks.length = 0;
    super.endPlay();
  }
}

export { APPEAR_COUNT, DISMISS_COUNT };
