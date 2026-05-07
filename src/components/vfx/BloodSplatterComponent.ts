import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PARTICLE_LIFETIME = 0.35;
const SPLATTER_COUNT    = 4;

const DROP_GEO = new THREE.PlaneGeometry(0.08, 0.12);

/** Pre-baked blood color palette — avoids per-burst Color allocations. */
const BLOOD_COLORS = [
  new THREE.Color(0x8a0a0a),
  new THREE.Color(0xb51515),
  new THREE.Color(0x5c0808),
];

/** Shared scratch vectors for orientation math in burst(). */
const _up   = new THREE.Vector3(0, 1, 0);
const _dir  = new THREE.Vector3();
const _axis = new THREE.Vector3();

interface BloodDrop {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  velocity: THREE.Vector3;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

@ENGINE.GameClass()
export class BloodSplatterComponent extends ENGINE.SceneComponent {
  private readonly _drops: BloodDrop[] = [];

  // ── Public API ──────────────────────────────────────────────────────────────

  public burst(worldPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    for (let i = 0; i < SPLATTER_COUNT; i++) {
      const color = BLOOD_COLORS[Math.floor(Math.random() * BLOOD_COLORS.length)];

      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(DROP_GEO, material);
      mesh.position.copy(worldPos);
      mesh.position.y += randomBetween(0.2, 0.7);

      const angle  = randomBetween(0, Math.PI * 2);
      const upBias = randomBetween(0.3, 1.0);
      const speed  = randomBetween(3, 7);

      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed * randomBetween(0.5, 1.0),
        upBias * speed,
        Math.sin(angle) * speed * randomBetween(0.5, 1.0),
      );

      // Orient drop along velocity using shared scratch vectors
      _dir.copy(velocity).normalize();
      _axis.crossVectors(_up, _dir).normalize();
      const ang = Math.acos(Math.min(1, _up.dot(_dir)));
      if (_axis.lengthSq() > 0.001) {
        mesh.quaternion.setFromAxisAngle(_axis, ang);
      }

      world.scene.add(mesh);
      this._drops.push({ mesh, elapsed: 0, velocity });
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateDrops(deltaTime);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private _updateDrops(deltaTime: number): void {
    const drops = this._drops;
    for (let i = drops.length - 1; i >= 0; i--) {
      const drop = drops[i];
      drop.elapsed += deltaTime;

      const progress = drop.elapsed / PARTICLE_LIFETIME;

      drop.velocity.y -= 12 * deltaTime;
      drop.mesh.position.addScaledVector(drop.velocity, deltaTime);
      drop.mesh.material.opacity = 0.9 * Math.max(0, 1 - progress);

      if (progress >= 1) {
        drop.mesh.material.dispose();
        drop.mesh.removeFromParent();
        // Swap-with-last: O(1) removal, no array shifting
        drops[i] = drops[drops.length - 1];
        drops.pop();
      }
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const drop of this._drops) {
      drop.mesh.material.dispose();
      drop.mesh.removeFromParent();
    }
    this._drops.length = 0;
    super.endPlay();
  }
}
