/**
 * Spawns a large horizontal cloud-shadow overlay plane (WebGPU TSL, multiply blend).
 */
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import {
  CloudShadowOverlayMaterial,
  type CloudShadowOverlaySettings,
} from './CloudShadowOverlayMaterial.js';
import { DEFAULT_CLOUD_SHADOW_MAP, DEFAULT_CLOUD_SHADOW_SETTINGS } from './CloudShadowState.js';
import { shouldDisableWebGpuTslEffects } from '../utils/browser-compat.js';

import type { EditorPropertyChangedResult } from '@gnsx/genesys.js';

const OVERLAY_MESH_NAME = 'CloudShadowOverlayPlane';

export type CloudShadowComponentOptions = ENGINE.SceneComponentOptions & {
  cloudMapUrl?: ENGINE.TexturePath;
  enabled?: boolean;
  cloudScale?: number;
  cloudSpeed?: number;
  windDirectionX?: number;
  windDirectionZ?: number;
  shadowStrength?: number;
  cloudLow?: number;
  cloudHigh?: number;
  layer2ScaleMul?: number;
  layer2SpeedMul?: number;
  layer1Weight?: number;
  layer2Weight?: number;
  planeSize?: number;
  planeHeight?: number;
  planeOffsetX?: number;
  planeOffsetZ?: number;
  renderOrder?: number;
  debugLogging?: boolean;
};

@ENGINE.GameClass()
export class CloudShadowComponent extends ENGINE.SceneComponent {
  @ENGINE.property({ type: 'boolean', category: 'Cloud Shadows', description: 'Enable cloud shadow overlay' })
  public override enabled: boolean = DEFAULT_CLOUD_SHADOW_SETTINGS.enabled;

  @ENGINE.property({ category: 'Cloud Shadows', description: 'Grayscale cloud noise texture' })
  public cloudMapUrl: ENGINE.TexturePath = DEFAULT_CLOUD_SHADOW_MAP;

  @ENGINE.property({
    type: 'number',
    min: 0.0001,
    max: 0.05,
    step: 0.0001,
    category: 'Cloud Shadows',
    description: 'World-space UV scale (lower = larger, sparser clouds)',
  })
  public cloudScale: number = DEFAULT_CLOUD_SHADOW_SETTINGS.cloudScale;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 0.2,
    step: 0.001,
    category: 'Cloud Shadows',
    description: 'Scroll speed multiplier',
  })
  public cloudSpeed: number = DEFAULT_CLOUD_SHADOW_SETTINGS.cloudSpeed;

  @ENGINE.property({
    type: 'number',
    min: -1,
    max: 1,
    step: 0.01,
    category: 'Cloud Shadows',
    description: 'Wind direction X',
  })
  public windDirectionX: number = DEFAULT_CLOUD_SHADOW_SETTINGS.windDirection.x;

  @ENGINE.property({
    type: 'number',
    min: -1,
    max: 1,
    step: 0.01,
    category: 'Cloud Shadows',
    description: 'Wind direction Z',
  })
  public windDirectionZ: number = DEFAULT_CLOUD_SHADOW_SETTINGS.windDirection.y;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Cloud Shadows',
    description: 'Maximum shadow strength',
  })
  public shadowStrength: number = DEFAULT_CLOUD_SHADOW_SETTINGS.shadowStrength;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Cloud Shadows',
    description: 'Cloud mask smoothstep low (wider = softer, less shadow)',
  })
  public cloudLow: number = DEFAULT_CLOUD_SHADOW_SETTINGS.cloudLow;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Cloud Shadows',
    description: 'Cloud mask smoothstep high',
  })
  public cloudHigh: number = DEFAULT_CLOUD_SHADOW_SETTINGS.cloudHigh;

  @ENGINE.property({
    type: 'number',
    min: 1,
    max: 5,
    step: 0.01,
    category: 'Layers',
    description: 'Second layer scale multiplier',
  })
  public layer2ScaleMul: number = DEFAULT_CLOUD_SHADOW_SETTINGS.layer2ScaleMul;

  @ENGINE.property({
    type: 'number',
    min: 0.05,
    max: 2,
    step: 0.01,
    category: 'Layers',
    description: 'Second layer speed multiplier',
  })
  public layer2SpeedMul: number = DEFAULT_CLOUD_SHADOW_SETTINGS.layer2SpeedMul;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Layers',
    description: 'Primary cloud layer blend weight',
  })
  public layer1Weight: number = 0.7;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    category: 'Layers',
    description: 'Secondary cloud layer blend weight',
  })
  public layer2Weight: number = 0.3;

  @ENGINE.property({
    type: 'number',
    min: 50,
    max: 500,
    step: 1,
    category: 'Overlay',
    description: 'Overlay plane half-size (world units)',
  })
  public planeSize: number = 150;

  @ENGINE.property({
    type: 'number',
    min: 0.01,
    max: 2,
    step: 0.01,
    category: 'Overlay',
    description: 'Overlay plane height (Y)',
  })
  public planeHeight: number = 0.08;

  @ENGINE.property({
    type: 'number',
    min: -500,
    max: 500,
    step: 1,
    category: 'Overlay',
    description: 'Overlay plane world X offset',
  })
  public planeOffsetX: number = 0;

  @ENGINE.property({
    type: 'number',
    min: -500,
    max: 500,
    step: 1,
    category: 'Overlay',
    description: 'Overlay plane world Z offset',
  })
  public planeOffsetZ: number = 0;

  @ENGINE.property({
    type: 'number',
    min: -100,
    max: 100,
    step: 1,
    category: 'Overlay',
    description: 'Transparent render order for the overlay plane',
  })
  public override renderOrder: number = 2;

  @ENGINE.property({ type: 'boolean', category: 'Debug', description: 'Log overlay spawn to console' })
  public debugLogging: boolean = false;

  private _overlayMesh: THREE.Mesh | null = null;
  private _overlayMaterial: CloudShadowOverlayMaterial | null = null;
  private _loadStarted = false;
  private _loadVersion = 0;

  public override initialize(options?: CloudShadowComponentOptions): void {
    super.initialize(options);
    if (options?.cloudMapUrl !== undefined) this.cloudMapUrl = options.cloudMapUrl;
    if (options?.enabled !== undefined) this.enabled = options.enabled;
    if (options?.cloudScale !== undefined) this.cloudScale = options.cloudScale;
    if (options?.cloudSpeed !== undefined) this.cloudSpeed = options.cloudSpeed;
    if (options?.windDirectionX !== undefined) this.windDirectionX = options.windDirectionX;
    if (options?.windDirectionZ !== undefined) this.windDirectionZ = options.windDirectionZ;
    if (options?.shadowStrength !== undefined) this.shadowStrength = options.shadowStrength;
    if (options?.cloudLow !== undefined) this.cloudLow = options.cloudLow;
    if (options?.cloudHigh !== undefined) this.cloudHigh = options.cloudHigh;
    if (options?.layer2ScaleMul !== undefined) this.layer2ScaleMul = options.layer2ScaleMul;
    if (options?.layer2SpeedMul !== undefined) this.layer2SpeedMul = options.layer2SpeedMul;
    if (options?.layer1Weight !== undefined) this.layer1Weight = options.layer1Weight;
    if (options?.layer2Weight !== undefined) this.layer2Weight = options.layer2Weight;
    if (options?.planeSize !== undefined) this.planeSize = options.planeSize;
    if (options?.planeHeight !== undefined) this.planeHeight = options.planeHeight;
    if (options?.planeOffsetX !== undefined) this.planeOffsetX = options.planeOffsetX;
    if (options?.planeOffsetZ !== undefined) this.planeOffsetZ = options.planeOffsetZ;
    if (options?.renderOrder !== undefined) this.renderOrder = options.renderOrder;
    if (options?.debugLogging !== undefined) this.debugLogging = options.debugLogging;
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    super.beginPlay();
    void this.reload();
    return true;
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    void this.reload();
  }

  public override onEditorPropertyChanged(
    path: string,
    _value: unknown,
    result: EditorPropertyChangedResult,
  ): void {
    super.onEditorPropertyChanged(path, _value, result);

    if (path === 'cloudMapUrl') {
      void this.reload();
      return;
    }

    this._syncOverlay();
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._clearOverlay();
    super.endPlay();
    return true;
  }

  /** Rebuild overlay mesh/material (e.g. after texture change). */
  public async reload(): Promise<void> {
    const loadVersion = ++this._loadVersion;
    this._clearOverlay();

    if (shouldDisableWebGpuTslEffects()) {
      return;
    }

    this._loadStarted = true;

    try {
      const tex = await ENGINE.resourceManager.loadTexture(
        ENGINE.AssetPath.fromString(this.cloudMapUrl),
      );
      if (loadVersion !== this._loadVersion) {
        return;
      }
      if (!tex) {
        console.warn('[CloudShadowComponent] Cloud texture load returned null');
        this._loadStarted = false;
        return;
      }

      this._overlayMaterial = new CloudShadowOverlayMaterial(tex, this._overlaySettings());

      const geom = new THREE.PlaneGeometry(1, 1, 1, 1);
      const mesh = new THREE.Mesh(geom, this._overlayMaterial);
      mesh.name = OVERLAY_MESH_NAME;
      mesh.rotation.x = -Math.PI / 2;
      mesh.frustumCulled = false;

      this.add(mesh);
      this._overlayMesh = mesh;
      this._syncOverlay();

      if (this.debugLogging) {
        console.log(
          `[CloudShadowComponent] Cloud shadow overlay spawned — size=${this.planeSize * 2}, height=${this.planeHeight}`,
        );
      }
    } catch (err) {
      console.warn('[CloudShadowComponent] Failed to spawn cloud shadow overlay:', err);
      this._loadStarted = false;
    }
  }

  private _overlaySettings(): CloudShadowOverlaySettings {
    return {
      cloudScale: this.cloudScale,
      cloudSpeed: this.cloudSpeed,
      shadowStrength: this.shadowStrength,
      windX: this.windDirectionX,
      windZ: this.windDirectionZ,
      layer2ScaleMul: this.layer2ScaleMul,
      layer2SpeedMul: this.layer2SpeedMul,
      layer1Weight: this.layer1Weight,
      layer2Weight: this.layer2Weight,
      cloudLow: this.cloudLow,
      cloudHigh: this.cloudHigh,
    };
  }

  private _syncOverlay(): void {
    if (this._overlayMesh) {
      this._overlayMesh.visible = this.enabled;
      this._overlayMesh.position.set(this.planeOffsetX, this.planeHeight, this.planeOffsetZ);
      const size = this.planeSize * 2;
      this._overlayMesh.scale.set(size, size, 1);
      this._overlayMesh.renderOrder = this.renderOrder;
    }
    this._overlayMaterial?.applySettings(this._overlaySettings());
  }

  private _clearOverlay(): void {
    if (this._overlayMesh) {
      this._overlayMesh.geometry.dispose();
      this._overlayMaterial?.dispose();
      this.remove(this._overlayMesh);
      this._overlayMesh = null;
      this._overlayMaterial = null;
    }
    this._loadStarted = false;
  }
}
