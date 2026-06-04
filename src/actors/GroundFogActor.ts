/**
 * GroundFogActor — Two-layer ground mist.
 *
 * Base: soft procedural blobs hugging the floor (less dense than legacy fog).
 * Smoke: textured billboard puffs raised so the player walks through them.
 */
import * as ENGINE from '@gnsx/genesys.js';
import type { ActorOptions } from '@gnsx/genesys.js';
import * as THREE from 'three';

import {
  createBillboardSmokeMaterial,
  loadSmokeTexture,
} from '../components/vfx/BillboardSmokePuffs.js';

const SMOKE_TEXTURE_PATH = '@project/assets/textures/vfx/Smoke.png';
const SMOKE_TEXTURE_FALLBACK = '@project/assets/VFX/newfog.webp';

const AREA_SIZE = 20;
const FADE_IN_DURATION = 2.5;
const FADE_OUT_DURATION = 2.5;

// Upper smoke layer (textured puffs)
const SMOKE_CARD_COUNT = 86;
const SMOKE_SIZE_MIN = 7;
const SMOKE_SIZE_RANGE = 6;
const SMOKE_Y_BASE = 0.55;
const SMOKE_Y_RANGE = 0.6;
const SMOKE_OPACITY_MIN = 0.18;
const SMOKE_OPACITY_MAX = 0.32;
const SMOKE_DRIFT_SPEED = 0.035;
const SMOKE_ROTATION_SPEED = 0.06;
const SMOKE_LIFETIME_MIN = 8.0;
const SMOKE_LIFETIME_MAX = 14.0;

const SMOKE_HUE: [number, number] = [0.54, 0.62];
const SMOKE_SATURATION: [number, number] = [0.15, 0.32];
const SMOKE_LIGHTNESS: [number, number] = [0.42, 0.58];

// Lower base layer (procedural alpha blobs)
const BASE_CARD_COUNT = 48;
const BASE_SIZE_MIN = 5.5;
const BASE_SIZE_RANGE = 4.5;
const BASE_Y_BASE = 0.12;
const BASE_Y_RANGE = 0.22;
const BASE_OPACITY_MIN = 0.16;
const BASE_OPACITY_MAX = 0.28;
const BASE_DRIFT_SPEED = 0.02;
const BASE_ROTATION_SPEED = 0.05;
const BASE_LIFETIME_MIN = 9.0;
const BASE_LIFETIME_MAX = 15.0;
const BASE_FOG_COLORS = [0x7080a0, 0x8090b8, 0x687898];

interface FogCard {
  mesh: THREE.Mesh;
  baseY: number;
  ambientDrift: THREE.Vector3;
  rotSpeed: number;
  lifetime: number;
  age: number;
  maxOpacity: number;
}

@ENGINE.GameClass()
export class GroundFogActor extends ENGINE.Actor {
  @ENGINE.property({ type: 'number', step: 0.01, category: 'Ground Fog' })
  public groundVerticalOffset: number = 0;

  private _cards: FogCard[] = [];
  private _proceduralTexture: THREE.Texture | null = null;
  private _smokeTexture: THREE.Texture | null = null;
  private _poolReady = false;
  private _smokeLayerBuilt = false;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
    this._proceduralTexture = this._createProceduralTexture();
  }

  private _createProceduralTexture(): THREE.Texture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgb(0,0,0)';
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.translate(size * 0.5, size * 0.5);
    ctx.scale(1.28, 0.72);
    const body = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.42);
    body.addColorStop(0, 'rgb(255,255,255)');
    body.addColorStop(0.18, 'rgb(220,220,220)');
    body.addColorStop(0.42, 'rgb(120,120,120)');
    body.addColorStop(0.68, 'rgb(45,45,45)');
    body.addColorStop(0.88, 'rgb(12,12,12)');
    body.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(size * 0.58, size * 0.44);
    ctx.scale(0.75, 1.05);
    const bump = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.22);
    bump.addColorStop(0, 'rgb(70,70,70)');
    bump.addColorStop(0.45, 'rgb(28,28,28)');
    bump.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = bump;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(size * 0.36, size * 0.56);
    ctx.scale(1.1, 0.55);
    const tail = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.26);
    tail.addColorStop(0, 'rgb(48,48,48)');
    tail.addColorStop(0.5, 'rgb(18,18,18)');
    tail.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  private _createBaseMaterial(): THREE.MeshBasicMaterial {
    const color = BASE_FOG_COLORS[Math.floor(Math.random() * BASE_FOG_COLORS.length)];
    const tex = this._proceduralTexture ?? undefined;
    return new THREE.MeshBasicMaterial({
      color,
      map: tex,
      alphaMap: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
  }

  private _createSmokeMaterial(): THREE.MeshBasicMaterial {
    const material = createBillboardSmokeMaterial({
      texture: this._smokeTexture,
      blending: THREE.NormalBlending,
      hue: SMOKE_HUE,
      saturation: SMOKE_SATURATION,
      lightness: SMOKE_LIGHTNESS,
      opacity: 0,
    });
    material.alphaTest = 0;
    return material;
  }

  private _spawnCard(
    root: ENGINE.SceneComponent,
    material: THREE.MeshBasicMaterial,
    sizeMin: number,
    sizeRange: number,
    y: number,
    driftSpeed: number,
    rotSpeed: number,
    lifetimeMin: number,
    lifetimeMax: number,
    opacityMin: number,
    opacityMax: number,
  ): void {
    const geometry = new THREE.PlaneGeometry(
      sizeMin + Math.random() * sizeRange,
      sizeMin + Math.random() * sizeRange,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;

    const x = (Math.random() - 0.5) * AREA_SIZE * 2;
    const z = (Math.random() - 0.5) * AREA_SIZE * 2;

    mesh.position.set(x, y, z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;

    root.add(mesh);

    this._cards.push({
      mesh,
      baseY: y,
      ambientDrift: new THREE.Vector3(
        (Math.random() - 0.5) * driftSpeed,
        0,
        (Math.random() - 0.5) * driftSpeed,
      ),
      rotSpeed: (Math.random() - 0.5) * rotSpeed,
      lifetime: lifetimeMin + Math.random() * (lifetimeMax - lifetimeMin),
      age: Math.random() * 5,
      maxOpacity: opacityMin + Math.random() * (opacityMax - opacityMin),
    });
  }

  private _buildBasePool(): void {
    const root = this.rootComponent;
    const baseY = this.groundVerticalOffset;

    for (let i = 0; i < BASE_CARD_COUNT; i++) {
      this._spawnCard(
        root,
        this._createBaseMaterial(),
        BASE_SIZE_MIN,
        BASE_SIZE_RANGE,
        baseY + BASE_Y_BASE + Math.random() * BASE_Y_RANGE,
        BASE_DRIFT_SPEED,
        BASE_ROTATION_SPEED,
        BASE_LIFETIME_MIN,
        BASE_LIFETIME_MAX,
        BASE_OPACITY_MIN,
        BASE_OPACITY_MAX,
      );
    }
  }

  private _buildSmokePool(): void {
    const root = this.rootComponent;
    const baseY = this.groundVerticalOffset;

    for (let i = 0; i < SMOKE_CARD_COUNT; i++) {
      this._spawnCard(
        root,
        this._createSmokeMaterial(),
        SMOKE_SIZE_MIN,
        SMOKE_SIZE_RANGE,
        baseY + SMOKE_Y_BASE + Math.random() * SMOKE_Y_RANGE,
        SMOKE_DRIFT_SPEED,
        SMOKE_ROTATION_SPEED,
        SMOKE_LIFETIME_MIN,
        SMOKE_LIFETIME_MAX,
        SMOKE_OPACITY_MIN,
        SMOKE_OPACITY_MAX,
      );
    }

    this._smokeLayerBuilt = true;
  }

  private async _loadSmokeTexture(): Promise<void> {
    if (this._smokeTexture) return;

    this._smokeTexture = await loadSmokeTexture(SMOKE_TEXTURE_PATH);
    if (!this._smokeTexture) {
      this._smokeTexture = await loadSmokeTexture(SMOKE_TEXTURE_FALLBACK);
    }
  }

  public override doBeginPlay(): void {
    super.doBeginPlay();
    void this._beginFog();
  }

  private async _beginFog(): Promise<void> {
    if (!this._poolReady) {
      this._buildBasePool();
      this._poolReady = true;
    }
    await this._loadSmokeTexture();
    if (!this._smokeLayerBuilt) {
      this._buildSmokePool();
    }
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);

    const world = this.getWorld();
    if (!world || !this._poolReady) return;

    const camera = world.getActiveCamera();

    for (const card of this._cards) {
      card.age += deltaTime;

      const m = card.mesh;
      if (camera) {
        const dx = camera.position.x - m.position.x;
        const dz = camera.position.z - m.position.z;
        m.rotation.x = -Math.PI / 2;
        m.rotation.y = Math.atan2(dx, dz);
      }
      m.rotation.z += card.rotSpeed * deltaTime;

      card.mesh.position.addScaledVector(card.ambientDrift, deltaTime);

      if (Math.abs(card.mesh.position.x) > AREA_SIZE) {
        card.mesh.position.x *= -0.9;
      }
      if (Math.abs(card.mesh.position.z) > AREA_SIZE) {
        card.mesh.position.z *= -0.9;
      }

      let opacity: number;
      if (card.age < FADE_IN_DURATION) {
        opacity = (card.age / FADE_IN_DURATION) * card.maxOpacity;
      } else if (card.age > card.lifetime - FADE_OUT_DURATION) {
        opacity = ((card.lifetime - card.age) / FADE_OUT_DURATION) * card.maxOpacity;
      } else {
        opacity = card.maxOpacity;
      }

      (card.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        Math.min(opacity, card.maxOpacity),
      );

      if (card.age >= card.lifetime) {
        card.age = 0;
        card.mesh.position.set(
          (Math.random() - 0.5) * AREA_SIZE * 2,
          card.baseY,
          (Math.random() - 0.5) * AREA_SIZE * 2,
        );
      }
    }
  }

  public override doEndPlay(): void {
    for (const card of this._cards) {
      card.mesh.geometry.dispose();
      (card.mesh.material as THREE.Material).dispose();
    }
    this._cards = [];
    this._poolReady = false;
    this._smokeLayerBuilt = false;
    this._smokeTexture = null;
    this._proceduralTexture?.dispose();
    this._proceduralTexture = null;
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Particle';
  }
}
