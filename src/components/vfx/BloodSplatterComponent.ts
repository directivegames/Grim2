import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PARTICLE_LIFETIME = 0.55;
const SPLATTER_COUNT    = 12;

// Circle geometry for round blood drops (not flat squares)
const DROP_GEO = new THREE.CircleGeometry(0.18, 10);

/** Bright red chunky blood — no dark tones, fully opaque. */
const BLOOD_COLORS = [
  new THREE.Color(0xff0000),
  new THREE.Color(0xff1111),
  new THREE.Color(0xff2222),
];

/** Shared scratch vectors for orientation math in burst(). */
const _up   = new THREE.Vector3(0, 1, 0);
const _dir  = new THREE.Vector3();
const _axis = new THREE.Vector3();

interface BloodDrop {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
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
        transparent: false,
        opacity: 1.0,
        depthWrite: true,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(DROP_GEO, material);
      mesh.position.copy(worldPos);
      mesh.position.y += randomBetween(0.2, 0.7);

      // Random angle with upward/outward bias (flies off from zombie)
      const angle  = randomBetween(0, Math.PI * 2);
      const upBias = randomBetween(0.6, 1.2);
      const speed  = randomBetween(5, 11);

      // Add outward bias away from center
      const outwardBias = 1.3;

      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed * outwardBias,
        upBias * speed,
        Math.sin(angle) * speed * outwardBias,
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
      // Snap off at end instead of fading — keeps blood fully opaque
      drop.mesh.visible = progress < 1;

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
