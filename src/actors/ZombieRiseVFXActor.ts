/**
 * ZombieRiseVFXActor — Zombie spawn: ground ripple rings + smoke.vfx.json particles.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const SPAWN_SMOKE_VFX = '@project/assets/VFX/smoke.vfx.json';

const LIFETIME = 2.5;
const GROUND_RIPPLE_SEGMENTS = 16;

const MAX_ACTIVE = 10;
let activeCount = 0;

const GROUND_GEOMETRY = new THREE.RingGeometry(0.1, 1, GROUND_RIPPLE_SEGMENTS);

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

@ENGINE.GameClass()
export class ZombieRiseVFXActor extends ENGINE.Actor {
  private groundRipple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private groundRipple2: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private elapsed = 0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
    this._createGroundRipples(root);

    const smokeVfx = ENGINE.VFXComponent.create({
      vfxPath: SPAWN_SMOKE_VFX,
      autoStart: true,
    });
    root.add(smokeVfx);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

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
      activeCount = Math.max(0, activeCount - 1);
      this.destroy();
    }
  }

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): ZombieRiseVFXActor | null {
    if (activeCount >= MAX_ACTIVE) return null;
    activeCount++;

    const actor = ZombieRiseVFXActor.create({
      position: position.clone().add(new THREE.Vector3(0, 0.1, 0)),
    });
    world.addActor(actor);
    return actor;
  }

  /** Remove active rise VFX when a mission ends or resets. */
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
    this.groundRipple2.rotation.x = -Math.PI / 2;
    this.groundRipple2.position.y = 0.01;
    this.groundRipple2.scale.setScalar(0.1);
    root.add(this.groundRipple2);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Particle';
  }
}
