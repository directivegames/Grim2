import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const LIFETIME = 1.8;
const GRAVITY = 9.5;
const SMOKE_COUNT = 5;
const CHUNK_COUNT = 8;

/** Max simultaneous gore explosions — prevents kill-streak lag. */
const MAX_ACTIVE = 3;
let activeCount = 0;

const SMOKE_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);
const CHUNK_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

interface SmokePiece {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  maxScale: number;
}

interface ChunkPiece {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
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

@ENGINE.GameClass()
export class GoreExplosionActor extends ENGINE.Actor {
  private readonly smokePieces: SmokePiece[] = [];
  private readonly chunkPieces: ChunkPiece[] = [];
  private flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private elapsed = 0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });

    this.createSmoke(root);
    this.createChunks(root);
    this.createFlash(root);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this.elapsed += deltaTime;
    const progress = Math.min(this.elapsed / LIFETIME, 1);
    const smokeAlpha = Math.max(0, 1 - progress);
    const chunkAlpha = Math.max(0, 1 - progress * 1.35);

    for (const piece of this.smokePieces) {
      piece.mesh.position.addScaledVector(piece.velocity, deltaTime);
      const scale = THREE.MathUtils.lerp(0.15, piece.maxScale, easeOutCubic(progress));
      piece.mesh.scale.setScalar(scale);
      piece.mesh.material.opacity = 0.42 * smokeAlpha;
    }

    for (const piece of this.chunkPieces) {
      piece.velocity.y -= GRAVITY * deltaTime;
      piece.mesh.position.addScaledVector(piece.velocity, deltaTime);
      piece.mesh.rotation.x += piece.spin.x * deltaTime;
      piece.mesh.rotation.y += piece.spin.y * deltaTime;
      piece.mesh.rotation.z += piece.spin.z * deltaTime;
      piece.mesh.material.opacity = chunkAlpha;
    }

    if (this.flash) {
      const flashProgress = Math.min(this.elapsed / 0.28, 1);
      this.flash.scale.setScalar(THREE.MathUtils.lerp(0.2, 2.1, easeOutCubic(flashProgress)));
      this.flash.material.opacity = Math.max(0, 0.65 * (1 - flashProgress));
    }

    if (this.elapsed >= LIFETIME) {
      activeCount = Math.max(0, activeCount - 1);
      this.destroy();
    }
  }

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): GoreExplosionActor | null {
    if (activeCount >= MAX_ACTIVE) return null;
    activeCount++;
    const actor = GoreExplosionActor.create({ position: position.clone() });
    world.addActor(actor);
    return actor;
  }

  private createSmoke(root: ENGINE.SceneComponent): void {
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(randomBetween(0.74, 0.8), 0.95, randomBetween(0.32, 0.5)),
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(SMOKE_GEOMETRY, material);
      mesh.position.set(randomBetween(-0.18, 0.18), randomBetween(0, 0.35), randomBetween(-0.18, 0.18));
      mesh.scale.setScalar(0.12);
      root.add(mesh);

      this.smokePieces.push({
        mesh,
        velocity: randomDirection(0.35).multiplyScalar(randomBetween(0.9, 2.4)),
        maxScale: randomBetween(0.45, 1.15),
      });
    }
  }

  private createChunks(root: ENGINE.SceneComponent): void {
    for (let i = 0; i < CHUNK_COUNT; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(randomBetween(0.98, 1), 0.95, randomBetween(0.22, 0.38)),
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(CHUNK_GEOMETRY, material);
      const size = randomBetween(0.05, 0.16);
      mesh.scale.set(randomBetween(size * 0.6, size * 1.7), randomBetween(size * 0.45, size), randomBetween(size * 0.6, size * 1.5));
      mesh.position.set(randomBetween(-0.08, 0.08), randomBetween(0.05, 0.25), randomBetween(-0.08, 0.08));
      root.add(mesh);

      this.chunkPieces.push({
        mesh,
        velocity: randomDirection(0.55).multiplyScalar(randomBetween(3.5, 7.5)),
        spin: new THREE.Vector3(randomBetween(-9, 9), randomBetween(-9, 9), randomBetween(-9, 9)),
      });
    }
  }

  private createFlash(root: ENGINE.SceneComponent): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff77ff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Mesh(SMOKE_GEOMETRY, material);
    this.flash.scale.setScalar(0.2);
    root.add(this.flash);
  }
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
