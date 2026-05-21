/**
 * GoreExplosionActor — Blood/gore explosion effect on zombie kill.
 *
 * Chunks, drops, flash, shockwave + textured blood burst sprites (no VFXComponent).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import {
  type BillboardSmokePuff,
  disposeBillboardSmokePuffs,
  loadSmokeTexture,
  spawnBillboardSmokeBurst,
  tickBillboardSmokePuffs,
} from '../components/vfx/BillboardSmokePuffs.js';

const LIFETIME = 2.5;
const GRAVITY = 9.5;
const CHUNK_COUNT = 8;
const BLOOD_DROP_COUNT = 16;
const BLOOD_BURST_PUFF_COUNT = 16;
/** BloodFX Batch 1 spritesheet — row 2 = side splatter frames (matches weapon hit splatter). */
const BLOOD_BURST_TEXTURE_PATH =
  '@project/assets/VFX/BloodFX Batch 1/VFX Blood Batch 1_SpriteSheetRows.png';
const BLOOD_BURST_ROW = 1;
const BLOOD_BURST_ROW_COUNT = 9;
const BLOOD_BURST_FRAME_COUNT = 7;
const goreBloodTexturePromise = loadSmokeTexture(BLOOD_BURST_TEXTURE_PATH);
let goreBloodBaseTexture: THREE.Texture | null = null;

function applyBloodBurstFrameUV(texture: THREE.Texture, frameIndex: number): void {
  texture.repeat.set(1 / BLOOD_BURST_FRAME_COUNT, 1 / BLOOD_BURST_ROW_COUNT);
  texture.offset.set(
    frameIndex / BLOOD_BURST_FRAME_COUNT,
    (BLOOD_BURST_ROW_COUNT - BLOOD_BURST_ROW - 1) / BLOOD_BURST_ROW_COUNT,
  );
}

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
    Math.sin(angle) * radius,
  ).normalize();
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

@ENGINE.GameClass()
export class GoreExplosionActor extends ENGINE.Actor {
  private readonly chunkPieces: ChunkPiece[] = [];
  private readonly bloodDrops: BloodDrop[] = [];
  private readonly bloodBurstPuffs: BillboardSmokePuff[] = [];
  private flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private shockwave: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
  private elapsed = 0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });

    this._createChunks(root);
    this._createFlash(root);
    this._createShockwave(root);
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const world = this.getWorld();
    if (!world) return;

    const origin = this.rootComponent.position;
    void this._spawnBloodBurst(world, origin);
    this._spawnBloodDrops(world, origin);
  }

  private async _spawnBloodBurst(world: ENGINE.World, origin: THREE.Vector3): Promise<void> {
    const bloodTexture = await goreBloodTexturePromise;
    if (bloodTexture) {
      goreBloodBaseTexture = bloodTexture;
    }
    const puffCountBefore = this.bloodBurstPuffs.length;
    spawnBillboardSmokeBurst(world, origin, bloodTexture, this.bloodBurstPuffs, {
      count: BLOOD_BURST_PUFF_COUNT,
      texturePath: BLOOD_BURST_TEXTURE_PATH,
      lifetime: 1.6,
      hue: [0, 0],
      saturation: [0, 0],
      lightness: [0.95, 1],
      maxScale: [1.2, 2.2],
      horizontalSpeed: [0.6, 2.0],
      verticalSpeed: [0.5, 1.4],
      peakOpacity: 0.95,
      size: 1.1,
      blending: THREE.NormalBlending,
    });

    if (!bloodTexture) {
      return;
    }

    for (let i = puffCountBefore; i < this.bloodBurstPuffs.length; i++) {
      const puff = this.bloodBurstPuffs[i]!;
      const mat = puff.mesh.material;
      const frame = Math.floor(Math.random() * BLOOD_BURST_FRAME_COUNT);
      const tex = bloodTexture.clone();
      applyBloodBurstFrameUV(tex, frame);
      mat.map = tex;
      mat.alphaMap = tex;
      mat.color.setHex(0xffffff);
      mat.blending = THREE.NormalBlending;
      mat.needsUpdate = true;
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this.elapsed += deltaTime;
    const progress = Math.min(this.elapsed / LIFETIME, 1);
    const chunkAlpha = Math.max(0, 1 - progress * 1.35);

    tickBillboardSmokePuffs(this.bloodBurstPuffs, deltaTime);

    for (const piece of this.chunkPieces) {
      piece.velocity.y -= GRAVITY * deltaTime;
      piece.mesh.position.addScaledVector(piece.velocity, deltaTime);
      piece.mesh.rotation.x += piece.spin.x * deltaTime;
      piece.mesh.rotation.y += piece.spin.y * deltaTime;
      piece.mesh.rotation.z += piece.spin.z * deltaTime;
      piece.mesh.material.opacity = chunkAlpha;
    }

    let writeIdx = 0;
    for (let i = 0; i < this.bloodDrops.length; i++) {
      const drop = this.bloodDrops[i]!;
      drop.elapsed += deltaTime;

      drop.velocity.y -= GRAVITY * 1.5 * deltaTime;
      drop.mesh.position.addScaledVector(drop.velocity, deltaTime);
      drop.mesh.rotation.z = Math.atan2(drop.velocity.x, drop.velocity.y);

      const dropProgress = Math.min(drop.elapsed / 0.8, 1);
      drop.mesh.material.opacity = Math.max(0, 1 - dropProgress);

      if (dropProgress >= 1 || drop.mesh.position.y < -1) {
        drop.mesh.material.dispose();
        drop.mesh.removeFromParent();
      } else {
        this.bloodDrops[writeIdx++] = drop;
      }
    }
    this.bloodDrops.length = writeIdx;

    if (this.flash) {
      const t = Math.min(this.elapsed / 0.25, 1);
      this.flash.scale.setScalar(THREE.MathUtils.lerp(0.3, 2.5, easeOutCubic(t)));
      this.flash.material.opacity = Math.max(0, 0.9 * (1 - t));
    }

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
    for (const puff of this.bloodBurstPuffs) {
      const map = puff.mesh.material.map;
      if (map && map !== goreBloodBaseTexture) {
        map.dispose();
      }
    }
    disposeBillboardSmokePuffs(this.bloodBurstPuffs);

    for (const piece of this.chunkPieces) {
      piece.mesh.material.dispose();
      piece.mesh.removeFromParent();
    }
    this.chunkPieces.length = 0;

    if (this.flash) {
      this.flash.material.dispose();
      this.flash.removeFromParent();
      this.flash = null;
    }
    if (this.shockwave) {
      this.shockwave.material.dispose();
      this.shockwave.removeFromParent();
      this.shockwave = null;
    }

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
          Math.sin(angle) * speed,
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
        randomBetween(size * 0.6, size * 1.5),
      );
      mesh.position.set(
        randomBetween(-0.08, 0.08),
        randomBetween(0.05, 0.25),
        randomBetween(-0.08, 0.08),
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
      color: 0x5a8fc8,
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
