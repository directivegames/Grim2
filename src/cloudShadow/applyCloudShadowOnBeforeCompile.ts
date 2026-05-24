/**
 * World-space cloud shadows via GLSL onBeforeCompile on MeshStandardMaterial /
 * MeshPhysicalMaterial. No TSL / NodeMaterial — safe when WebGPU node materials crash.
 */
import * as THREE from 'three';

const PATCHED = '__cloudShadowOnBeforeCompile' as const;
const CACHE_KEY = 'grim_cloud_shadow_obc_v1';
const SKIP_RE = /Slash|Blood|Smoke|Blob|VFX|Trail|Summon|Ripple|GrassSway|Grass/i;

export type CloudShadowOnBeforeCompileOptions = {
  cloudTexture: THREE.Texture;
  forceApply?: boolean;
  debug?: boolean;
  cloudScale?: number;
  cloudSpeed?: number;
  shadowStrength?: number;
  windX?: number;
  windZ?: number;
};

type ResolvedCloudShadowOptions = Required<
  Omit<CloudShadowOnBeforeCompileOptions, 'cloudTexture'>
> & { cloudTexture: THREE.Texture };

type CloudShadowUniforms = {
  uCloudShadowTex: THREE.IUniform<THREE.Texture>;
  uCloudShadowTime: THREE.IUniform<number>;
  uCloudShadowScale: THREE.IUniform<number>;
  uCloudShadowSpeed: THREE.IUniform<number>;
  uCloudShadowStrength: THREE.IUniform<number>;
  uCloudShadowWind: THREE.IUniform<THREE.Vector2>;
};

function shouldPatchMesh(mesh: THREE.Mesh, forceApply: boolean): boolean {
  if (mesh instanceof THREE.SkinnedMesh) {
    return false;
  }
  if (forceApply) {
    return true;
  }

  const name = mesh.name.toLowerCase();

  return (
    name.includes('terrain')
    || name.includes('ground')
    || name.includes('environment')
    || name.includes('cliff')
    || name.includes('rock')
    || name.includes('road')
    || name.includes('building')
    || name.includes('wall')
    || name.includes('floor')
    || mesh.userData.environment === true
    || mesh.userData.cloudShadow === true
  );
}

function createUniforms(options: ResolvedCloudShadowOptions): CloudShadowUniforms {
  return {
    uCloudShadowTex: { value: options.cloudTexture },
    uCloudShadowTime: { value: 0 },
    uCloudShadowScale: { value: options.cloudScale },
    uCloudShadowSpeed: { value: options.cloudSpeed },
    uCloudShadowStrength: { value: options.shadowStrength },
    uCloudShadowWind: { value: new THREE.Vector2(options.windX, options.windZ) },
  };
}

function syncUniformValues(uniforms: CloudShadowUniforms, options: ResolvedCloudShadowOptions): void {
  uniforms.uCloudShadowTex.value = options.cloudTexture;
  uniforms.uCloudShadowScale.value = options.cloudScale;
  uniforms.uCloudShadowSpeed.value = options.cloudSpeed;
  uniforms.uCloudShadowStrength.value = options.shadowStrength;
  uniforms.uCloudShadowWind.value.set(options.windX, options.windZ);
}

function injectCloudShadowGlsl(
  shader: THREE.WebGLProgramParametersWithUniforms,
  uniforms: CloudShadowUniforms,
): void {
  shader.uniforms.uCloudShadowTex = uniforms.uCloudShadowTex;
  shader.uniforms.uCloudShadowTime = uniforms.uCloudShadowTime;
  shader.uniforms.uCloudShadowScale = uniforms.uCloudShadowScale;
  shader.uniforms.uCloudShadowSpeed = uniforms.uCloudShadowSpeed;
  shader.uniforms.uCloudShadowStrength = uniforms.uCloudShadowStrength;
  shader.uniforms.uCloudShadowWind = uniforms.uCloudShadowWind;

  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
varying vec3 vCloudShadowWorldPos;
`,
  );

  shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
vCloudShadowWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`,
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
uniform sampler2D uCloudShadowTex;
uniform float uCloudShadowTime;
uniform float uCloudShadowScale;
uniform float uCloudShadowSpeed;
uniform float uCloudShadowStrength;
uniform vec2 uCloudShadowWind;
varying vec3 vCloudShadowWorldPos;
`,
  );

  const shadowBlock = `
{
  vec2 cloudUv1 =
    vCloudShadowWorldPos.xz * uCloudShadowScale +
    uCloudShadowWind * uCloudShadowTime * uCloudShadowSpeed;

  vec2 cloudUv2 =
    vCloudShadowWorldPos.xz * uCloudShadowScale * 2.3 -
    vec2(uCloudShadowWind.y, uCloudShadowWind.x) *
    uCloudShadowTime * uCloudShadowSpeed * 0.45;

  float cloud1 = texture2D(uCloudShadowTex, cloudUv1).r;
  float cloud2 = texture2D(uCloudShadowTex, cloudUv2).r;

  float cloudMask = smoothstep(0.35, 0.75, cloud1 * 0.7 + cloud2 * 0.3);
  float cloudShadow = mix(1.0, 1.0 - uCloudShadowStrength, cloudMask);

  gl_FragColor.rgb *= cloudShadow;
}
`;

  if (shader.fragmentShader.includes('#include <dithering_fragment>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `${shadowBlock}
#include <dithering_fragment>`,
    );
  } else {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `#include <output_fragment>
${shadowBlock}`,
    );
  }
}

function patchMaterial(
  material: THREE.Material,
  options: ResolvedCloudShadowOptions,
): boolean {
  if (material.userData[PATCHED]) {
    return false;
  }

  if (SKIP_RE.test(material.name)) {
    return false;
  }

  if (
    material.blending === THREE.AdditiveBlending
    || material.blending === THREE.SubtractiveBlending
  ) {
    return false;
  }

  const mat = material as THREE.MeshStandardMaterial;
  const isStandard =
    (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
    || (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial === true
    || mat.type === 'MeshStandardMaterial'
    || mat.type === 'MeshPhysicalMaterial';

  if (!isStandard) {
    return false;
  }

  mat.userData[PATCHED] = true;

  const uniforms = createUniforms(options);
  mat.userData.cloudShadowUniforms = uniforms;

  mat.customProgramCacheKey = () => CACHE_KEY;

  const previousOnBeforeCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    syncUniformValues(uniforms, options);
    injectCloudShadowGlsl(shader, uniforms);
    mat.userData.cloudShadowShader = shader;
  };

  mat.addEventListener('dispose', () => {
    delete mat.userData.cloudShadowShader;
    delete mat.userData.cloudShadowUniforms;
  });

  mat.needsUpdate = true;
  return true;
}

function patchObject(root: THREE.Object3D, options: ResolvedCloudShadowOptions): number {
  let count = 0;

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }
    if (!shouldPatchMesh(mesh, options.forceApply)) {
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material && patchMaterial(material, options)) {
        count++;
      }
    }
  });

  return count;
}

export function applyCloudShadowOnBeforeCompile(
  root: THREE.Object3D,
  options: CloudShadowOnBeforeCompileOptions,
): number {
  const fullOptions: ResolvedCloudShadowOptions = {
    cloudTexture: options.cloudTexture,
    forceApply: options.forceApply ?? false,
    debug: options.debug ?? false,
    cloudScale: options.debug ? 0.01 : (options.cloudScale ?? 0.0015),
    cloudSpeed: options.debug ? 0.1 : (options.cloudSpeed ?? 0.015),
    shadowStrength: options.debug ? 0.8 : (options.shadowStrength ?? 0.3),
    windX: options.windX ?? 1.0,
    windZ: options.windZ ?? 0.35,
  };

  fullOptions.cloudTexture.wrapS = THREE.RepeatWrapping;
  fullOptions.cloudTexture.wrapT = THREE.RepeatWrapping;
  fullOptions.cloudTexture.colorSpace = THREE.NoColorSpace;
  fullOptions.cloudTexture.needsUpdate = true;

  const count = patchObject(root, fullOptions);

  if (fullOptions.debug) {
    console.log(`[CloudShadow] onBeforeCompile patched ${count} materials`);
  }

  return count;
}

/** Push elapsed time (and optional live settings) into patched materials. */
export function updateCloudShadowUniforms(
  root: THREE.Object3D,
  timeSeconds: number,
  settings?: Partial<Pick<CloudShadowOnBeforeCompileOptions, 'cloudScale' | 'cloudSpeed' | 'shadowStrength' | 'windX' | 'windZ'>>,
): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const uniforms = material.userData?.cloudShadowUniforms as CloudShadowUniforms | undefined;
      if (!uniforms) {
        continue;
      }

      uniforms.uCloudShadowTime.value = timeSeconds;

      if (settings?.cloudScale !== undefined) {
        uniforms.uCloudShadowScale.value = settings.cloudScale;
      }
      if (settings?.cloudSpeed !== undefined) {
        uniforms.uCloudShadowSpeed.value = settings.cloudSpeed;
      }
      if (settings?.shadowStrength !== undefined) {
        uniforms.uCloudShadowStrength.value = settings.shadowStrength;
      }
      if (settings?.windX !== undefined || settings?.windZ !== undefined) {
        const wind = uniforms.uCloudShadowWind.value;
        if (settings.windX !== undefined) wind.x = settings.windX;
        if (settings.windZ !== undefined) wind.y = settings.windZ;
      }
    }
  });
}
