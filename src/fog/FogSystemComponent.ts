/**
 * Fog-card component.
 *
 * Loads a single fog-card mesh from the supplied GLB asset and applies the
 * fog-card TSL material.
 */

import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import {
  configureFogCardTexture,
  DEFAULT_FOG_CARD_SETTINGS,
  FogCardMaterial,
  type FogCardSettings,
  type FogCardTextures,
} from './FogCardMaterial.js';
import { shouldDisableWebGpuTslEffects } from '../utils/browser-compat.js';

import type { ComponentDescriptionOptions } from '@gnsx/genesys.js';
import type { EditorPropertyChangedResult } from '@gnsx/genesys.js';

const DEFAULT_CARD_MODEL_URL = '@project/assets/models/SM_FogCard_01.glb';
const DEFAULT_BASE_COLOR_MAP_URL = '@project/assets/textures/Fog/T_smoothCloudsNoise_02_D.webp';
const DEFAULT_OPACITY_MAP_URL = '@project/assets/textures/Fog/T_mountainFog_06_mask.webp';
const DEFAULT_NORMAL_MAP_URL = '@project/assets/textures/Fog/T_mountainFog_06_N.webp';
const DEFAULT_FLOW_MAP_URL = '@project/assets/textures/System/Flowmaps/T_Flowmap_01_Directional.webp';
const DEFAULT_BORDER_MASK_MAP_URL = '@project/assets/textures/System/T_borderMask.webp';
const DEFAULT_WIND_NOISE_MAP_URL = '@project/assets/textures/Fog/T_smoothCloudsNoise_01_D.webp';
const FOG_DEBUG_GLOBAL = '__GRIM_DEBUG_FOG';

const _geometryBox = new THREE.Box3();
const _geometryCenter = new THREE.Vector3();
const _cameraWorldPosition = new THREE.Vector3();
const _cameraLocalPosition = new THREE.Vector3();

function colorInputToStyle(input: FogCardSettings['baseColorTint']): string {
  if (Array.isArray(input)) {
    return new THREE.Color(input[0], input[1], input[2]).getStyle();
  }
  return new THREE.Color(input).getStyle();
}

function createFallbackTexture(value: number): THREE.DataTexture {
  const data = new Uint8Array([value, value, value, 255]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.needsUpdate = true;
  return texture;
}

export interface FogSystemComponentOptions extends ENGINE.SceneComponentOptions {
  cardModelUrl?: string;
  baseColorMapUrl?: string;
  opacityMapUrl?: string;
  normalMapUrl?: string;
  flowMapUrl?: string;
  borderMaskMapUrl?: string;
  windNoiseMapUrl?: string;
  settings?: Partial<FogCardSettings>;
}

@ENGINE.GameClass()
export class FogSystemComponent extends ENGINE.SceneComponent {
  @ENGINE.property({ required: true, description: 'GLB mesh used as the fog card surface' })
  public cardModelUrl: ENGINE.ModelPath = DEFAULT_CARD_MODEL_URL;

  @ENGINE.property({ required: true, description: 'Base color / cloud noise texture' })
  public baseColorMapUrl: ENGINE.TexturePath = DEFAULT_BASE_COLOR_MAP_URL;

  @ENGINE.property({ required: true, description: 'Opacity mask texture; red channel drives fog density' })
  public opacityMapUrl: ENGINE.TexturePath = DEFAULT_OPACITY_MAP_URL;

  @ENGINE.property({ description: 'Normal texture reserved for the second-pass material lighting path' })
  public normalMapUrl: ENGINE.TexturePath | null = DEFAULT_NORMAL_MAP_URL;

  @ENGINE.property({ description: 'Flowmap texture; RG encodes UV velocity, 0.5 means no flow' })
  public flowMapUrl: ENGINE.TexturePath | null = DEFAULT_FLOW_MAP_URL;

  @ENGINE.property({ description: 'Optional border mask texture multiplied into opacity' })
  public borderMaskMapUrl: ENGINE.TexturePath | null = DEFAULT_BORDER_MASK_MAP_URL;

  @ENGINE.property({ description: 'Optional world-space wind noise texture' })
  public windNoiseMapUrl: ENGINE.TexturePath | null = DEFAULT_WIND_NOISE_MAP_URL;

  @ENGINE.property({ type: 'color', description: 'Fog tint before atmosphere blending' })
  public baseColorTint: string = '#ffffff';

  @ENGINE.property({ type: 'color', description: 'Atmosphere/environment tint used when Use Atmosphere Color is enabled' })
  public atmosphereColor: string = '#ffffff';

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.01, description: 'Blend from base tint to atmosphere color' })
  public useAtmosphereColor: number = DEFAULT_FOG_CARD_SETTINGS.useAtmosphereColor;

  @ENGINE.property({ type: 'number', min: -1, max: 4, step: 0.01, description: 'CheapContrast control for base color map' })
  public baseColorContrast: number = DEFAULT_FOG_CARD_SETTINGS.baseColorContrast;

  @ENGINE.property({ type: 'number', min: 0, max: 8, step: 0.01, description: 'Base color texture intensity' })
  public baseColorIntensity: number = DEFAULT_FOG_CARD_SETTINGS.baseColorIntensity;

  @ENGINE.property({ type: 'number', min: 0, max: 8, step: 0.01, description: 'Final base color output multiplier' })
  public baseColorOutputIntensity: number = DEFAULT_FOG_CARD_SETTINGS.baseColorOutputIntensity;

  @ENGINE.property({ type: 'number', min: 0, max: 8, step: 0.01, description: 'Emissive-style brightness multiplier' })
  public emissiveIntensity: number = DEFAULT_FOG_CARD_SETTINGS.emissiveIntensity;

  @ENGINE.property({ type: 'number', min: 0, max: 5, step: 0.01, description: 'Final opacity density multiplier' })
  public fogDensity: number = DEFAULT_FOG_CARD_SETTINGS.fogDensity;

  @ENGINE.property({ type: 'number', min: 0.001, max: 100, step: 0.1, description: 'Distance in meters over which fog fades in near the camera' })
  public cameraFadingDistance: number = DEFAULT_FOG_CARD_SETTINGS.cameraFadingDistance;

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.01, description: 'Fade opacity at glancing view angles' })
  public viewAngleFade: number = DEFAULT_FOG_CARD_SETTINGS.viewAngleFade;

  @ENGINE.property({ type: 'number', min: 0, max: 5, step: 0.01, description: 'Flowmap UV displacement strength' })
  public flowMapIntensity: number = DEFAULT_FOG_CARD_SETTINGS.flowMapIntensity;

  @ENGINE.property({ type: 'number', min: 0, max: 5, step: 0.01, description: 'Flowmap animation speed' })
  public flowMapSpeed: number = DEFAULT_FOG_CARD_SETTINGS.flowMapSpeed;

  @ENGINE.property({ type: 'number', min: 0.01, max: 20, step: 0.01, description: 'Flowmap UV tiling' })
  public flowMapTiling: number = DEFAULT_FOG_CARD_SETTINGS.flowMapTiling;

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.01, description: 'Flow direction mirror blend' })
  public flowMapDirection: number = DEFAULT_FOG_CARD_SETTINGS.flowMapDirection;

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.01, description: 'Blend in the border mask texture' })
  public useBorderMask: number = DEFAULT_FOG_CARD_SETTINGS.useBorderMask;

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.01, description: 'Enable world-space wind density modulation' })
  public windEnabled: number = DEFAULT_FOG_CARD_SETTINGS.windEnabled;

  @ENGINE.property({ type: 'number', min: -1000, max: 1000, step: 1, description: 'Wind noise X speed' })
  public windSpeedX: number = DEFAULT_FOG_CARD_SETTINGS.windSpeedX;

  @ENGINE.property({ type: 'number', min: -1000, max: 1000, step: 1, description: 'Wind noise Y speed' })
  public windSpeedY: number = DEFAULT_FOG_CARD_SETTINGS.windSpeedY;

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.001, description: 'World-space wind noise tiling' })
  public windNoiseTiling: number = DEFAULT_FOG_CARD_SETTINGS.windNoiseTiling;

  @ENGINE.property({ type: 'number', min: -10, max: 10, step: 0.01, description: 'CheapContrast control for wind noise' })
  public windNoiseContrast: number = DEFAULT_FOG_CARD_SETTINGS.windNoiseContrast;

  @ENGINE.property({ type: 'number', min: 0, max: 8, step: 0.01, description: 'Opacity shaping multiplier after all masks' })
  public opacitySoftness: number = DEFAULT_FOG_CARD_SETTINGS.opacitySoftness;

  @ENGINE.property({ type: 'number', min: -1, max: 1, step: 0.01, description: 'Opacity shaping bias after all masks' })
  public opacityBias: number = DEFAULT_FOG_CARD_SETTINGS.opacityBias;

  @ENGINE.property({ type: 'number', min: 0.01, max: 100, step: 0.01, description: 'Fallback plane width if model loading fails' })
  public fallbackWidth: number = 8;

  @ENGINE.property({ type: 'number', min: 0.01, max: 100, step: 0.01, description: 'Fallback plane height if model loading fails' })
  public fallbackHeight: number = 4;

  @ENGINE.property({ type: 'boolean', description: 'Rotate the card to face the active camera each frame' })
  public billboardToCamera: boolean = false;

  @ENGINE.property({ type: 'number', min: -100, max: 100, step: 1, description: 'Transparent render order for the fog card' })
  public override renderOrder: number = 10;

  @ENGINE.property({ type: 'boolean', description: 'Print fog-card load/material diagnostics to the browser console' })
  public debugLogging: boolean = false;

  private _mesh: THREE.Mesh<THREE.BufferGeometry, FogCardMaterial> | null = null;
  private _material: FogCardMaterial | null = null;
  private _textures: FogCardTextures | null = null;
  private _loadVersion: number = 0;
  private _billboardRafId: number | null = null;

  public override initialize(options?: FogSystemComponentOptions): void {
    super.initialize(options);
    if (options?.cardModelUrl !== undefined) this.cardModelUrl = options.cardModelUrl;
    if (options?.baseColorMapUrl !== undefined) this.baseColorMapUrl = options.baseColorMapUrl;
    if (options?.opacityMapUrl !== undefined) this.opacityMapUrl = options.opacityMapUrl;
    if (options?.normalMapUrl !== undefined) this.normalMapUrl = options.normalMapUrl;
    if (options?.flowMapUrl !== undefined) this.flowMapUrl = options.flowMapUrl;
    if (options?.borderMaskMapUrl !== undefined) this.borderMaskMapUrl = options.borderMaskMapUrl;
    if (options?.windNoiseMapUrl !== undefined) this.windNoiseMapUrl = options.windNoiseMapUrl;
    if (options?.settings) this.updateSettings(options.settings);
    this._log('initialize', this._debugSnapshot());
    this._syncBillboardLoop();
  }

  public override postLoad(): void {
    super.postLoad();
    this._log('postLoad -> reload');
    void this.reload();
    this._syncBillboardLoop();
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    if (!this._mesh) {
      this._log('beginPlay -> reload because no mesh exists yet');
      void this.reload();
    } else {
      this._log('beginPlay -> mesh already exists');
    }
    this._syncBillboardLoop();
    return true;
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    this._log('onEditorAddToWorld -> reload');
    void this.reload();
    this._syncBillboardLoop();
  }

  public override onEditorPropertyChanged(path: string, value: unknown, result: EditorPropertyChangedResult): void {
    super.onEditorPropertyChanged(path, value, result);
    this._log('editor property changed', { path, value });

    if (this._isAssetProperty(path) || path === 'fallbackWidth' || path === 'fallbackHeight') {
      this._log('asset/fallback property changed -> reload');
      void this.reload();
      return;
    }

    this.updateFogValues();
    this._syncBillboardLoop();
    if (this._mesh) {
      this._mesh.renderOrder = this.renderOrder;
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateBillboardToCamera();
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._stopBillboardLoop();
    this._clearMesh();
    return true;
  }

  public async reload(): Promise<void> {
    const loadVersion = ++this._loadVersion;
    this._log('reload start', this._debugSnapshot());
    this._clearMesh();

    if (shouldDisableWebGpuTslEffects()) {
      this._log('reload skipped: WebGPU TSL fog disabled for this browser');
      return;
    }

    const [geometry, textures] = await Promise.all([
      this._loadCardGeometry(),
      this._loadTextures(),
    ]);

    if (loadVersion !== this._loadVersion) {
      this._log('discarding stale reload result', { loadVersion, currentLoadVersion: this._loadVersion });
      geometry.dispose();
      return;
    }

    this._textures = textures;
    this._material = new FogCardMaterial(textures, this._currentSettings());
    this._mesh = new THREE.Mesh(geometry, this._material);
    this._mesh.name = 'FogCard';
    this._mesh.castShadow = false;
    this._mesh.receiveShadow = false;
    this._mesh.renderOrder = this.renderOrder;
    this.add(this._mesh);
    this._updateBillboardToCamera();
    this._log('reload complete: mesh/material attached', {
      geometry: this._geometryDebugInfo(geometry),
      material: {
        name: this._material.name,
        transparent: this._material.transparent,
        depthWrite: this._material.depthWrite,
        depthTest: this._material.depthTest,
        side: this._material.side,
        blending: this._material.blending,
        hasColorNode: Boolean(this._material.colorNode),
        hasOpacityNode: Boolean(this._material.opacityNode),
      },
      settings: this._visibilitySettingsSnapshot(),
    });
  }

  public updateFogValues(): void {
    this._material?.updateSettings(this._currentSettings());
    this._log('updateFogValues', this._visibilitySettingsSnapshot());
  }

  public updateSettings(partial: Partial<FogCardSettings>): void {
    if (partial.baseColorTint !== undefined) this.baseColorTint = colorInputToStyle(partial.baseColorTint);
    if (partial.atmosphereColor !== undefined) this.atmosphereColor = colorInputToStyle(partial.atmosphereColor);
    if (partial.useAtmosphereColor !== undefined) this.useAtmosphereColor = partial.useAtmosphereColor;
    if (partial.baseColorContrast !== undefined) this.baseColorContrast = partial.baseColorContrast;
    if (partial.baseColorIntensity !== undefined) this.baseColorIntensity = partial.baseColorIntensity;
    if (partial.baseColorOutputIntensity !== undefined) this.baseColorOutputIntensity = partial.baseColorOutputIntensity;
    if (partial.emissiveIntensity !== undefined) this.emissiveIntensity = partial.emissiveIntensity;
    if (partial.fogDensity !== undefined) this.fogDensity = partial.fogDensity;
    if (partial.cameraFadingDistance !== undefined) this.cameraFadingDistance = partial.cameraFadingDistance;
    if (partial.viewAngleFade !== undefined) this.viewAngleFade = partial.viewAngleFade;
    if (partial.flowMapIntensity !== undefined) this.flowMapIntensity = partial.flowMapIntensity;
    if (partial.flowMapSpeed !== undefined) this.flowMapSpeed = partial.flowMapSpeed;
    if (partial.flowMapTiling !== undefined) this.flowMapTiling = partial.flowMapTiling;
    if (partial.flowMapDirection !== undefined) this.flowMapDirection = partial.flowMapDirection;
    if (partial.useBorderMask !== undefined) this.useBorderMask = partial.useBorderMask;
    if (partial.windEnabled !== undefined) this.windEnabled = partial.windEnabled;
    if (partial.windSpeedX !== undefined) this.windSpeedX = partial.windSpeedX;
    if (partial.windSpeedY !== undefined) this.windSpeedY = partial.windSpeedY;
    if (partial.windNoiseTiling !== undefined) this.windNoiseTiling = partial.windNoiseTiling;
    if (partial.windNoiseContrast !== undefined) this.windNoiseContrast = partial.windNoiseContrast;
    if (partial.opacitySoftness !== undefined) this.opacitySoftness = partial.opacitySoftness;
    if (partial.opacityBias !== undefined) this.opacityBias = partial.opacityBias;
    this.updateFogValues();
  }

  public override describe(options?: ComponentDescriptionOptions): Record<string, unknown> {
    const result = super.describe(options);
    if (options?.includeDetails) {
      result['cardModelUrl'] = this.cardModelUrl;
      result['baseColorMapUrl'] = this.baseColorMapUrl;
      result['opacityMapUrl'] = this.opacityMapUrl;
      result['flowMapUrl'] = this.flowMapUrl;
      result['hasMesh'] = this._mesh !== null;
    }
    return result;
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_VFX';
  }

  private _currentSettings(): FogCardSettings {
    return {
      baseColorTint: this.baseColorTint,
      useAtmosphereColor: this.useAtmosphereColor,
      atmosphereColor: this.atmosphereColor,
      baseColorContrast: this.baseColorContrast,
      baseColorIntensity: this.baseColorIntensity,
      baseColorOutputIntensity: this.baseColorOutputIntensity,
      emissiveIntensity: this.emissiveIntensity,
      fogDensity: this.fogDensity,
      cameraFadingDistance: this.cameraFadingDistance,
      viewAngleFade: this.viewAngleFade,
      flowMapIntensity: this.flowMapIntensity,
      flowMapSpeed: this.flowMapSpeed,
      flowMapTiling: this.flowMapTiling,
      flowMapDirection: this.flowMapDirection,
      useBorderMask: this.useBorderMask,
      windEnabled: this.windEnabled,
      windSpeedX: this.windSpeedX,
      windSpeedY: this.windSpeedY,
      windNoiseTiling: this.windNoiseTiling,
      windNoiseContrast: this.windNoiseContrast,
      opacitySoftness: this.opacitySoftness,
      opacityBias: this.opacityBias,
    };
  }

  private _isAssetProperty(path: string): boolean {
    return path === 'cardModelUrl'
      || path === 'baseColorMapUrl'
      || path === 'opacityMapUrl'
      || path === 'normalMapUrl'
      || path === 'flowMapUrl'
      || path === 'borderMaskMapUrl'
      || path === 'windNoiseMapUrl';
  }

  private async _loadCardGeometry(): Promise<THREE.BufferGeometry> {
    try {
      this._log('loading card model', { cardModelUrl: this.cardModelUrl });
      const model = await ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(this.cardModelUrl), false);
      this._log('card model load result', {
        hasModel: Boolean(model),
        hasScene: Boolean(model?.scene),
        sceneChildren: model?.scene.children.length ?? 0,
      });
      const mesh = this._findFirstMesh(model?.scene ?? null);
      if (mesh) {
        this._log('using card mesh from model', {
          name: mesh.name || '<unnamed>',
          geometry: this._geometryDebugInfo(mesh.geometry),
          visible: mesh.visible,
        });
        const geometry = mesh.geometry.clone();
        mesh.updateWorldMatrix(true, false);
        geometry.applyMatrix4(mesh.matrixWorld);
        geometry.computeBoundingBox();
        if (geometry.boundingBox) {
          _geometryBox.copy(geometry.boundingBox);
          _geometryBox.getCenter(_geometryCenter);
          geometry.translate(-_geometryCenter.x, -_geometryCenter.y, -_geometryCenter.z);
        }
        return geometry;
      }
      this._warn('card model loaded, but no THREE.Mesh was found; using fallback plane');
    } catch (error) {
      this._warn('failed to load card model, using fallback plane', error);
    }

    const fallback = new THREE.PlaneGeometry(this.fallbackWidth, this.fallbackHeight);
    this._log('created fallback plane', this._geometryDebugInfo(fallback));
    return fallback;
  }

  private async _loadTextures(): Promise<FogCardTextures> {
    this._log('loading textures', {
      baseColorMapUrl: this.baseColorMapUrl,
      opacityMapUrl: this.opacityMapUrl,
      flowMapUrl: this.flowMapUrl,
      borderMaskMapUrl: this.borderMaskMapUrl,
      windNoiseMapUrl: this.windNoiseMapUrl,
    });
    const [baseColorMap, opacityMap, flowMap, borderMaskMap, windNoiseMap] = await Promise.all([
      ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(this.baseColorMapUrl)),
      ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(this.opacityMapUrl)),
      this.flowMapUrl ? ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(this.flowMapUrl)) : Promise.resolve(null),
      this.borderMaskMapUrl ? ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(this.borderMaskMapUrl)) : Promise.resolve(null),
      this.windNoiseMapUrl ? ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString(this.windNoiseMapUrl)) : Promise.resolve(null),
    ]);

    this._log('texture load result', {
      baseColorMap: this._textureDebugInfo(baseColorMap),
      opacityMap: this._textureDebugInfo(opacityMap),
      flowMap: this._textureDebugInfo(flowMap),
      borderMaskMap: this._textureDebugInfo(borderMaskMap),
      windNoiseMap: this._textureDebugInfo(windNoiseMap),
      baseColorFallbackUsed: !baseColorMap,
      opacityFallbackUsed: !opacityMap,
    });

    return {
      baseColorMap: configureFogCardTexture(baseColorMap ?? createFallbackTexture(255), THREE.NoColorSpace),
      opacityMap: configureFogCardTexture(opacityMap ?? createFallbackTexture(255), THREE.NoColorSpace),
      flowMap: flowMap ? configureFogCardTexture(flowMap, THREE.NoColorSpace) : null,
      borderMaskMap: borderMaskMap ? configureFogCardTexture(borderMaskMap, THREE.NoColorSpace) : null,
      windNoiseMap: windNoiseMap ? configureFogCardTexture(windNoiseMap, THREE.NoColorSpace) : null,
    };
  }

  private _findFirstMesh(root: THREE.Object3D | null): THREE.Mesh | null {
    if (!root) return null;

    let result: THREE.Mesh | null = null;
    root.traverse((child) => {
      if (!result && child instanceof THREE.Mesh) {
        result = child;
      }
    });
    return result;
  }

  private _clearMesh(): void {
    if (this._mesh) {
      this._mesh.removeFromParent();
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
    }
    this._mesh = null;
    this._material = null;
    this._textures = null;
  }

  private _updateBillboardToCamera(): void {
    if (!this.billboardToCamera || !this._mesh) return;

    const camera = this.getWorld()?.getActiveCamera();
    if (!camera) return;

    camera.getWorldPosition(_cameraWorldPosition);
    _cameraLocalPosition.copy(_cameraWorldPosition);
    this.worldToLocal(_cameraLocalPosition);

    const dx = _cameraLocalPosition.x - this._mesh.position.x;
    const dz = _cameraLocalPosition.z - this._mesh.position.z;
    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return;

    this._mesh.rotation.set(0, Math.atan2(dx, dz), 0);
  }

  private _syncBillboardLoop(): void {
    if (this.billboardToCamera) {
      this._startBillboardLoop();
      return;
    }
    this._stopBillboardLoop();
  }

  private _startBillboardLoop(): void {
    if (this._billboardRafId !== null || typeof window === 'undefined') return;

    const update = (): void => {
      this._billboardRafId = null;
      if (!this.billboardToCamera) return;

      this._updateBillboardToCamera();
      this._billboardRafId = window.requestAnimationFrame(update);
    };

    this._billboardRafId = window.requestAnimationFrame(update);
  }

  private _stopBillboardLoop(): void {
    if (this._billboardRafId === null || typeof window === 'undefined') {
      this._billboardRafId = null;
      return;
    }

    window.cancelAnimationFrame(this._billboardRafId);
    this._billboardRafId = null;
  }

  private _debugSnapshot(): Record<string, unknown> {
    return {
      cardModelUrl: this.cardModelUrl,
      baseColorMapUrl: this.baseColorMapUrl,
      opacityMapUrl: this.opacityMapUrl,
      flowMapUrl: this.flowMapUrl,
      borderMaskMapUrl: this.borderMaskMapUrl,
      windNoiseMapUrl: this.windNoiseMapUrl,
      hasMesh: Boolean(this._mesh),
      renderOrder: this.renderOrder,
      billboardToCamera: this.billboardToCamera,
      settings: this._visibilitySettingsSnapshot(),
    };
  }

  private _visibilitySettingsSnapshot(): Record<string, unknown> {
    return {
      fogDensity: this.fogDensity,
      emissiveIntensity: this.emissiveIntensity,
      cameraFadingDistance: this.cameraFadingDistance,
      viewAngleFade: this.viewAngleFade,
      useBorderMask: this.useBorderMask,
      windEnabled: this.windEnabled,
      opacitySoftness: this.opacitySoftness,
      opacityBias: this.opacityBias,
      baseColorTint: this.baseColorTint,
      atmosphereColor: this.atmosphereColor,
      useAtmosphereColor: this.useAtmosphereColor,
    };
  }

  private _geometryDebugInfo(geometry: THREE.BufferGeometry | null): Record<string, unknown> | null {
    if (!geometry) return null;

    geometry.computeBoundingBox();
    const position = geometry.getAttribute('position');
    return {
      type: geometry.type,
      vertexCount: position?.count ?? 0,
      hasUv: Boolean(geometry.getAttribute('uv')),
      boundingBox: geometry.boundingBox
        ? {
          min: geometry.boundingBox.min.toArray(),
          max: geometry.boundingBox.max.toArray(),
        }
        : null,
    };
  }

  private _textureDebugInfo(texture: THREE.Texture | null): Record<string, unknown> | null {
    if (!texture) return null;

    const image = texture.image as { width?: number; height?: number } | undefined;
    return {
      name: texture.name || '<unnamed>',
      uuid: texture.uuid,
      width: image?.width ?? null,
      height: image?.height ?? null,
      colorSpace: texture.colorSpace,
    };
  }

  private _log(message: string, data?: unknown): void {
    if (!this.debugLogging || !FogSystemComponent._isDebugLoggingEnabled()) return;
    if (data === undefined) {
      console.log(`[FogCard:${this.name || this.uuid}] ${message}`);
      return;
    }
    console.log(`[FogCard:${this.name || this.uuid}] ${message}`, data);
  }

  private static _isDebugLoggingEnabled(): boolean {
    if (typeof globalThis === 'undefined') {
      return false;
    }
    return (globalThis as Record<string, unknown>)[FOG_DEBUG_GLOBAL] === true;
  }

  private _warn(message: string, data?: unknown): void {
    if (data === undefined) {
      console.warn(`[FogCard:${this.name || this.uuid}] ${message}`);
      return;
    }
    console.warn(`[FogCard:${this.name || this.uuid}] ${message}`, data);
  }
}

