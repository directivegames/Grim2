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
const _sparkColorScratch = new THREE.Color();

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

function applySparkColor(tNorm: number, out: THREE.Color): THREE.Color {
  return out.setRGB(
    THREE.MathUtils.lerp(1.0, 0.0, tNorm),
    THREE.MathUtils.lerp(1.0, 0.8, tNorm),
    THREE.MathUtils.lerp(1.0, 1.0, tNorm),
  );
}

// ── Module-level pool (shared across all WeaponSummonVFXComponent instances) ──

const POOL_SIZE = 60;
const _pool: Spark[] = [];
const _free: Spark[] = [];
let _poolSceneAttached = false;

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

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowMesh = new THREE.Mesh(GLOW_GEO, glowMat);
    glowMesh.visible = false;

    const spark: Spark = {
      mesh,
      glow: glowMesh,
      elapsed: 0,
      velocity: new THREE.Vector3(),
      flickerOffset: 0,
      active: false,
    };
    _pool.push(spark);
    _free.push(spark);
  }
}

function _ensurePoolInScene(scene: THREE.Scene): void {
  if (_poolSceneAttached) return;
  if (_pool.length === 0) _buildPool();
  for (const s of _pool) {
    scene.add(s.mesh);
    if (s.glow) scene.add(s.glow);
  }
  _poolSceneAttached = true;
}

function _acquireSpark(): Spark | null {
  return _free.pop() ?? null;
}

@ENGINE.GameClass()
export class WeaponSummonVFXComponent extends ENGINE.SceneComponent {
  private readonly _activeSparks: Spark[] = [];

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }const world = this.getWorld();
    if (world) {
      _ensurePoolInScene(world.scene);
    }
  
    return true;
  }

  public burst(worldPos: THREE.Vector3, count: number): void {
    const world = this.getWorld();
    if (!world) return;

    _ensurePoolInScene(world.scene);

    for (let i = 0; i < count; i++) {
      const spark = _acquireSpark();
      if (!spark) break;

      const tNorm = Math.random();
      applySparkColor(tNorm, _sparkColorScratch);
      spark.mesh.material.color.copy(_sparkColorScratch);
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

      const useGlow = tNorm < 0.4;
      if (useGlow && spark.glow) {
        spark.glow.material.opacity = 1;
        spark.glow.position.copy(spark.mesh.position);
        spark.glow.scale.setScalar(1);
        spark.glow.visible = true;
      } else if (spark.glow) {
        spark.glow.visible = false;
      }

      spark.elapsed = 0;
      spark.flickerOffset = Math.random() * 100;
      spark.active = true;

      this._activeSparks.push(spark);
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateSparks(deltaTime);
  }

  private _updateSparks(deltaTime: number): void {
    const sparks = this._activeSparks;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i]!;
      spark.elapsed += deltaTime;

      const useLifetime = spark.glow?.visible ? SPARK_LIFETIME : PARTICLE_LIFETIME;
      const progress = spark.elapsed / useLifetime;

      const flicker = Math.sin(spark.elapsed * 40 + spark.flickerOffset) > 0.15 ? 1.0 : 0.2;

      spark.mesh.position.addScaledVector(spark.velocity, deltaTime);
      spark.velocity.y -= 4 * deltaTime;
      spark.mesh.material.opacity = Math.max(0, 1 - progress) * flicker;

      if (spark.glow?.visible) {
        spark.glow.position.copy(spark.mesh.position);
        spark.glow.material.opacity = Math.max(0, 1 - progress * 1.5);
        spark.glow.scale.setScalar(THREE.MathUtils.lerp(1.0, 0.3, progress));
      }

      if (progress >= 1) {
        spark.mesh.visible = false;
        if (spark.glow) {
          spark.glow.visible = false;
        }
        spark.active = false;
        _free.push(spark);
        sparks[i] = sparks[sparks.length - 1]!;
        sparks.pop();
      }
    }
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    for (const spark of this._activeSparks) {
      spark.mesh.visible = false;
      if (spark.glow) {
        spark.glow.visible = false;
      }
      spark.active = false;
      _free.push(spark);
    }
    this._activeSparks.length = 0;
    return true;
  }
}

export { APPEAR_COUNT, DISMISS_COUNT };
