import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PARTICLE_LIFETIME = 0.35;
const SPLATTER_COUNT    = 8;

const DROP_GEO = new THREE.PlaneGeometry(0.08, 0.12);

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

    const bloodColors = [
      new THREE.Color(0x8a0a0a), // dark red
      new THREE.Color(0xb51515), // crimson
      new THREE.Color(0x5c0808), // deep maroon
    ];

    for (let i = 0; i < SPLATTER_COUNT; i++) {
      const color = bloodColors[Math.floor(Math.random() * bloodColors.length)];

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

      // Spray outward in upward hemisphere
      const angle = randomBetween(0, Math.PI * 2);
      const upBias = randomBetween(0.3, 1.0);
      const speed = randomBetween(3, 7);

      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed * randomBetween(0.5, 1.0),
        upBias * speed,
        Math.sin(angle) * speed * randomBetween(0.5, 1.0),
      );

      // Orient drop along velocity
      const up = new THREE.Vector3(0, 1, 0);
      const dir = velocity.clone().normalize();
      const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
      const ang = Math.acos(Math.min(1, up.dot(dir)));
      if (axis.lengthSq() > 0.001) {
        mesh.quaternion.setFromAxisAngle(axis, ang);
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
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const drop = this._drops[i];
      drop.elapsed += deltaTime;

      const progress = drop.elapsed / PARTICLE_LIFETIME;

      // Apply gravity
      drop.velocity.y -= 12 * deltaTime;

      // Move
      drop.mesh.position.addScaledVector(drop.velocity, deltaTime);

      // Fade
      drop.mesh.material.opacity = 0.9 * Math.max(0, 1 - progress);

      // Cleanup
      if (progress >= 1) {
        drop.mesh.material.dispose();
        drop.mesh.removeFromParent();
        this._drops.splice(i, 1);
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
