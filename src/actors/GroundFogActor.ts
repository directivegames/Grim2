/**
 * GroundFogActor — Custom ground mist using raw Three.js billboards.
 *
 * Horizontal cards on XZ that yaw to face the camera (stay flat); soft procedural alpha
 * (layered ovals + off-centre lobes — not a perfect circle). Fixed-area fog with push/swirl when the
 * player or zombies move through. Updates in tickPostPhysics.
 *
 * Performance: `MeshBasicMaterial` + one shared texture, throttled mover sampling, no per-frame scene
 * graph scans for the camera. Keep this actor “cheap” if you need headroom for a steady 60 FPS.
 */
import * as ENGINE from '@gnsx/genesys.js';
import type { ActorOptions } from '@gnsx/genesys.js';
import * as THREE from 'three';

import { NewZombieActor } from './NewZombieActor.js';
import { ZombieActor } from './ZombieActor.js';

// Density / look
const CARD_COUNT = 86;
const AREA_SIZE = 20;
const CARD_SIZE_MIN = 6.5;
const CARD_SIZE_RANGE = 5.5;
const FOG_COLORS = [0x8090a0, 0x90a0b0, 0xa0b0c0];
const OPACITY_MIN = 0.36;
const OPACITY_MAX = 0.58;
const DRIFT_SPEED = 0.06;
const ROTATION_SPEED = 0.12;
const FADE_IN_DURATION = 2.0;
const FADE_OUT_DURATION = 2.0;
const LIFETIME_MIN = 6.0;
const LIFETIME_MAX = 12.0;

// Movement disturbance (squared distance, capped movers, throttled refresh)
const MOVER_REFRESH_INTERVAL = 0.1;
const MAX_ZOMBIE_MOVERS = 12;
const MIN_MOVER_SPEED_SQ = 0.02;
const INFLUENCE_RADIUS = 8;
const INFLUENCE_RADIUS_SQ = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
const PUSH_STRENGTH = 1.65;
const SWIRL_STRENGTH = 0.42;
const DISTURBANCE_BLEND = 8.0;
/** Direct XZ nudge per second at full strength (visible swirl). */
const POSITION_NUDGE = 0.85;

interface Mover {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

interface FogCard {
  mesh: THREE.Mesh;
  baseY: number;
  ambientDrift: THREE.Vector3;
  driftDir: THREE.Vector3;
  rotSpeed: number;
  lifetime: number;
  age: number;
  maxOpacity: number;
}

@ENGINE.GameClass()
export class GroundFogActor extends ENGINE.Actor {
  /** Raise or lower the whole mist volume in actor space (horizontal fog sits near y ≈ 0). */
  @ENGINE.property({ type: 'number', step: 0.01, category: 'Ground Fog' })
  public groundVerticalOffset: number = 0;

  private _cards: FogCard[] = [];
  private _texture: THREE.Texture | null = null;
  private _movers: Mover[] = [];
  private _moverRefreshTimer = 0;
  private _zombieLastPos = new Map<ENGINE.Actor, { x: number; z: number }>();
  private _playerLastPos: { x: number; z: number } | null = null;

  private readonly _scratchCardWorld = new THREE.Vector3();
  private readonly _scratchFogOrigin = new THREE.Vector3();
  private readonly _scratchTargetDrift = new THREE.Vector3();

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
    this._texture = this._createProceduralTexture();
  }

  /**
   * Shared grayscale for alphaMap: layered stretched radials + off-centre lobe so the
   * silhouette is never a perfect circle; smooth canvas gradients only.
   */
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

  private _createMaterial(): THREE.MeshBasicMaterial {
    const color = FOG_COLORS[Math.floor(Math.random() * FOG_COLORS.length)];
    return new THREE.MeshBasicMaterial({
      color,
      alphaMap: this._texture ?? undefined,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      alphaTest: 0,
    });
  }

  private _buildPool(): void {
    const root = this.rootComponent;

    for (let i = 0; i < CARD_COUNT; i++) {
      const geometry = new THREE.PlaneGeometry(
        CARD_SIZE_MIN + Math.random() * CARD_SIZE_RANGE,
        CARD_SIZE_MIN + Math.random() * CARD_SIZE_RANGE
      );
      const mesh = new THREE.Mesh(geometry, this._createMaterial());
      mesh.frustumCulled = false;

      const x = (Math.random() - 0.5) * AREA_SIZE * 2;
      const z = (Math.random() - 0.5) * AREA_SIZE * 2;
      const y = this.groundVerticalOffset + Math.random() * 0.32;

      mesh.position.set(x, y, z);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI * 2;

      root.add(mesh);

      const ambientDrift = new THREE.Vector3(
        (Math.random() - 0.5) * DRIFT_SPEED,
        0,
        (Math.random() - 0.5) * DRIFT_SPEED
      );

      this._cards.push({
        mesh,
        baseY: y,
        ambientDrift,
        driftDir: ambientDrift.clone(),
        rotSpeed: (Math.random() - 0.5) * ROTATION_SPEED,
        lifetime: LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN),
        age: Math.random() * 5,
        maxOpacity: OPACITY_MIN + Math.random() * (OPACITY_MAX - OPACITY_MIN),
      });
    }
  }

  private _refreshMovers(world: ENGINE.World, dt: number): void {
    this._movers.length = 0;
    if (dt < 1e-4) return;

    this._scratchFogOrigin.copy(this.getWorldPosition());
    const ox = this._scratchFogOrigin.x;
    const oz = this._scratchFogOrigin.z;
    const bounds = AREA_SIZE + INFLUENCE_RADIUS;

    const player = world.getFirstPlayerPawn();
    if (player) {
      const pos = player.getWorldPosition();
      let vx = 0;
      let vz = 0;
      const last = this._playerLastPos;
      if (last) {
        vx = (pos.x - last.x) / dt;
        vz = (pos.z - last.z) / dt;
      }
      this._playerLastPos = { x: pos.x, z: pos.z };

      if (vx * vx + vz * vz >= MIN_MOVER_SPEED_SQ) {
        if (Math.abs(pos.x - ox) <= bounds && Math.abs(pos.z - oz) <= bounds) {
          this._movers.push({ x: pos.x, z: pos.z, vx, vz });
        }
      }
    }

    let zombieCount = 0;

    for (const actor of world.getActors()) {
      if (zombieCount >= MAX_ZOMBIE_MOVERS) break;
      if (!(actor instanceof ZombieActor) && !(actor instanceof NewZombieActor)) continue;

      const pos = actor.getWorldPosition();
      if (Math.abs(pos.x - ox) > bounds || Math.abs(pos.z - oz) > bounds) continue;

      const last = this._zombieLastPos.get(actor);
      let vx = 0;
      let vz = 0;
      if (last) {
        vx = (pos.x - last.x) / dt;
        vz = (pos.z - last.z) / dt;
      }
      this._zombieLastPos.set(actor, { x: pos.x, z: pos.z });

      if (vx * vx + vz * vz < MIN_MOVER_SPEED_SQ) continue;

      this._movers.push({ x: pos.x, z: pos.z, vx, vz });
      zombieCount++;
    }
  }

  private _applyDisturbance(card: FogCard, deltaTime: number): void {
    const blend = Math.min(1, DISTURBANCE_BLEND * deltaTime);
    if (this._movers.length === 0) {
      card.driftDir.lerp(card.ambientDrift, blend);
      return;
    }

    card.mesh.getWorldPosition(this._scratchCardWorld);
    const cx = this._scratchCardWorld.x;
    const cz = this._scratchCardWorld.z;

    this._scratchTargetDrift.copy(card.ambientDrift);

    for (const mover of this._movers) {
      const dx = cx - mover.x;
      const dz = cz - mover.z;
      const dSq = dx * dx + dz * dz;
      if (dSq > INFLUENCE_RADIUS_SQ || dSq < 1e-6) continue;

      const d = Math.sqrt(dSq);
      const falloff = 1 - d / INFLUENCE_RADIUS;
      const t = falloff * falloff;
      const speed = Math.min(1, Math.hypot(mover.vx, mover.vz) / 3.5);
      const strength = t * Math.max(0.15, speed);

      const nx = dx / d;
      const nz = dz / d;

      this._scratchTargetDrift.x += nx * PUSH_STRENGTH * strength;
      this._scratchTargetDrift.z += nz * PUSH_STRENGTH * strength;

      const tx = -nz;
      const tz = nx;
      const swirlSign = mover.vx * tx + mover.vz * tz >= 0 ? 1 : -1;
      this._scratchTargetDrift.x += tx * SWIRL_STRENGTH * strength * swirlSign;
      this._scratchTargetDrift.z += tz * SWIRL_STRENGTH * strength * swirlSign;

      const nudge = POSITION_NUDGE * strength * deltaTime;
      card.mesh.position.x += nx * nudge + tx * swirlSign * nudge * 0.35;
      card.mesh.position.z += nz * nudge + tz * swirlSign * nudge * 0.35;
    }

    card.driftDir.lerp(this._scratchTargetDrift, blend);
  }

  public override doBeginPlay(): void {
    super.doBeginPlay();
    if (this._cards.length === 0) {
      this._buildPool();
    }
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);

    const world = this.getWorld();
    if (!world) return;

    this._moverRefreshTimer += deltaTime;
    if (this._moverRefreshTimer >= MOVER_REFRESH_INTERVAL) {
      const refreshDt = this._moverRefreshTimer;
      this._moverRefreshTimer = 0;
      this._refreshMovers(world, refreshDt);
    }

    const camera = world.getActiveCamera();

    for (const card of this._cards) {
      card.age += deltaTime;

      this._applyDisturbance(card, deltaTime);

      const m = card.mesh;
      if (camera) {
        const dx = camera.position.x - m.position.x;
        const dz = camera.position.z - m.position.z;
        m.rotation.x = -Math.PI / 2;
        m.rotation.y = Math.atan2(dx, dz);
      }
      m.rotation.z += card.rotSpeed * deltaTime;

      card.mesh.position.addScaledVector(card.driftDir, deltaTime);

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
        Math.min(opacity, card.maxOpacity)
      );

      if (card.age >= card.lifetime) {
        card.age = 0;
        card.mesh.position.set(
          (Math.random() - 0.5) * AREA_SIZE * 2,
          card.baseY,
          (Math.random() - 0.5) * AREA_SIZE * 2
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
    this._movers.length = 0;
    this._zombieLastPos.clear();
    this._playerLastPos = null;
    this._texture?.dispose();
    this._texture = null;
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Particle';
  }
}
