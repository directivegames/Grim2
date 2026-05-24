/**
 * Shared cloud-shadow uniforms and runtime settings.
 */
import * as THREE from 'three';
import { texture, uniform } from 'three/tsl';

export const DEFAULT_CLOUD_SHADOW_MAP =
  '@project/assets/textures/cloudtexture.png';

export type CloudShadowSettings = {
  /** Master toggle (still requires texture load for visible effect). */
  enabled: boolean;
  /** World-space UV scale (spec default ~0.0015). */
  cloudScale: number;
  /** Scroll speed multiplier (spec default ~0.015). */
  cloudSpeed: number;
  /** Normalized wind direction in world XZ. */
  windDirection: THREE.Vector2;
  /** Max darkening amount 0–1 (spec default ~0.25). */
  shadowStrength: number;
  /** smoothstep low threshold for cloud mask. */
  cloudLow: number;
  /** smoothstep high threshold for cloud mask. */
  cloudHigh: number;
  /** Second layer scale relative to first (spec ~2.3). */
  layer2ScaleMul: number;
  /** Second layer speed relative to first (spec ~0.45). */
  layer2SpeedMul: number;
};

export const DEFAULT_CLOUD_SHADOW_SETTINGS: CloudShadowSettings = {
  enabled: true,
  cloudScale: 0.0007,
  cloudSpeed: 0.006,
  windDirection: new THREE.Vector2(1, 0.35).normalize(),
  shadowStrength: 0.28,
  cloudLow: 0.28,
  cloudHigh: 0.82,
  layer2ScaleMul: 2.0,
  layer2SpeedMul: 0.35,
};

class CloudShadowStateImpl {
  public settings: CloudShadowSettings = {
    ...DEFAULT_CLOUD_SHADOW_SETTINGS,
    windDirection: DEFAULT_CLOUD_SHADOW_SETTINGS.windDirection.clone(),
  };

  /** Elapsed time driven by CloudShadowComponent each frame. */
  public elapsedTime = 0;

  /** GPU texture used by GLSL onBeforeCompile path. */
  public gpuTexture: THREE.Texture | null = null;

  /** TextureNode — .value is swapped when the texture loads. */
  public readonly uCloudMap = texture(new THREE.Texture());
  public readonly uTime = uniform(0);
  public readonly uCloudScale = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.cloudScale);
  public readonly uCloudSpeed = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.cloudSpeed);
  public readonly uWindDir = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.windDirection.clone());
  public readonly uShadowStrength = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.shadowStrength);
  public readonly uCloudLow = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.cloudLow);
  public readonly uCloudHigh = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.cloudHigh);
  public readonly uLayer2ScaleMul = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.layer2ScaleMul);
  public readonly uLayer2SpeedMul = uniform(DEFAULT_CLOUD_SHADOW_SETTINGS.layer2SpeedMul);
  /** 0 until texture loads, then 1 when settings.enabled. */
  public readonly uEnabled = uniform(0);

  public textureReady = false;

  public get systemActive(): boolean {
    return this.settings.enabled;
  }

  public syncUniforms(): void {
    this.uTime.value = this.elapsedTime;
    this.uCloudScale.value = this.settings.cloudScale;
    this.uCloudSpeed.value = this.settings.cloudSpeed;
    this.uWindDir.value.copy(this.settings.windDirection);
    this.uShadowStrength.value = this.settings.shadowStrength;
    this.uCloudLow.value = this.settings.cloudLow;
    this.uCloudHigh.value = this.settings.cloudHigh;
    this.uLayer2ScaleMul.value = this.settings.layer2ScaleMul;
    this.uLayer2SpeedMul.value = this.settings.layer2SpeedMul;
    this.uEnabled.value = this.textureReady && this.settings.enabled ? 1 : 0;
    if (this.gpuTexture) {
      this.uCloudMap.value = this.gpuTexture;
    }
  }

  public applySettings(partial: Partial<CloudShadowSettings> = {}): void {
    if (partial.windDirection) {
      this.settings.windDirection.copy(partial.windDirection).normalize();
    }
    const { windDirection: _wd, ...rest } = partial;
    this.settings = { ...this.settings, ...rest };
    this.syncUniforms();
  }

  public setCloudTexture(loaded: THREE.Texture): void {
    loaded.wrapS = THREE.RepeatWrapping;
    loaded.wrapT = THREE.RepeatWrapping;
    loaded.colorSpace = THREE.NoColorSpace;
    loaded.minFilter = THREE.LinearFilter;
    loaded.magFilter = THREE.LinearFilter;
    loaded.needsUpdate = true;
    this.gpuTexture = loaded;
    this.uCloudMap.value = loaded;
    this.textureReady = true;
    this.syncUniforms();
  }
}

export const CloudShadowState = new CloudShadowStateImpl();
