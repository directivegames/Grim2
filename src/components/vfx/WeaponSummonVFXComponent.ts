import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PARTICLE_LIFETIME = 0.6;
const APPEAR_COUNT      = 22;
const DISMISS_COUNT     = 18;

const STREAK_GEO = new THREE.PlaneGeometry(0.05, 0.30);

interface Spark {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  velocity: THREE.Vector3;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Purple-to-blue palette matching the slash ribbon. */
function sparkColor(tNorm: number): THREE.Color {
  return new THREE.Color(
    THREE.MathUtils.lerp(0.6, 0.2, tNorm),
    THREE.MathUtils.lerp(0.05, 0.35, tNorm),
    1.0,
  );
}

@ENGINE.GameClass()
export class WeaponSummonVFXComponent extends ENGINE.SceneComponent {
  private readonly _sparks: Spark[] = [];

  // ── Public API ──────────────────────────────────────────────────────────────

  public burst(worldPos: THREE.Vector3, count: number): void {
    const world = this.getWorld();
    if (!world) return;

    for (let i = 0; i < count; i++) {
      const t = i / count;

      const material = new THREE.MeshBasicMaterial({
        color: sparkColor(Math.random()),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(STREAK_GEO, material);
      mesh.position.copy(worldPos);
      mesh.position.y += randomBetween(-0.6, 0.8);

      // Wider rectangular spread — faster outward, flatter vertical
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(4, 10);
      const vy    = randomBetween(-0.5, 2);
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        vy,
        Math.sin(angle) * speed,
      );

      // Orient streak along its velocity direction
      const up = new THREE.Vector3(0, 1, 0);
      const axis = new THREE.Vector3().crossVectors(up, velocity).normalize();
      const ang  = Math.acos(Math.min(1, up.dot(velocity.clone().normalize())));
      if (axis.lengthSq() > 0.001) {
        mesh.quaternion.setFromAxisAngle(axis, ang);
      }

      world.scene.add(mesh);

      this._sparks.push({ mesh, elapsed: 0, velocity });
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateSparks(deltaTime);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _updateSparks(deltaTime: number): void {
    for (let i = this._sparks.length - 1; i >= 0; i--) {
      const spark = this._sparks[i];
      spark.elapsed += deltaTime;

      const progress = spark.elapsed / PARTICLE_LIFETIME;

      spark.mesh.position.addScaledVector(spark.velocity, deltaTime);
      // Gravity drag
      spark.velocity.y -= 4 * deltaTime;

      // Fade out
      spark.mesh.material.opacity = Math.max(0, 1 - progress);

      if (progress >= 1) {
        spark.mesh.material.dispose();
        spark.mesh.removeFromParent();
        this._sparks.splice(i, 1);
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const spark of this._sparks) {
      spark.mesh.material.dispose();
      spark.mesh.removeFromParent();
    }
    this._sparks.length = 0;
    super.endPlay();
  }
}

export { APPEAR_COUNT, DISMISS_COUNT };
