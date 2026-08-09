/**
 * ZombieRiseVFXActor — Zombie spawn: ground ripple rings + smoke.vfx.json particles.
 *
 * Uses an object pool so repeated zombie spawns never re-create or re-load assets.
 * After the effect finishes the actor hides itself and returns to the pool instead of being destroyed.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { isMobileDevice } from '../utils/mobile-device.js';

const SPAWN_SMOKE_VFX = '@project/assets/VFX/smoke.vfx.json';

const LIFETIME = 2.5;
const GROUND_RIPPLE_SEGMENTS = 16;

const MAX_ACTIVE = 10;
const MOBILE_MAX_ACTIVE = 3;
let activeCount = 0;

/** Idle (hidden) actors ready for reuse. */
const _pool: ZombieRiseVFXActor[] = [];

const GROUND_GEOMETRY = new THREE.RingGeometry(0.1, 1, GROUND_RIPPLE_SEGMENTS);

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

@ENGINE.GameClass()
export class ZombieRiseVFXActor extends ENGINE.Actor {
  private groundRipple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private groundRipple2: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private _smokeVfx: ENGINE.VFXComponent | null = null;
  private elapsed = 0;
  private _isActive = false;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create({ name: 'Root' });
    super.initialize({ ...options, rootComponent: root });
    this._createGroundRipples(root);

    if (!isMobileDevice()) {
      const smokeVfx = ENGINE.VFXComponent.create({
        name: 'SpawnSmokeVfx',
        vfxPath: SPAWN_SMOKE_VFX,
        autoStart: true,
      });
      root.add(smokeVfx);
      this._smokeVfx = smokeVfx;
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (!this._isActive) return;

    this.elapsed += deltaTime;

    if (this.groundRipple) {
      const t = Math.min(this.elapsed / (LIFETIME * 0.6), 1);
      this.groundRipple.scale.setScalar(THREE.MathUtils.lerp(0.2, 3.5, easeOutCubic(t)));
      this.groundRipple.material.opacity = 0.5 * Math.max(0, 1 - t);
    }

    if (this.groundRipple2) {
      const t2 = Math.min(this.elapsed / (LIFETIME * 0.8), 1);
      this.groundRipple2.scale.setScalar(THREE.MathUtils.lerp(0.1, 2.8, easeOutCubic(t2)));
      this.groundRipple2.material.opacity = 0.4 * Math.max(0, 1 - t2);
    }

    if (this.elapsed >= LIFETIME) {
      this._returnToPool();
    }
  }

  // ─── Pool helpers ──────────────────────────────────────────────────────────

  private _activate(position: THREE.Vector3): void {
    this.elapsed = 0;
    this._isActive = true;

    if (this.groundRipple) {
      this.groundRipple.scale.setScalar(0.2);
      this.groundRipple.material.opacity = 0.5;
    }
    if (this.groundRipple2) {
      this.groundRipple2.scale.setScalar(0.1);
      this.groundRipple2.material.opacity = 0.4;
    }

    this._smokeVfx?.startEmitting(true);

    this.rootComponent.position.copy(position).add(new THREE.Vector3(0, 0.1, 0));
    this.setHidden(false, true);
  }

  private _returnToPool(): void {
    activeCount = Math.max(0, activeCount - 1);
    this._isActive = false;
    this._smokeVfx?.stopEmitting();
    this.setHidden(true, true);
    _pool.push(this);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): ZombieRiseVFXActor | null {
    const pooled = _pool.pop();
    if (pooled) {
      activeCount++;
      pooled._activate(position);
      return pooled;
    }

    const maxActive = isMobileDevice() ? MOBILE_MAX_ACTIVE : MAX_ACTIVE;
    if (activeCount >= maxActive) return null;
    activeCount++;

    const actor = ZombieRiseVFXActor.create({
      position: position.clone().add(new THREE.Vector3(0, 0.1, 0)),
    });
    world.addActor(actor);
    actor._isActive = true;
    return actor;
  }

  /**
   * Pre-create a full set of hidden instances and register them in the pool.
   * Call this during the loading screen so the first zombie rise is spike-free.
   * Returns the created actors so callers can track their load state.
   */
  public static prewarmPool(world: ENGINE.World): ZombieRiseVFXActor[] {
    const count = isMobileDevice() ? MOBILE_MAX_ACTIVE : MAX_ACTIVE;
    const created: ZombieRiseVFXActor[] = [];
    for (let i = 0; i < count; i++) {
      const actor = ZombieRiseVFXActor.create({ position: new THREE.Vector3(0, -1000, 0) });
      world.addActor(actor);
      actor._isActive = false;
      actor.setHidden(true, true);
      _pool.push(actor);
      created.push(actor);
    }
    return created;
  }

  /** Destroy all instances (active and pooled) and clear the pool. Call on world unload. */
  public static destroyAllRuntime(world: ENGINE.World): void {
    const toDestroy: ZombieRiseVFXActor[] = [];
    for (const actor of world.getActors()) {
      if (actor instanceof ZombieRiseVFXActor) {
        toDestroy.push(actor);
      }
    }
    for (const actor of toDestroy) {
      actor.destroy();
    }
    activeCount = 0;
    _pool.length = 0;
  }

  private _createGroundRipples(root: ENGINE.SceneComponent): void {
    const mat1 = new THREE.MeshBasicMaterial({
      color: 0x5d3f7c,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.groundRipple = new THREE.Mesh(GROUND_GEOMETRY, mat1);
    this.groundRipple.name = 'GroundRipple';
    this.groundRipple.rotation.x = -Math.PI / 2;
    this.groundRipple.position.y = 0.02;
    this.groundRipple.scale.setScalar(0.2);
    root.add(this.groundRipple);

    const mat2 = new THREE.MeshBasicMaterial({
      color: 0x7d5f9c,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.groundRipple2 = new THREE.Mesh(GROUND_GEOMETRY, mat2);
    this.groundRipple2.name = 'GroundRipple2';
    this.groundRipple2.rotation.x = -Math.PI / 2;
    this.groundRipple2.position.y = 0.01;
    this.groundRipple2.scale.setScalar(0.1);
    root.add(this.groundRipple2);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Particle';
  }
}
