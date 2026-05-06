import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const MAX_POINTS     = 12;
const POINT_LIFETIME = 0.22;
const DISC_GEO       = new THREE.CircleGeometry(0.22, 8);

interface TrailPoint {
  mesh: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
}

@ENGINE.GameClass()
export class BoomerangTrailComponent extends ENGINE.SceneComponent {
  private readonly _points: TrailPoint[] = [];
  private _active = false;

  // ── Public API ──────────────────────────────────────────────────────────────

  public start(): void  { this._active = true; }
  public stop(): void   { this._active = false; }

  public addPoint(worldPos: THREE.Vector3): void {
    if (!this._active) return;
    const world = this.getWorld();
    if (!world) return;

    const mat = new THREE.MeshBasicMaterial({
      color:      new THREE.Color(0.55, 0.15, 1.0),
      transparent: true,
      opacity:    0.75,
      depthWrite: false,
      side:       THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(DISC_GEO, mat);
    mesh.position.copy(worldPos);
    mesh.rotation.x = -Math.PI / 2; // flat on ground
    world.scene.add(mesh);

    this._points.push({ mesh, elapsed: 0 });

    // Prune oldest if over limit
    while (this._points.length > MAX_POINTS) {
      const old = this._points.shift()!;
      old.mesh.material.dispose();
      old.mesh.removeFromParent();
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    for (let i = this._points.length - 1; i >= 0; i--) {
      const p = this._points[i];
      p.elapsed += deltaTime;
      const progress = p.elapsed / POINT_LIFETIME;
      p.mesh.material.opacity = 0.75 * Math.max(0, 1 - progress);

      if (progress >= 1) {
        p.mesh.material.dispose();
        p.mesh.removeFromParent();
        this._points.splice(i, 1);
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const p of this._points) {
      p.mesh.material.dispose();
      p.mesh.removeFromParent();
    }
    this._points.length = 0;
    super.endPlay();
  }
}
