/**
 * GoreExplosionActor — Blood/gore explosion effect on zombie kill.
 *
 * - Blood chunks, drops, flash, shockwave: pure Three.js geometry (no texture needed)
 * - Blood smoke cloud: ENGINE.VFXComponent via gore-smoke.vfx.json
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

/** Total actor lifetime — must outlive chunk fall + gore-smoke particle life (0.5s emit + 1.6s live). */
const LIFETIME = 2.5;
const GRAVITY = 9.5;
const CHUNK_COUNT = 8;
const BLOOD_DROP_COUNT = 16;

/** Max simultaneous gore explosions — prevents kill-streak lag. */
const MAX_ACTIVE = 3;
let activeCount = 0;

const CHUNK_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);
const SHOCKWAVE_GEOMETRY = new THREE.TorusGeometry(1, 0.035, 6, 32);
const FLASH_GEOMETRY = new THREE.SphereGeometry(1, 16, 12);
const DROP_GEOMETRY = new THREE.PlaneGeometry(0.06, 0.3);

interface ChunkPiece {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
}

interface BloodDrop {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  elapsed: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomDirection(upBias: number): THREE.Vector3 {
  const angle = Math.random() * Math.PI * 2;
  const radius = randomBetween(0.25, 1);
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    randomBetween(-0.2, 1) + upBias,
    Math.sin(angle) * radius
  ).normalize();
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

@ENGINE.GameClass()
export class GoreExplosionActor extends ENGINE.Actor {
  private readonly chunkPieces: ChunkPiece[] = [];
  private readonly bloodDrops: BloodDrop[] = [];
  private flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private shockwave: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
  private elapsed = 0;
  private _vfx: ENGINE.VFXComponent | null = null;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });

    this._createChunks(root);
    this._createFlash(root);
    this._createShockwave(root);

    this._vfx = ENGINE.VFXComponent.create({
      vfxPath: '@project/assets/VFX/gore-smoke.vfx.json',
      autoStart: false,
    });
    root.add(this._vfx);
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const world = this.getWorld();
    if (!world) return;

    const origin = this.rootComponent.position;

    this._vfx?.startEmitting();
    this._spawnBloodDrops(world, origin);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this.elapsed += deltaTime;
    const progress = Math.min(this.elapsed / LIFETIME, 1);
    const chunkAlpha = Math.max(0, 1 - progress * 1.35);

    // Update chunks
    for (const piece of this.chunkPieces) {
      piece.velocity.y -= GRAVITY * deltaTime;
      piece.mesh.position.addScaledVector(piece.velocity, deltaTime);
      piece.mesh.rotation.x += piece.spin.x * deltaTime;
      piece.mesh.rotation.y += piece.spin.y * deltaTime;
      piece.mesh.rotation.z += piece.spin.z * deltaTime;
      piece.mesh.material.opacity = chunkAlpha;
    }

    // Update blood drops
    for (let i = this.bloodDrops.length - 1; i >= 0; i--) {
      const drop = this.bloodDrops[i];
      drop.elapsed += deltaTime;

      drop.velocity.y -= GRAVITY * 1.5 * deltaTime;
      drop.mesh.position.addScaledVector(drop.velocity, deltaTime);
      drop.mesh.rotation.z = Math.atan2(drop.velocity.x, drop.velocity.y);

      const dropProgress = Math.min(drop.elapsed / 0.8, 1);
      drop.mesh.material.opacity = Math.max(0, 1 - dropProgress);

      if (dropProgress >= 1 || drop.mesh.position.y < -1) {
        drop.mesh.material.dispose();
        drop.mesh.removeFromParent();
        this.bloodDrops.splice(i, 1);
      }
    }

    // Update flash
    if (this.flash) {
      const t = Math.min(this.elapsed / 0.25, 1);
      this.flash.scale.setScalar(THREE.MathUtils.lerp(0.3, 2.5, easeOutCubic(t)));
      this.flash.material.opacity = Math.max(0, 0.9 * (1 - t));
    }

    // Update shockwave
    if (this.shockwave) {
      const t = Math.min(this.elapsed / 0.4, 1);
      this.shockwave.scale.setScalar(THREE.MathUtils.lerp(0.2, 2.2, easeOutCubic(t)));
      this.shockwave.material.opacity = Math.max(0, 0.6 * (1 - t));
    }

    if (this.elapsed >= LIFETIME) {
      activeCount = Math.max(0, activeCount - 1);
      this.destroy();
    }
  }

  protected override doEndPlay(): void {
    for (const drop of this.bloodDrops) {
      drop.mesh.material.dispose();
      drop.mesh.removeFromParent();
    }
    this.bloodDrops.length = 0;
    super.doEndPlay();
  }

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): GoreExplosionActor | null {
    if (activeCount >= MAX_ACTIVE) return null;
    activeCount++;
    const actor = GoreExplosionActor.create({ position: position.clone() });
    world.addActor(actor);
    return actor;
  }

  private _spawnBloodDrops(world: ENGINE.World, origin: THREE.Vector3): void {
    for (let i = 0; i < BLOOD_DROP_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(3.0, 8.0);

      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(randomBetween(0.98, 1.02), 0.9, 0.5),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(DROP_GEOMETRY, material);
      mesh.position.copy(origin);
      mesh.position.y += randomBetween(0.05, 0.25);
      world.scene.add(mesh);

      this.bloodDrops.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          randomBetween(2.0, 6.0),
          Math.sin(angle) * speed
        ),
        elapsed: 0,
      });
    }
  }

  private _createChunks(root: ENGINE.SceneComponent): void {
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(randomBetween(0.97, 1.02), 0.85, randomBetween(0.35, 0.55)),
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(CHUNK_GEOMETRY, material);
      const size = randomBetween(0.05, 0.18);
      mesh.scale.set(
        randomBetween(size * 0.6, size * 1.7),
        randomBetween(size * 0.45, size),
        randomBetween(size * 0.6, size * 1.5)
      );
      mesh.position.set(
        randomBetween(-0.08, 0.08),
        randomBetween(0.05, 0.25),
        randomBetween(-0.08, 0.08)
      );
      root.add(mesh);

      this.chunkPieces.push({
        mesh,
        velocity: randomDirection(0.55).multiplyScalar(randomBetween(3.5, 8.0)),
        spin: new THREE.Vector3(randomBetween(-9, 9), randomBetween(-9, 9), randomBetween(-9, 9)),
      });
    }
  }

  private _createFlash(root: ENGINE.SceneComponent): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff1100,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(FLASH_GEOMETRY, material);
    this.flash.scale.setScalar(0.3);
    root.add(this.flash);
  }

  private _createShockwave(root: ENGINE.SceneComponent): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff3300,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shockwave = new THREE.Mesh(SHOCKWAVE_GEOMETRY, material);
    this.shockwave.rotation.x = Math.PI / 2;
    this.shockwave.position.y = 0.04;
    this.shockwave.scale.setScalar(0.2);
    root.add(this.shockwave);
  }
}
