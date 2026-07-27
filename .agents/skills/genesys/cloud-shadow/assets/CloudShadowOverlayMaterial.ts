/**
 * Flat world-space cloud shadow overlay (MeshBasicNodeMaterial + MultiplyBlending).
 * Same proven WebGPU/TSL pattern as FogCardMaterial — no material patching.
 */
import * as THREE from 'three';
import {
  float,
  positionWorld,
  smoothstep,
  texture,
  time,
  uniform,
  vec2,
  vec4,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

export type CloudShadowOverlaySettings = {
  cloudScale: number;
  cloudSpeed: number;
  shadowStrength: number;
  windX: number;
  windZ: number;
  layer2ScaleMul: number;
  layer2SpeedMul: number;
  layer1Weight: number;
  layer2Weight: number;
  cloudLow: number;
  cloudHigh: number;
};

export const DEFAULT_OVERLAY_SETTINGS: CloudShadowOverlaySettings = {
  cloudScale: 0.0007,
  cloudSpeed: 0.006,
  shadowStrength: 0.28,
  windX: 1,
  windZ: 0.35,
  layer2ScaleMul: 2.0,
  layer2SpeedMul: 0.35,
  layer1Weight: 0.7,
  layer2Weight: 0.3,
  cloudLow: 0.28,
  cloudHigh: 0.82,
};

export function configureCloudShadowTexture(tex: THREE.Texture): THREE.Texture {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class CloudShadowOverlayMaterial extends MeshBasicNodeMaterial {
  readonly uCloudScale = uniform(DEFAULT_OVERLAY_SETTINGS.cloudScale);
  readonly uCloudSpeed = uniform(DEFAULT_OVERLAY_SETTINGS.cloudSpeed);
  readonly uShadowStrength = uniform(DEFAULT_OVERLAY_SETTINGS.shadowStrength);
  readonly uWindDir = uniform(new THREE.Vector2(DEFAULT_OVERLAY_SETTINGS.windX, DEFAULT_OVERLAY_SETTINGS.windZ));
  readonly uLayer2ScaleMul = uniform(DEFAULT_OVERLAY_SETTINGS.layer2ScaleMul);
  readonly uLayer2SpeedMul = uniform(DEFAULT_OVERLAY_SETTINGS.layer2SpeedMul);
  readonly uLayer1Weight = uniform(DEFAULT_OVERLAY_SETTINGS.layer1Weight);
  readonly uLayer2Weight = uniform(DEFAULT_OVERLAY_SETTINGS.layer2Weight);
  readonly uCloudLow = uniform(DEFAULT_OVERLAY_SETTINGS.cloudLow);
  readonly uCloudHigh = uniform(DEFAULT_OVERLAY_SETTINGS.cloudHigh);

  constructor(cloudTexture: THREE.Texture, settings: Partial<CloudShadowOverlaySettings> = {}) {
    super();

    configureCloudShadowTexture(cloudTexture);

    this.name = 'CloudShadowOverlayMaterial';
    this.transparent = true;
    this.depthWrite = false;
    this.depthTest = true;
    this.fog = false;
    this.blending = THREE.MultiplyBlending;
    this.premultipliedAlpha = true;
    this.side = THREE.DoubleSide;

    this.applySettings(settings);

    const t = time.mul(this.uCloudSpeed);
    const wind = this.uWindDir;

    const uv1 = positionWorld.xz.mul(this.uCloudScale).add(wind.mul(t));
    const uv2 = positionWorld.xz
      .mul(this.uCloudScale.mul(this.uLayer2ScaleMul))
      .sub(vec2(wind.y, wind.x).mul(t.mul(this.uLayer2SpeedMul)));

    const c1 = texture(cloudTexture, uv1).r;
    const c2 = texture(cloudTexture, uv2).r;
    const mask = smoothstep(
      this.uCloudLow,
      this.uCloudHigh,
      c1.mul(this.uLayer1Weight).add(c2.mul(this.uLayer2Weight)),
    );

  // 1.0 = no darkening, lower = darker (multiply blend).
    const multiplier = float(1.0).sub(mask.mul(this.uShadowStrength));
    this.colorNode = vec4(multiplier, multiplier, multiplier, float(1.0));
  }

  public applySettings(partial: Partial<CloudShadowOverlaySettings>): void {
    const s = { ...DEFAULT_OVERLAY_SETTINGS, ...partial };
    this.uCloudScale.value = s.cloudScale;
    this.uCloudSpeed.value = s.cloudSpeed;
    this.uShadowStrength.value = s.shadowStrength;
    this.uWindDir.value.set(s.windX, s.windZ);
    this.uLayer2ScaleMul.value = s.layer2ScaleMul;
    this.uLayer2SpeedMul.value = s.layer2SpeedMul;
    this.uLayer1Weight.value = s.layer1Weight;
    this.uLayer2Weight.value = s.layer2Weight;
    this.uCloudLow.value = s.cloudLow;
    this.uCloudHigh.value = s.cloudHigh;
    this.needsUpdate = true;
  }
}
