/**
 * WebGPU/TSL runtime grass sway material matching {@link GrassSwayShaderMaterial}.
 *
 * Note: Three WebGPU backend cannot run raw ShaderMaterial; Genesys converts the source
 * ShaderMaterial to this NodeMaterial via renderer `library.fromMaterial`.
 */
import * as THREE from 'three';
import {
  clamp,
  float,
  Fn,
  length,
  max,
  modelWorldMatrix,
  normalize,
  positionLocal,
  step,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

import type { GrassSwayShaderMaterial } from './GrassSwayShaderMaterial.js';

export class GenesysGrassSwayNodeMaterial extends MeshBasicNodeMaterial {
  declare userData: THREE.Material['userData'] & {
    genesysGrassSource?: GrassSwayShaderMaterial;
  };

  readonly uTime = uniform(float(0));
  readonly uWindSpeed = uniform(float(1.8));
  readonly uWindRigidness = uniform(float(25.0));
  readonly uWindAmplitude = uniform(float(0.03));
  readonly uYOffset = uniform(float(0.0));

  readonly uInteractorPos = uniform(vec3(0, -9999, 0));
  readonly uInteractorRadius = uniform(float(1.2));
  readonly uInteractorStrength = uniform(float(0.12));
  readonly uAlphaTest = uniform(float(0.3));

  // A tiny "heartbeat" uniform used to sync non-TSL properties every frame.
  readonly uSync = uniform(float(0));

  constructor(source: GrassSwayShaderMaterial) {
    super();
    this.userData.genesysGrassSource = source;

    // Pull uniforms from source per frame.
    this.uTime.onObjectUpdate(() => (this.uTime.value = source.uniforms.uTime.value as number));
    this.uWindSpeed.onObjectUpdate(() => (this.uWindSpeed.value = source.uniforms.uWindSpeed.value as number));
    this.uWindRigidness.onObjectUpdate(() => (this.uWindRigidness.value = source.uniforms.uWindRigidness.value as number));
    this.uWindAmplitude.onObjectUpdate(() => (this.uWindAmplitude.value = source.uniforms.uWindAmplitude.value as number));
    this.uYOffset.onObjectUpdate(() => (this.uYOffset.value = source.uniforms.uYOffset.value as number));
    this.uInteractorRadius.onObjectUpdate(() => (this.uInteractorRadius.value = source.uniforms.uInteractorRadius.value as number));
    this.uInteractorStrength.onObjectUpdate(() => (this.uInteractorStrength.value = source.uniforms.uInteractorStrength.value as number));
    this.uInteractorPos.onObjectUpdate(() => {
      const v = source.uniforms.uInteractorPos.value as THREE.Vector3;
      this.uInteractorPos.value.set(v.x, v.y, v.z);
    });
    this.uAlphaTest.onObjectUpdate(() => (this.uAlphaTest.value = source.uniforms.uAlphaTest.value as number));

    // Keep map/opacity/alphaTest in sync even in editor (when uTime may not advance).
    this.uSync.onObjectUpdate(() => {
      const srcMap = (source as unknown as { map?: unknown }).map;
      this.map = srcMap instanceof THREE.Texture ? srcMap : new THREE.Texture();
      this.opacity = source.uniforms.uOpacity.value as number;
      this.alphaTest = source.uniforms.uAlphaTest.value as number;
      this.transparent = true;
      this.depthWrite = false;
      this.side = THREE.DoubleSide;
      this.uSync.value += 0.00001;
    });

    // Vertex displacement in world-space phase, applied in local.
    this.positionNode = Fn(() => {
      const pos = positionLocal.toVar();
      const worldPos = modelWorldMatrix.mul(vec4(pos, 1.0)).xyz;

      const heightMask = max(float(0.0), pos.y.sub(this.uYOffset));
      const rigid = max(float(0.001), this.uWindRigidness);
      const phase = this.uTime.mul(this.uWindSpeed);

      const wx = worldPos.x.div(rigid).add(phase).sin();
      const wz = worldPos.z.div(rigid).add(phase).sin();

      pos.x.assign(pos.x.add(wx.mul(heightMask).mul(this.uWindAmplitude)));
      pos.z.assign(pos.z.add(wz.mul(heightMask).mul(this.uWindAmplitude)));

      // Interaction push: away in XZ.
      const toInteractor = worldPos.sub(this.uInteractorPos);
      const dist = length(toInteractor.xz);
      const t = float(1.0).sub(clamp(dist.div(max(float(0.001), this.uInteractorRadius)), float(0.0), float(1.0)));
      const push = t.mul(t).mul(this.uInteractorStrength).mul(step(this.uYOffset, pos.y));

      const dir = normalize(toInteractor.xz);
      pos.x.assign(pos.x.add(dir.x.mul(push)));
      pos.z.assign(pos.z.add(dir.y.mul(push)));

      // Convert back to local if we ever modified in world; currently local-only.
      return pos;
    })();

    // Fragment: use built-in `map` + alphaTest pipeline (set via uSync above).
    const srcMap = (source as unknown as { map?: unknown }).map;
    this.map = srcMap instanceof THREE.Texture ? srcMap : new THREE.Texture();
    this.opacity = source.uniforms.uOpacity.value as number;
    this.alphaTest = source.uniforms.uAlphaTest.value as number;
    this.transparent = true;
    this.depthWrite = false;
    this.side = THREE.DoubleSide;
  }
}

