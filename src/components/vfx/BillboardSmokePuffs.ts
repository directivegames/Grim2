/**
 * Textured billboard smoke/dust puffs — pure Three.js (no VFXComponent).
 * Shared by gore, zombie spawn, and fist impact effects.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PUFF_GEOMETRY = new THREE.PlaneGeometry(1.2, 1.2);
const textureCache = new Map<string, THREE.Texture>();

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

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export async function loadSmokeTexture(texturePath: string): Promise<THREE.Texture | null> {
  const cached = textureCache.get(texturePath);
  if (cached) return cached;

  try {
    const resolvedPath = await ENGINE.resolveAssetPathsInText(texturePath);
    const texture = await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        resolvedPath,
        (tex) => {
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          resolve(tex);
        },
        undefined,
        (err) => reject(err),
      );
    });
    textureCache.set(texturePath, texture);
    return texture;
  } catch {
    return null;
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

  for (let i = 0; i < options.count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(hSpeed[0], hSpeed[1]);

    const material = createBillboardSmokeMaterial({
      texture,
      blending,
      hue,
      saturation: sat,
      lightness: lit,
      opacity: peakOpacity,
    });

    const mesh = new THREE.Mesh(PUFF_GEOMETRY, material);
    mesh.scale.setScalar(planeSize * randomBetween(0.5, 0.9));
    mesh.position.copy(origin);
    mesh.position.y += randomBetween(yOff[0], yOff[1]);
    mesh.rotation.set(-Math.PI / 2, 0, randomBetween(0, Math.PI * 2));

    world.scene.add(mesh);

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
  for (let i = puffs.length - 1; i >= 0; i--) {
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
      puff.mesh.material.dispose();
      puff.mesh.removeFromParent();
      puffs.splice(i, 1);
    }
  }
}

export function disposeBillboardSmokePuffs(puffs: BillboardSmokePuff[]): void {
  for (const puff of puffs) {
    puff.mesh.material.dispose();
    puff.mesh.removeFromParent();
  }
  puffs.length = 0;
}
