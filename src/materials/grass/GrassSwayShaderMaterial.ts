import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

export type GrassSwayShaderMaterialParams = {
  mapUrl: ENGINE.TexturePath;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  alphaTest?: number;
  // Wind
  windSpeed?: number;
  windRigidness?: number;
  windAmplitude?: number;
  yOffset?: number;
  // Interaction (single interactor for now)
  interactorWorldPos?: THREE.Vector3;
  interactorRadius?: number;
  interactorStrength?: number;
};

const vertexShader = `
  varying vec2 vUv;

  uniform float uTime;
  uniform float uWindSpeed;
  uniform float uWindRigidness;
  uniform float uWindAmplitude;
  uniform float uYOffset;

  uniform vec3  uInteractorPos;
  uniform float uInteractorRadius;
  uniform float uInteractorStrength;

  void main() {
    vUv = uv;

    vec3 pos = position;

    // Wind sway: world-space phase, but local displacement.
    vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    float heightMask = max(0.0, pos.y - uYOffset);

    float wx = sin(worldPos.x / max(0.001, uWindRigidness) + uTime * uWindSpeed);
    float wz = sin(worldPos.z / max(0.001, uWindRigidness) + uTime * uWindSpeed);
    pos.x += wx * heightMask * uWindAmplitude;
    pos.z += wz * heightMask * uWindAmplitude;

    // Simple interaction: push away from interactor in XZ, falloff by radius.
    vec3 toInteractor = worldPos - uInteractorPos;
    float dist = length(toInteractor.xz);
    float t = 1.0 - clamp(dist / max(0.001, uInteractorRadius), 0.0, 1.0);
    float push = t * t * uInteractorStrength * step(uYOffset, pos.y);
    vec2 dir = dist > 0.0001 ? normalize(toInteractor.xz) : vec2(1.0, 0.0);
    pos.xz += dir * push;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uAlphaTest;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < uAlphaTest) discard;
    vec4 c = vec4(tex.rgb * uColor, tex.a * uOpacity);
    gl_FragColor = c;
  }
`;

export class GrassSwayShaderMaterial extends THREE.ShaderMaterial {
  public readonly mapUrl: ENGINE.TexturePath;

  constructor(params: GrassSwayShaderMaterialParams) {
    const map = new THREE.Texture(); // placeholder; user code loads real texture at runtime
    const uniforms: Record<string, THREE.IUniform> = {
      uMap: { value: map },
      uColor: { value: new THREE.Color(params.color ?? '#ffffff') },
      uOpacity: { value: params.opacity ?? 1.0 },
      uAlphaTest: { value: params.alphaTest ?? 0.3 },
      uTime: { value: 0 },
      uWindSpeed: { value: params.windSpeed ?? 1.8 },
      uWindRigidness: { value: params.windRigidness ?? 25.0 },
      uWindAmplitude: { value: params.windAmplitude ?? 0.03 },
      uYOffset: { value: params.yOffset ?? 0.0 },
      uInteractorPos: { value: (params.interactorWorldPos ?? new THREE.Vector3(0, -9999, 0)).clone() },
      uInteractorRadius: { value: params.interactorRadius ?? 1.2 },
      uInteractorStrength: { value: params.interactorStrength ?? 0.12 },
    };

    super({
      name: 'GrassSwayShaderMaterial',
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });

    // Important for WebGPU/TSL: node materials (and renderer conversion) expect `material.map`
    // to be a valid THREE.Texture, not just a custom uniform.
    (this as unknown as { map?: THREE.Texture }).map = map;

    this.mapUrl = params.mapUrl;
    this.opacity = params.opacity ?? 1.0;
    this.alphaTest = params.alphaTest ?? 0.3;
    this.side = THREE.DoubleSide;
  }
}

