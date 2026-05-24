/**
 * GLSL injection for MeshStandardMaterial / MeshPhysicalMaterial (WebGL path).
 */
import * as THREE from 'three';

import { CloudShadowState } from './CloudShadowState.js';

const GLSL_APPLIED = 'grimCloudShadowGlsl' as const;
const CACHE_KEY = 'grim_cloud_shadow_v2';

const VERTEX_UNIFORMS = /* glsl */ `
uniform float uCloudTime;
uniform float uCloudScale;
uniform float uCloudSpeed;
uniform vec2 uCloudWindDir;
uniform float uCloudEnabled;
uniform float uLayer2ScaleMul;
uniform float uLayer2SpeedMul;
`;

const FRAGMENT_UNIFORMS = /* glsl */ `
uniform sampler2D uCloudMap;
uniform float uCloudTime;
uniform float uCloudScale;
uniform float uCloudSpeed;
uniform vec2 uCloudWindDir;
uniform float uCloudShadowStrength;
uniform float uCloudLow;
uniform float uCloudHigh;
uniform float uCloudEnabled;
uniform float uLayer2ScaleMul;
uniform float uLayer2SpeedMul;
`;

const FRAGMENT_BODY = /* glsl */ `
float grimTriPlanarCloud(vec3 worldPos, vec3 worldNormal, float scaleMul, float speedMul) {
  float scale = uCloudScale * scaleMul;
  vec2 scroll = uCloudWindDir * uCloudTime * uCloudSpeed * speedMul;
  vec2 scrollOrtho = vec2(uCloudWindDir.y, -uCloudWindDir.x) * uCloudTime * uCloudSpeed * speedMul;

  vec3 n = abs(worldNormal);
  float wSum = max(n.x + n.y + n.z, 0.0001);
  vec3 blend = n / wSum;

  float sx = texture2D(uCloudMap, worldPos.yz * scale + scroll).r;
  float sy = texture2D(uCloudMap, worldPos.xz * scale + scroll).r;
  float sz = texture2D(uCloudMap, worldPos.xy * scale + scrollOrtho).r;
  return sx * blend.x + sy * blend.y + sz * blend.z;
}

float grimCloudShadowFactor(vec3 worldPos, vec3 worldNormal) {
  float cloud1 = grimTriPlanarCloud(worldPos, worldNormal, 1.0, 1.0);
  float cloud2 = grimTriPlanarCloud(worldPos, worldNormal, uLayer2ScaleMul, uLayer2SpeedMul);
  float cloudMask = cloud1 * 0.7 + cloud2 * 0.3;
  cloudMask = smoothstep(uCloudLow, uCloudHigh, cloudMask);
  return mix(1.0, 1.0 - uCloudShadowStrength, cloudMask) * uCloudEnabled + (1.0 - uCloudEnabled);
}
`;

type StandardMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

function syncGlslUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
  const tex = CloudShadowState.gpuTexture ?? CloudShadowState.uCloudMap.value;
  shader.uniforms.uCloudMap = { value: tex };
  shader.uniforms.uCloudTime = { value: CloudShadowState.elapsedTime };
  shader.uniforms.uCloudScale = { value: CloudShadowState.settings.cloudScale };
  shader.uniforms.uCloudSpeed = { value: CloudShadowState.settings.cloudSpeed };
  shader.uniforms.uCloudWindDir = { value: CloudShadowState.settings.windDirection };
  shader.uniforms.uCloudShadowStrength = { value: CloudShadowState.settings.shadowStrength };
  shader.uniforms.uCloudLow = { value: CloudShadowState.settings.cloudLow };
  shader.uniforms.uCloudHigh = { value: CloudShadowState.settings.cloudHigh };
  shader.uniforms.uCloudEnabled = {
    value: CloudShadowState.textureReady && CloudShadowState.settings.enabled ? 1 : 0,
  };
  shader.uniforms.uLayer2ScaleMul = { value: CloudShadowState.settings.layer2ScaleMul };
  shader.uniforms.uLayer2SpeedMul = { value: CloudShadowState.settings.layer2SpeedMul };
}

export function installCloudShadowGlsl(material: StandardMaterial): void {
  if (material.userData[GLSL_APPLIED]) {
    return;
  }
  material.userData[GLSL_APPLIED] = true;

  material.customProgramCacheKey = () => CACHE_KEY;

  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);

    syncGlslUniforms(shader);

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n${VERTEX_UNIFORMS}\nvarying vec3 vGrimWorldPos;\nvarying vec3 vGrimWorldNormal;\n`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>\nvGrimWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGrimWorldNormal = normalize(mat3(modelMatrix) * objectNormal);\n`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${FRAGMENT_UNIFORMS}\n${FRAGMENT_BODY}\nvarying vec3 vGrimWorldPos;\nvarying vec3 vGrimWorldNormal;\n`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <output_fragment>',
      `#include <output_fragment>\n{\n  float grimShadow = grimCloudShadowFactor(vGrimWorldPos, vGrimWorldNormal);\n  gl_FragColor.rgb *= grimShadow;\n}\n`,
    );
  };

  material.needsUpdate = true;
}
