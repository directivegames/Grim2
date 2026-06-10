/**
 * Simplified WebGPU/TSL cloud shadow applicator.
 *
 * Upgrades MeshStandardMaterial / MeshPhysicalMaterial on scene meshes to
 * MeshBasicNodeMaterial with a world-space cloud shadow colorNode.
 * MeshBasicNodeMaterial matches the working TSL pattern used by fog/grass
 * in this project (MeshStandardNodeMaterial crashes in setup on WebGPU).
 *
 * Each patched material gets its OWN fresh node graph.
 * The `time` built-in advances automatically; no per-frame uniform pump needed.
 */
import * as THREE from 'three';
import {
  color,
  float,
  materialColor,
  positionWorld,
  smoothstep,
  texture,
  time,
  vec2,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { Node } from 'three/webgpu';

const CLOUD_PATCHED = '__grimCloudShadowSimple' as const;
const SKIP_RE = /Slash|Blood|Smoke|Blob|VFX|Trail|Summon|Ripple|GrassSway|Grass/i;

export type SimpleCloudShadowOptions = {
  cloudTexture: THREE.Texture;
  forceApply?: boolean;
  cloudScale?: number;
  cloudSpeed?: number;
  shadowStrength?: number;
  windX?: number;
  windZ?: number;
  debug?: boolean;
};

// ---------------------------------------------------------------------------
// Node graph — called ONCE PER MATERIAL so each gets its own graph instance.
// ---------------------------------------------------------------------------

function buildCloudMultiplier(
  cloudTex: THREE.Texture,
  cloudScale: number,
  cloudSpeed: number,
  shadowStrength: number,
  windX: number,
  windZ: number,
): Node {
  const t = time.mul(float(cloudSpeed));

  const uv1 = positionWorld.xz.mul(float(cloudScale)).add(vec2(windX, windZ).mul(t));
  const uv2 = positionWorld.xz
    .mul(float(cloudScale * 2.3))
    .sub(vec2(windZ, windX).mul(t.mul(float(0.45))));

  const c1 = texture(cloudTex, uv1).r;
  const c2 = texture(cloudTex, uv2).r;

  const mask = smoothstep(0.35, 0.75, c1.mul(float(0.7)).add(c2.mul(float(0.3))));

  return float(1.0).sub(mask.mul(float(shadowStrength))) as unknown as Node;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shouldSkipMesh(mesh: THREE.Mesh, forceApply: boolean, log: (s: string) => void): boolean {
  if (mesh instanceof THREE.SkinnedMesh) {
    log(`SKIP ${mesh.name} — SkinnedMesh`);
    return true;
  }
  if (forceApply) return false;
  const n = mesh.name.toLowerCase();
  if (
    n.includes('terrain') || n.includes('ground') || n.includes('environment') ||
    n.includes('cliff') || n.includes('rock') || n.includes('road') ||
    n.includes('building') || n.includes('wall') || n.includes('floor') ||
    mesh.userData.environment === true || mesh.userData.cloudShadow === true
  ) {
    return false;
  }
  log(`SKIP mesh "${mesh.name}" — not matched (set forceApply or userData.environment=true)`);
  return true;
}

function patchOneMaterial(
  mat: THREE.Material,
  cloudTex: THREE.Texture,
  cloudScale: number,
  cloudSpeed: number,
  shadowStrength: number,
  windX: number,
  windZ: number,
  log: (s: string) => void,
): THREE.Material {
  if (mat.userData[CLOUD_PATCHED]) {
    return mat;
  }

  if (SKIP_RE.test(mat.name)) {
    log(`SKIP mat "${mat.name}" — name filter`);
    return mat;
  }

  if (mat.blending === THREE.AdditiveBlending || mat.blending === THREE.SubtractiveBlending) {
    log(`SKIP mat "${mat.name}" — additive/subtractive blending`);
    return mat;
  }

   
  const m = mat as any;
  const isNode = m.isNodeMaterial === true;
  const isStd = m.isMeshStandardMaterial === true || mat.type === 'MeshStandardMaterial';
  const isPhys = m.isMeshPhysicalMaterial === true || mat.type === 'MeshPhysicalMaterial';

  if (!isNode && !isStd && !isPhys) {
    log(`SKIP mat "${mat.name}" — unsupported type ${mat.type}`);
    return mat;
  }

  // Fresh node graph per material — avoids TSL builder state conflicts.
  const multiplier = buildCloudMultiplier(
    cloudTex, cloudScale, cloudSpeed, shadowStrength, windX, windZ,
  );

  if (isNode) {
     
    m.colorNode = (materialColor as any).mul(multiplier);
    mat.userData[CLOUD_PATCHED] = true;
    mat.needsUpdate = true;
    log(`PATCH (NodeMaterial) "${mat.name}" type=${mat.type} colorNode set`);
    return mat;
  }

  const nodeMat = new MeshBasicNodeMaterial();
   
  (nodeMat as any).copy(mat);
  nodeMat.name = mat.name;

  const matColor = nodeMat.color ?? new THREE.Color(1, 1, 1);
   
  (nodeMat as any).colorNode = (color(matColor) as any).mul(multiplier);

  nodeMat.userData = { ...mat.userData, [CLOUD_PATCHED]: true };
  nodeMat.needsUpdate = true;
  log(`PATCH (upgrade) "${mat.name}" → ${nodeMat.type} map=${!!nodeMat.map} colorNode set`);
  return nodeMat;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function applySimpleCloudShadow(
  root: THREE.Object3D,
  options: SimpleCloudShadowOptions,
): number {
  const {
    cloudTexture,
    forceApply = false,
    debug = false,
    cloudScale = 0.0015,
    cloudSpeed = 0.015,
    shadowStrength = 0.3,
    windX = 1.0,
    windZ = 0.35,
  } = options;

  cloudTexture.wrapS = THREE.RepeatWrapping;
  cloudTexture.wrapT = THREE.RepeatWrapping;
  cloudTexture.colorSpace = THREE.NoColorSpace;
  cloudTexture.needsUpdate = true;

  const log = debug ? (s: string) => console.log(`[CloudShadow] ${s}`) : (_: string) => {};

  let patched = 0;

  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;

    if (shouldSkipMesh(mesh, forceApply, log)) return;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let changed = false;

    const newMats = mats.map((mat) => {
      const wasPatched = !!mat.userData[CLOUD_PATCHED];
      const result = patchOneMaterial(
        mat, cloudTexture, cloudScale, cloudSpeed, shadowStrength, windX, windZ, log,
      );
      if (!wasPatched && result.userData[CLOUD_PATCHED]) patched++;
      if (result !== mat) changed = true;
      return result;
    });

    if (changed) {
      mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
    }
  });

  if (debug) log(`Total newly patched this call: ${patched}`);
  return patched;
}
