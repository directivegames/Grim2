/**
 * Patches environment materials with world-space cloud shadows.
 * For WebGPU: upgrades MeshStandardMaterial → MeshStandardNodeMaterial with TSL colorNode.
 * For existing NodeMaterials: sets colorNode directly.
 */
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { materialColor } from 'three/tsl';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

import { CloudShadowState } from './CloudShadowState.js';
import { getCloudShadowMultiplierNode } from './cloudShadowTsl.js';
import type { CloudShadowColorNode } from './cloudShadowTsl.js';

const APPLIED_FLAG = 'grimCloudShadowApplied' as const;

const SKIP_NAME_RE = /Slash|Blood|Smoke|Blob|VFX|Trail|Summon|Ripple|GrassSway/i;

function shouldSkip(mat: THREE.Material, log: (m: string) => void): boolean {
  if (mat.userData[APPLIED_FLAG]) { log(`${mat.name}: already applied`); return true; }
  if (mat.userData.grimCloudShadowSkip) { log(`${mat.name}: skip flag`); return true; }
  if (!mat.visible) { log(`${mat.name}: not visible`); return true; }
  if (mat.blending === THREE.AdditiveBlending || mat.blending === THREE.SubtractiveBlending) {
    log(`${mat.name}: additive blending`); return true;
  }
  if (SKIP_NAME_RE.test(mat.name)) { log(`${mat.name}: name filter`); return true; }
  return false;
}

function applyToNodeMaterial(mat: THREE.Material, log: (m: string) => void): boolean {
   
  const nm = mat as any;
  const cloudMul = getCloudShadowMultiplierNode();
  if (nm.colorNode) {
    nm.colorNode = (nm.colorNode as CloudShadowColorNode).mul(cloudMul as never);
  } else {
    nm.colorNode = (materialColor as unknown as CloudShadowColorNode).mul(cloudMul as never);
  }
  mat.needsUpdate = true;
  mat.userData[APPLIED_FLAG] = true;
  log(`${mat.name || mat.uuid}: patched NodeMaterial`);
  return true;
}

function upgradeMeshSlot(mesh: THREE.Mesh, slotIdx: number, log: (m: string) => void): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const mat = materials[slotIdx];
  if (!mat) return false;

  const isStd = (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
  const isPhys = (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial === true;

  if (!isStd && !isPhys) {
    log(`${mat.name || mat.uuid}: not a standard/physical material (${mat.type}), skipping`);
    return false;
  }

  const cloudMul = getCloudShadowMultiplierNode();
  const nodeMat = isPhys ? new MeshPhysicalNodeMaterial() : new MeshStandardNodeMaterial();
   
  (nodeMat as any).copy(mat);
  nodeMat.name = mat.name;
   
  (nodeMat as any).colorNode = (materialColor as unknown as CloudShadowColorNode).mul(cloudMul as never);
  nodeMat.needsUpdate = true;
  nodeMat.userData = { ...mat.userData, [APPLIED_FLAG]: true };

  if (Array.isArray(mesh.material)) {
    mesh.material[slotIdx] = nodeMat;
  } else {
    mesh.material = nodeMat;
  }

  log(`${mat.name || mat.uuid}: upgraded → ${nodeMat.type}`);
  return true;
}

function patchMeshSlot(mesh: THREE.Mesh, slotIdx: number, log: (m: string) => void): boolean {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const mat = materials[slotIdx];
  if (!mat) return false;

  if (shouldSkip(mat, log)) return false;

  const isNode = (mat as THREE.Material & { isNodeMaterial?: boolean }).isNodeMaterial === true;
  if (isNode) {
    return applyToNodeMaterial(mat, log);
  }
  return upgradeMeshSlot(mesh, slotIdx, log);
}

export function patchObjectMaterials(root: THREE.Object3D, debugLogging: boolean): number {
  if (!CloudShadowState.textureReady) return 0;

  const log = debugLogging
    ? (m: string) => console.log(`[CloudShadow] ${m}`)
    : (_: string) => {};

  let count = 0;
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj instanceof THREE.SkinnedMesh) return;
    const slots = Array.isArray(obj.material) ? obj.material.length : 1;
    for (let i = 0; i < slots; i++) {
      if (patchMeshSlot(obj, i, log)) count++;
    }
  });
  return count;
}

export function patchWorldMaterials(world: ENGINE.World, debugLogging = false): number {
  let count = patchObjectMaterials(world.scene, debugLogging);
  for (const actor of world.getActors()) {
    if (actor.rootComponent) {
      count += patchObjectMaterials(actor.rootComponent, debugLogging);
    }
  }
  return count;
}
