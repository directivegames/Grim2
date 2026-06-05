/**
 * Fog-card TSL material.
 *
 * This replaces the original prototype shader with a reusable fog-card material:
 * base-color noise, opacity mask, dual-phase flowmap animation,
 * camera fade, view-angle fade, optional border mask, and optional wind noise.
 */

import * as THREE from 'three';
import {
  abs,
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  mix,
  normalWorld,
  positionWorld,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec2,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

export type FogCardColorInput = THREE.ColorRepresentation | [number, number, number];

export interface FogCardSettings {
  baseColorTint: FogCardColorInput;
  useAtmosphereColor: number;
  atmosphereColor: FogCardColorInput;
  baseColorContrast: number;
  baseColorIntensity: number;
  baseColorOutputIntensity: number;
  emissiveIntensity: number;
  fogDensity: number;
  cameraFadingDistance: number;
  viewAngleFade: number;
  flowMapIntensity: number;
  flowMapSpeed: number;
  flowMapTiling: number;
  flowMapDirection: number;
  useBorderMask: number;
  windEnabled: number;
  windSpeedX: number;
  windSpeedY: number;
  windNoiseTiling: number;
  windNoiseContrast: number;
  opacitySoftness: number;
  opacityBias: number;
}

export interface FogCardTextures {
  baseColorMap: THREE.Texture;
  opacityMap: THREE.Texture;
  flowMap?: THREE.Texture | null;
  borderMaskMap?: THREE.Texture | null;
  windNoiseMap?: THREE.Texture | null;
}

export const DEFAULT_FOG_CARD_SETTINGS: FogCardSettings = {
  baseColorTint: '#ffffff',
  useAtmosphereColor: 1,
  atmosphereColor: '#ffffff',
  baseColorContrast: -0.256,
  baseColorIntensity: 1,
  baseColorOutputIntensity: 1,
  emissiveIntensity: 0.276,
  fogDensity: 0.304,
  cameraFadingDistance: 1,
  viewAngleFade: 0,
  flowMapIntensity: 1,
  flowMapSpeed: 0.3,
  flowMapTiling: 1,
  flowMapDirection: 0,
  useBorderMask: 0,
  windEnabled: 0,
  windSpeedX: 200,
  windSpeedY: 200,
  windNoiseTiling: 0.02,
  windNoiseContrast: 0,
  opacitySoftness: 1,
  opacityBias: 0,
};

function toColor(input: FogCardColorInput): THREE.Color {
  if (Array.isArray(input)) {
    return new THREE.Color(input[0], input[1], input[2]);
  }
  return new THREE.Color(input);
}

export function configureFogCardTexture(textureToConfigure: THREE.Texture, colorSpace: THREE.ColorSpace): THREE.Texture {
  textureToConfigure.wrapS = THREE.RepeatWrapping;
  textureToConfigure.wrapT = THREE.RepeatWrapping;
  textureToConfigure.colorSpace = colorSpace;
  textureToConfigure.needsUpdate = true;
  return textureToConfigure;
}

export function createFogCardUniforms(settingsInput: Partial<FogCardSettings> = {}) {
  const settings = { ...DEFAULT_FOG_CARD_SETTINGS, ...settingsInput };
  return {
    uBaseColorTint: uniform(toColor(settings.baseColorTint)),
    uAtmosphereColor: uniform(toColor(settings.atmosphereColor)),
    uUseAtmosphereColor: uniform(settings.useAtmosphereColor),
    uBaseColorContrast: uniform(settings.baseColorContrast),
    uBaseColorIntensity: uniform(settings.baseColorIntensity),
    uBaseColorOutputIntensity: uniform(settings.baseColorOutputIntensity),
    uEmissiveIntensity: uniform(settings.emissiveIntensity),
    uFogDensity: uniform(settings.fogDensity),
    uCameraFadingDistance: uniform(settings.cameraFadingDistance),
    uViewAngleFade: uniform(settings.viewAngleFade),
    uFlowMapIntensity: uniform(settings.flowMapIntensity),
    uFlowMapSpeed: uniform(settings.flowMapSpeed),
    uFlowMapTiling: uniform(settings.flowMapTiling),
    uFlowMapDirection: uniform(settings.flowMapDirection),
    uUseBorderMask: uniform(settings.useBorderMask),
    uWindEnabled: uniform(settings.windEnabled),
    uWindSpeedX: uniform(settings.windSpeedX),
    uWindSpeedY: uniform(settings.windSpeedY),
    uWindNoiseTiling: uniform(settings.windNoiseTiling),
    uWindNoiseContrast: uniform(settings.windNoiseContrast),
    uOpacitySoftness: uniform(settings.opacitySoftness),
    uOpacityBias: uniform(settings.opacityBias),
  } as const;
}

export type FogCardUniforms = ReturnType<typeof createFogCardUniforms>;

export function updateFogCardUniforms(uniforms: FogCardUniforms, partial: Partial<FogCardSettings>): void {
  if (partial.baseColorTint !== undefined) uniforms.uBaseColorTint.value.copy(toColor(partial.baseColorTint));
  if (partial.atmosphereColor !== undefined) uniforms.uAtmosphereColor.value.copy(toColor(partial.atmosphereColor));
  if (partial.useAtmosphereColor !== undefined) uniforms.uUseAtmosphereColor.value = partial.useAtmosphereColor;
  if (partial.baseColorContrast !== undefined) uniforms.uBaseColorContrast.value = partial.baseColorContrast;
  if (partial.baseColorIntensity !== undefined) uniforms.uBaseColorIntensity.value = partial.baseColorIntensity;
  if (partial.baseColorOutputIntensity !== undefined) uniforms.uBaseColorOutputIntensity.value = partial.baseColorOutputIntensity;
  if (partial.emissiveIntensity !== undefined) uniforms.uEmissiveIntensity.value = partial.emissiveIntensity;
  if (partial.fogDensity !== undefined) uniforms.uFogDensity.value = partial.fogDensity;
  if (partial.cameraFadingDistance !== undefined) uniforms.uCameraFadingDistance.value = partial.cameraFadingDistance;
  if (partial.viewAngleFade !== undefined) uniforms.uViewAngleFade.value = partial.viewAngleFade;
  if (partial.flowMapIntensity !== undefined) uniforms.uFlowMapIntensity.value = partial.flowMapIntensity;
  if (partial.flowMapSpeed !== undefined) uniforms.uFlowMapSpeed.value = partial.flowMapSpeed;
  if (partial.flowMapTiling !== undefined) uniforms.uFlowMapTiling.value = partial.flowMapTiling;
  if (partial.flowMapDirection !== undefined) uniforms.uFlowMapDirection.value = partial.flowMapDirection;
  if (partial.useBorderMask !== undefined) uniforms.uUseBorderMask.value = partial.useBorderMask;
  if (partial.windEnabled !== undefined) uniforms.uWindEnabled.value = partial.windEnabled;
  if (partial.windSpeedX !== undefined) uniforms.uWindSpeedX.value = partial.windSpeedX;
  if (partial.windSpeedY !== undefined) uniforms.uWindSpeedY.value = partial.windSpeedY;
  if (partial.windNoiseTiling !== undefined) uniforms.uWindNoiseTiling.value = partial.windNoiseTiling;
  if (partial.windNoiseContrast !== undefined) uniforms.uWindNoiseContrast.value = partial.windNoiseContrast;
  if (partial.opacitySoftness !== undefined) uniforms.uOpacitySoftness.value = partial.opacitySoftness;
  if (partial.opacityBias !== undefined) uniforms.uOpacityBias.value = partial.opacityBias;
}

export class FogCardMaterial extends MeshBasicNodeMaterial {
  public readonly fogCardUniforms: FogCardUniforms;

  constructor(textures: FogCardTextures, settings?: Partial<FogCardSettings>) {
    super();

    this.name = 'FogCardMaterial';
    this.transparent = true;
    this.depthWrite = false;
    this.depthTest = true;
    this.side = THREE.DoubleSide;
    this.fog = false;
    this.blending = THREE.NormalBlending;

    this.fogCardUniforms = createFogCardUniforms(settings);
    this.userData['fogCardUniforms'] = this.fogCardUniforms;

    const uniforms = this.fogCardUniforms;
    const baseUv = uv();

    const baseColorSample = texture(textures.baseColorMap, baseUv).rgb;
    const baseColorContrasted = clamp(
      baseColorSample.sub(0.5).mul(uniforms.uBaseColorContrast.add(1.0)).add(0.5),
      0.0,
      1.0
    );
    const tint = mix(
      uniforms.uBaseColorTint.rgb,
      uniforms.uAtmosphereColor.rgb,
      clamp(uniforms.uUseAtmosphereColor, 0.0, 1.0)
    );
    const finalColor = baseColorContrasted
      .mul(tint)
      .mul(uniforms.uBaseColorIntensity)
      .mul(uniforms.uBaseColorOutputIntensity)
      .mul(uniforms.uEmissiveIntensity);

    const flowVec = textures.flowMap ? (() => {
      const flowUv = baseUv.mul(uniforms.uFlowMapTiling);
      const flowRG = texture(textures.flowMap, flowUv).rg;
      const sampledFlow = flowRG.mul(2.0).sub(vec2(1.0, 1.0));
      const mirroredFlow = sampledFlow.mul(vec2(-1.0, 1.0));
      return mix(sampledFlow, mirroredFlow, clamp(uniforms.uFlowMapDirection, 0.0, 1.0))
        .mul(uniforms.uFlowMapIntensity);
    })() : vec2(0.0, 0.0);

    let opacity;
    if (textures.flowMap) {
      // Flow map active — dual-phase sample to animate opacity smoothly.
      const animatedTime = time.mul(uniforms.uFlowMapSpeed);
      const phaseA = fract(animatedTime);
      const phaseB = fract(animatedTime.add(0.5));
      const flowBlend = abs(phaseA.mul(2.0).sub(1.0));
      const opacityA = texture(textures.opacityMap, baseUv.add(flowVec.mul(phaseA))).r;
      const opacityB = texture(textures.opacityMap, baseUv.add(flowVec.mul(phaseB))).r;
      opacity = mix(opacityA, opacityB, flowBlend);
    } else {
      // No flow map — single sample; saves one texture read per fragment.
      opacity = texture(textures.opacityMap, baseUv).r;
    }

    const cameraOffset = cameraPosition.sub(positionWorld);
    const cameraFade = smoothstep(float(0.0), uniforms.uCameraFadingDistance, cameraOffset.length());
    opacity = opacity.mul(cameraFade);

    const viewDir = cameraOffset.normalize();
    const ndotv = abs(dot(normalWorld, viewDir));
    const angleFade = mix(float(1.0), ndotv, clamp(uniforms.uViewAngleFade, 0.0, 1.0));
    opacity = opacity.mul(angleFade);

    if (textures.borderMaskMap) {
      const border = texture(textures.borderMaskMap, baseUv).r;
      const borderFade = mix(float(1.0), border, clamp(uniforms.uUseBorderMask, 0.0, 1.0));
      opacity = opacity.mul(borderFade);
    }

    if (textures.windNoiseMap) {
      const windScale = float(0.0005);
      const windUv = positionWorld.xz
        .mul(uniforms.uWindNoiseTiling)
        .add(vec2(uniforms.uWindSpeedX, uniforms.uWindSpeedY).mul(time).mul(windScale));
      const windRaw = texture(textures.windNoiseMap, windUv).r;
      const windNoise = clamp(
        windRaw.sub(0.5).mul(uniforms.uWindNoiseContrast.add(1.0)).add(0.5),
        0.0,
        1.0
      );
      const windFade = mix(float(1.0), windNoise, clamp(uniforms.uWindEnabled, 0.0, 1.0));
      opacity = opacity.mul(windFade);
    }

    opacity = clamp(
      opacity
        .add(uniforms.uOpacityBias)
        .mul(uniforms.uOpacitySoftness)
        .mul(uniforms.uFogDensity),
      0.0,
      1.0
    );

    this.colorNode = finalColor;
    this.opacityNode = opacity;
  }

  public updateSettings(partial: Partial<FogCardSettings>): void {
    updateFogCardUniforms(this.fogCardUniforms, partial);
    this.needsUpdate = true;
  }
}

export type FogSystemUniforms = FogCardUniforms;
export const createFogSystemUniforms = createFogCardUniforms;
