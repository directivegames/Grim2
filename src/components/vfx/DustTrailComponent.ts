import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricMovementComponent } from '../movement/IsometricMovementComponent.js';

const SPAWN_INTERVAL = 0.1;
const MIN_SPEED = 0.3;
const PUFF_LIFETIME = 0.8;
const MAX_PUFFS = 12; // Max simultaneous dust puffs

const PUFF_GEOMETRY = new THREE.PlaneGeometry(1, 1);

/** Dust color palette - pre-allocated to avoid per-puff Color creation. */
const DUST_HUE_MIN = 0.08;
const DUST_HUE_MAX = 0.12;
const DUST_SAT_MIN = 0.3;
const DUST_SAT_MAX = 0.5;
const DUST_LGT_MIN = 0.65;
const DUST_LGT_MAX = 0.8;

interface PooledPuff {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  mat: THREE.MeshBasicMaterial;
  elapsed: number;
  maxScale: number;
  drift: THREE.Vector3;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

@ENGINE.GameClass()
export class DustTrailComponent extends ENGINE.SceneComponent {
  private _timer = 0;

  // Pre-allocated pool - eliminates per-puff GC
  private readonly _pool: PooledPuff[] = [];
  private readonly _active: PooledPuff[] = [];
  private readonly _free: PooledPuff[] = [];
  private _poolBuilt = false;

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this._updatePuffs(deltaTime);

    this._timer += deltaTime;
    if (this._timer < SPAWN_INTERVAL) return;

    const actor = this.getActor();
    const mc = actor?.getComponent(IsometricMovementComponent);
    if (!mc || mc.getWorldVelocity().length() < MIN_SPEED) return;

    this._timer = 0;
    this._spawnPuff(actor!.getWorldPosition());
  }

  private _spawnPuff(actorPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    // Lazy-init pool on first use
    if (!this._poolBuilt) {
      this._buildPool(world);
      this._poolBuilt = true;
    }

    // Get a puff from pool
    let puff: PooledPuff;
    if (this._free.length > 0) {
      puff = this._free.pop()!;
    } else if (this._active.length >= MAX_PUFFS) {
      // Evict oldest
      puff = this._active.shift()!;
    } else {
      // Shouldn't happen after pool built, but be safe
      puff = this._createPuff(world);
      this._pool.push(puff);
    }

    // Reset and configure
    puff.elapsed = 0;
    puff.mesh.position.copy(actorPos);
    puff.mesh.position.y -= 0.1;
    puff.mesh.rotation.set(-Math.PI / 2, 0, randomBetween(0, Math.PI * 2));
    puff.mesh.scale.setScalar(0.1);
    puff.mesh.visible = true;

    // Configure material color
    const h = randomBetween(DUST_HUE_MIN, DUST_HUE_MAX);
    const s = randomBetween(DUST_SAT_MIN, DUST_SAT_MAX);
    const l = randomBetween(DUST_LGT_MIN, DUST_LGT_MAX);
    puff.mat.color.setHSL(h, s, l);
    puff.mat.opacity = 0.6;

    puff.maxScale = randomBetween(0.4, 0.9);
    puff.drift.set(
      randomBetween(-0.15, 0.15),
      randomBetween(0.05, 0.25),
      randomBetween(-0.15, 0.15),
    );

    this._active.push(puff);
  }

  private _updatePuffs(deltaTime: number): void {
    const active = this._active;
    for (let i = active.length - 1; i >= 0; i--) {
      const puff = active[i];
      puff.elapsed += deltaTime;

      const progress = Math.min(puff.elapsed / PUFF_LIFETIME, 1);

      const scale = THREE.MathUtils.lerp(0.1, puff.maxScale, easeOutCubic(progress));
      puff.mesh.scale.setScalar(scale);

      puff.mesh.position.addScaledVector(puff.drift, deltaTime);

      const alpha = 1 - progress;
      puff.mat.opacity = 0.6 * alpha;

      if (progress >= 1) {
        puff.mesh.visible = false;
        // Swap-with-last removal
        active[i] = active[active.length - 1];
        active.pop();
        this._free.push(puff);
      }
    }
  }

  private _buildPool(world: ENGINE.World): void {
    for (let i = 0; i < MAX_PUFFS; i++) {
      const puff = this._createPuff(world);
      this._pool.push(puff);
      this._free.push(puff);
    }
  }

  private _createPuff(world: ENGINE.World): PooledPuff {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(PUFF_GEOMETRY, mat);
    mesh.visible = false;
    world.scene.add(mesh);

    return {
      mesh,
      mat,
      elapsed: 0,
      maxScale: 0.5,
      drift: new THREE.Vector3(),
    };
  }

  public override endPlay(): void {
    for (const puff of this._pool) {
      puff.mat.dispose();
      puff.mesh.removeFromParent();
    }
    this._pool.length = 0;
    this._active.length = 0;
    this._free.length = 0;
    super.endPlay();
  }
}
