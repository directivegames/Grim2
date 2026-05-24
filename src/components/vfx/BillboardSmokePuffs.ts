/**
 * Textured billboard smoke/dust puffs — pure Three.js (no VFXComponent).
 * Shared by gore, zombie spawn, and fist impact effects.
 *
 * Meshes/materials are pooled per texture path — no per-puff alloc/dispose.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PUFF_GEOMETRY = new THREE.PlaneGeometry(1.2, 1.2);
const textureCache = new Map<string, THREE.Texture>();

/** Max pooled puffs per texture (dust + gore + spawn combined). */
const POOL_SIZE_PER_TEXTURE = 96;

export interface BillboardSmokePuff {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: number;
  elapsed: number;
  lifetime: number;
  maxScale: number;
  peakOpacity: number;
}

export interface SmokeMaterialOptions {
  texture: THREE.Texture | null;
  blending?: THREE.Blending;
  hue?: [number, number];
  saturation?: [number, number];
  lightness?: [number, number];
  opacity?: number;
}

export interface SmokeBurstOptions {
  count: number;
  texturePath: string;
  lifetime?: number;
  hue?: [number, number];
  saturation?: [number, number];
  lightness?: [number, number];
  maxScale?: [number, number];
  horizontalSpeed?: [number, number];
  verticalSpeed?: [number, number];
  yOffset?: [number, number];
  peakOpacity?: number;
  size?: number;
  blending?: THREE.Blending;
}

interface PooledPuffSlot {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  inUse: boolean;
}

interface TexturePuffPool {
  texturePath: string;
  free: PooledPuffSlot[];
  slots: PooledPuffSlot[];
  sceneAttached: boolean;
}

const poolsByTexture = new Map<string, TexturePuffPool>();

const _colorScratch = new THREE.Color();

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function applyPuffColor(
  mat: THREE.MeshBasicMaterial,
  hue: [number, number],
  sat: [number, number],
  lit: [number, number],
): void {
  _colorScratch.setHSL(
    randomBetween(hue[0], hue[1]),
    randomBetween(sat[0], sat[1]),
    randomBetween(lit[0], lit[1]),
  );
  mat.color.copy(_colorScratch);
}

export function createBillboardSmokeMaterial(
  options: SmokeMaterialOptions,
): THREE.MeshBasicMaterial {
  const hue = options.hue ?? [0, 0];
  const sat = options.saturation ?? [0.4, 0.7];
  const lit = options.lightness ?? [0.5, 0.75];

  return new THREE.MeshBasicMaterial({
    color: new THREE.Color().setHSL(
      randomBetween(hue[0], hue[1]),
      randomBetween(sat[0], sat[1]),
      randomBetween(lit[0], lit[1]),
    ),
    map: options.texture ?? undefined,
    alphaMap: options.texture ?? undefined,
    transparent: true,
    opacity: options.opacity ?? 0.85,
    depthWrite: false,
    blending: options.blending ?? THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    alphaTest: 0.01,
  });
}

export async function loadSmokeTexture(texturePath: string): Promise<THREE.Texture | null> {
  const cached = textureCache.get(texturePath);
  if (cached) {
    if (!cached.userData.smokeTexturePath) {
      cached.userData.smokeTexturePath = texturePath;
    }
    return cached;
  }

  try {
    const resolvedPath = await ENGINE.resolveAssetPathsInText(texturePath);
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        resolvedPath,
        (tex) => {
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        (err) => reject(err),
      );
    });
    texture.userData.smokeTexturePath = texturePath;
    textureCache.set(texturePath, texture);
    return texture;
  } catch {
    return null;
  }
}

function getOrCreatePool(texturePath: string, texture: THREE.Texture | null): TexturePuffPool {
  let pool = poolsByTexture.get(texturePath);
  if (!pool) {
    pool = { texturePath, free: [], slots: [], sceneAttached: false };
    poolsByTexture.set(texturePath, pool);
  }

  while (pool.slots.length < POOL_SIZE_PER_TEXTURE) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: texture ?? undefined,
      alphaMap: texture ?? undefined,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      alphaTest: texture ? 0.08 : 0,
    });
    const mesh = new THREE.Mesh(PUFF_GEOMETRY, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    const slot: PooledPuffSlot = { mesh, inUse: false };
    pool.slots.push(slot);
    pool.free.push(slot);
  }

  if (texture) {
    for (const slot of pool.slots) {
      const mat = slot.mesh.material;
      if (!mat.map) {
        mat.map = texture;
        mat.alphaMap = texture;
        mat.alphaTest = 0.08;
        mat.needsUpdate = true;
      }
    }
  }

  return pool;
}

function ensurePoolInScene(world: ENGINE.World, pool: TexturePuffPool): void {
  if (pool.sceneAttached) return;
  for (const slot of pool.slots) {
    world.scene.add(slot.mesh);
  }
  pool.sceneAttached = true;
}

function acquirePuff(pool: TexturePuffPool): PooledPuffSlot | null {
  if (pool.free.length === 0) {
    for (const slot of pool.slots) {
      if (!slot.inUse) {
        pool.free.push(slot);
      }
    }
  }
  const slot = pool.free.pop();
  if (!slot) return null;
  slot.inUse = true;
  return slot;
}

function releasePuff(pool: TexturePuffPool, mesh: THREE.Mesh): void {
  mesh.visible = false;
  for (const slot of pool.slots) {
    if (slot.mesh === mesh) {
      slot.inUse = false;
      pool.free.push(slot);
      return;
    }
  }
}

export function spawnBillboardSmokeBurst(
  world: ENGINE.World,
  origin: THREE.Vector3,
  texture: THREE.Texture | null,
  puffs: BillboardSmokePuff[],
  options: SmokeBurstOptions,
): void {
  const lifetime = options.lifetime ?? 1.4;
  const hue = options.hue ?? [0, 0];
  const sat = options.saturation ?? [0.4, 0.7];
  const lit = options.lightness ?? [0.5, 0.75];
  const maxScale = options.maxScale ?? [1.4, 2.4];
  const hSpeed = options.horizontalSpeed ?? [0.8, 2.5];
  const vSpeed = options.verticalSpeed ?? [0.3, 1.2];
  const yOff = options.yOffset ?? [-0.05, 0.2];
  const peakOpacity = options.peakOpacity ?? 0.85;
  const planeSize = options.size ?? 1.2;
  const blending = options.blending ?? THREE.AdditiveBlending;

  const pool = getOrCreatePool(options.texturePath, texture);
  ensurePoolInScene(world, pool);

  for (let i = 0; i < options.count; i++) {
    const slot = acquirePuff(pool);
    if (!slot) break;

    const mesh = slot.mesh;
    const mat = mesh.material;
    mat.blending = blending;
    applyPuffColor(mat, hue, sat, lit);
    mat.opacity = peakOpacity;

    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(hSpeed[0], hSpeed[1]);

    mesh.scale.setScalar(planeSize * randomBetween(0.5, 0.9));
    mesh.position.copy(origin);
    mesh.position.y += randomBetween(yOff[0], yOff[1]);
    mesh.rotation.set(-Math.PI / 2, 0, randomBetween(0, Math.PI * 2));
    mesh.visible = true;
    mesh.userData.poolTexturePath = options.texturePath;

    puffs.push({
      mesh,
      velocity: new THREE.Vector3(
        Math.cos(angle) * speed,
        randomBetween(vSpeed[0], vSpeed[1]),
        Math.sin(angle) * speed,
      ),
      spin: randomBetween(-1.8, 1.8),
      elapsed: randomBetween(0, 0.12),
      lifetime,
      maxScale: randomBetween(maxScale[0], maxScale[1]),
      peakOpacity,
    });
  }
}

export function tickBillboardSmokePuffs(puffs: BillboardSmokePuff[], deltaTime: number): void {
  let writeIdx = 0;

  for (let i = 0; i < puffs.length; i++) {
    const puff = puffs[i]!;
    puff.elapsed += deltaTime;
    const progress = Math.min(puff.elapsed / puff.lifetime, 1);
    const scale = THREE.MathUtils.lerp(0.45, puff.maxScale, easeOutCubic(progress));
    puff.mesh.scale.setScalar(scale);
    puff.mesh.position.addScaledVector(puff.velocity, deltaTime);
    puff.velocity.multiplyScalar(0.96);
    puff.mesh.rotation.z += puff.spin * deltaTime;
    puff.mesh.material.opacity = puff.peakOpacity * Math.max(0, 1 - progress);

    if (progress >= 1) {
      puff.mesh.visible = false;
      const texPath = puff.mesh.userData.poolTexturePath as string | undefined;
      const pool = texPath ? poolsByTexture.get(texPath) : undefined;
      if (pool) {
        releasePuff(pool, puff.mesh);
      }
    } else {
      puffs[writeIdx++] = puff;
    }
  }

  puffs.length = writeIdx;
}

export function disposeBillboardSmokePuffs(puffs: BillboardSmokePuff[]): void {
  for (const puff of puffs) {
    puff.mesh.visible = false;
    const texPath = puff.mesh.userData.poolTexturePath as string | undefined;
    const pool = texPath ? poolsByTexture.get(texPath) : undefined;
    if (pool) releasePuff(pool, puff.mesh);
  }
  puffs.length = 0;
}
