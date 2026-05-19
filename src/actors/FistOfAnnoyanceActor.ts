/**
 * FistOfAnnoyanceActor — Giant fist impact effect.
 *
 * Uses pure Three.js geometry with additive blending (same pattern as DustTrailComponent).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { slomoManager } from './KillStreakTracker.js';
import { HitNumberUI } from '../ui/HitNumberUI.js';
import {
  type BillboardSmokePuff,
  loadSmokeTexture,
  spawnBillboardSmokeBurst,
  tickBillboardSmokePuffs,
} from '../components/vfx/BillboardSmokePuffs.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIST_ACTOR_NAME = 'fistofannoyance';
const SLOMO_VALUE = 0.30;
const FIST_SLOMO_PRIORITY = 2;

const FIST_START_Y = -3.5;
const FIST_PEAK_Y = -0.1;

const RISE_DURATION = 0.26;
const PAUSE_DURATION = 0.01;
const RETRACT_DURATION = 0.20;

const FIST_HIT_RADIUS = 2.4;
const ONE_HIT_DAMAGE = 99999;
const DEBRIS_COUNT = 26;
const DEBRIS_LIFETIME = 1.6;
const GRAVITY = 9.5;

const RISING_DUST_INTERVAL = 0.05;

const FLASH_LIFETIME = 0.35;
const SHOCKWAVE_LIFETIME = 0.5;

// ─── Geometry ────────────────────────────────────────────────────────────────

const DEBRIS_PLANE_GEO = new THREE.PlaneGeometry(1, 1);
const FLASH_GEO = new THREE.SphereGeometry(1, 16, 12);
const SHOCKWAVE_GEO = new THREE.TorusGeometry(1, 0.035, 6, 32);

const DUST_TEXTURE_PATH = '@project/assets/textures/vfx/DustPuffSoft.png';
/** Texture from `explosion-cloud.vfx.json` (CloudChunky). */
const EXPLOSION_CLOUD_TEXTURE_PATH = '@project/assets/textures/vfx/CloudChunky.png';
const ROCK_DEBRIS_TEXTURE_PATH = '@project/assets/VFX/rockdebris.png';

// ─── Types ────────────────────────────────────────────────────────────────────

type FistPhase = 'rising' | 'paused' | 'retracting' | 'finishing' | 'done';

interface RockDebris {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: number;
  elapsed: number;
}

interface ImpactFlash {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
}

interface Shockwave {
  mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutQuart(t: number): number { return 1 - Math.pow(1 - t, 4); }
function easeInQuart(t: number): number { return t * t * t * t; }
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

// ─── FistOfAnnoyanceActor ────────────────────────────────────────────────────

@ENGINE.GameClass()
export class FistOfAnnoyanceActor extends ENGINE.Actor {

  private _sceneFistActor: ENGINE.Actor | null = null;
  private _phase: FistPhase = 'rising';
  private _phaseElapsed = 0;
  private _phaseStartMs = 0;
  private _groundY = 0;
  private _hasHit = false;
  private _vfxSpawned = false;
  private _cinematicReturned = false;

  private readonly _debris: RockDebris[] = [];
  private readonly _flashes: ImpactFlash[] = [];
  private readonly _shockwaves: Shockwave[] = [];
  private readonly _smokePuffs: BillboardSmokePuff[] = [];
  private _dustTexture: THREE.Texture | null = null;
  private _explosionCloudTexture: THREE.Texture | null = null;
  private _rockDebrisTexture: THREE.Texture | null = null;
  private _risingDustTimer = 0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const world = this.getWorld();
    if (!world) return;

    for (const actor of world.getActors()) {
      if (actor.name.toLowerCase() === FIST_ACTOR_NAME.toLowerCase()) {
        this._sceneFistActor = actor;
        break;
      }
    }

    if (!this._sceneFistActor) {
      console.warn(`[FistOfAnnoyanceActor] No scene actor named "${FIST_ACTOR_NAME}" found.`);
      this.destroy();
      return;
    }

    this._groundY = this.rootComponent.position.y;
    this._phase = 'rising';
    this._phaseElapsed = 0;
    this._phaseStartMs = performance.now();
    this._hasHit = false;
    this._vfxSpawned = false;
    this._cinematicReturned = false;

    this._setFistPosition(this._groundY + FIST_START_Y);

    const player = world.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.startCinematicFocus(this.rootComponent.position.clone());
    }

    slomoManager.setSlomo(world, SLOMO_VALUE, FIST_SLOMO_PRIORITY);
    void Promise.all([
      loadSmokeTexture(DUST_TEXTURE_PATH),
      loadSmokeTexture(EXPLOSION_CLOUD_TEXTURE_PATH),
      loadSmokeTexture(ROCK_DEBRIS_TEXTURE_PATH),
    ]).then(([dust, cloud, rock]) => {
      this._dustTexture = dust;
      this._explosionCloudTexture = cloud;
      this._rockDebrisTexture = rock;
    });
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this._phase === 'done' || !this._sceneFistActor) return;

    this._phaseElapsed = (performance.now() - this._phaseStartMs) / 1000;
    tickBillboardSmokePuffs(this._smokePuffs, deltaTime);

    switch (this._phase) {
      case 'rising': {
        const t = Math.min(this._phaseElapsed / RISE_DURATION, 1);
        const y = THREE.MathUtils.lerp(
          this._groundY + FIST_START_Y,
          this._groundY + FIST_PEAK_Y,
          easeOutQuart(t),
        );
        this._setFistPosition(y);

        this._risingDustTimer += deltaTime;
        if (this._risingDustTimer >= RISING_DUST_INTERVAL) {
          this._risingDustTimer = 0;
          void this._spawnRisingDustPuff();
        }

        if (!this._vfxSpawned && t >= 0.5) {
          void this._spawnGroundBreakVFX();
          this._spawnImpactFlash();
          this._spawnShockwave();
          this._vfxSpawned = true;
          const player = this.getWorld()?.getFirstPlayerPawn();
          if (player && (player as unknown as { triggerScreenShake?: (a: number, d: number) => void }).triggerScreenShake) {
            (player as unknown as { triggerScreenShake(a: number, d: number): void }).triggerScreenShake(0.35, 0.7);
          }
        }

        if (!this._hasHit) this._checkHits();

        if (t >= 1) { this._phase = 'paused'; this._phaseElapsed = 0; this._phaseStartMs = performance.now(); }
        break;
      }

      case 'paused': {
        if (this._phaseElapsed >= PAUSE_DURATION) {
          this._phase = 'retracting';
          this._phaseElapsed = 0;
          this._phaseStartMs = performance.now();

          const w = this.getWorld();
          if (w) {
            const p = w.getFirstPlayerPawn();
            if (p instanceof IsometricPlayerPawn) p.endCinematicFocus();
          }
        }
        break;
      }

      case 'retracting': {
        const t = Math.min(this._phaseElapsed / RETRACT_DURATION, 1);
        const y = THREE.MathUtils.lerp(
          this._groundY + FIST_PEAK_Y,
          this._groundY + FIST_START_Y,
          easeInQuart(t),
        );
        this._setFistPosition(y);

        if (t >= 1) {
          this._phase = 'finishing';
          this._phaseElapsed = 0;
          this._setFistPosition(-1000);
        }
        break;
      }

      case 'finishing': {
        const w = this.getWorld();
        if (w) {
          const p = w.getFirstPlayerPawn();
          if (p instanceof IsometricPlayerPawn && !this._cinematicReturned) {
            p.endCinematicFocus();
            this._cinematicReturned = true;
          }
        }

        this._updateVFX(deltaTime);

        const vfxFinished = this._debris.length === 0 &&
          this._flashes.length === 0 &&
          this._shockwaves.length === 0 &&
          this._smokePuffs.length === 0;

        if (vfxFinished) {
          this._phase = 'done';
          this.destroy();
          return;
        }
        break;
      }
    }
  }

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): FistOfAnnoyanceActor {
    const actor = FistOfAnnoyanceActor.create({ position: position.clone() });
    world.addActor(actor);
    return actor;
  }

  private _setFistPosition(y: number): void {
    if (!this._sceneFistActor) return;
    this._sceneFistActor.rootComponent.position.set(
      this.rootComponent.position.x,
      y,
      this.rootComponent.position.z,
    );
  }

  private _checkHits(): void {
    const world = this.getWorld();
    if (!world || !this._sceneFistActor) return;

    const fistPos = new THREE.Vector3();
    this._sceneFistActor.rootComponent.getWorldPosition(fistPos);

    const nearby = zombieSpatialManager.getNearbyZombies(fistPos, FIST_HIT_RADIUS);
    const zPos = new THREE.Vector3();

    for (const zombie of nearby) {
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

      zombie.rootComponent.getWorldPosition(zPos);
      const dx = zPos.x - fistPos.x;
      const dz = zPos.z - fistPos.z;
      if (dx * dx + dz * dz > FIST_HIT_RADIUS * FIST_HIT_RADIUS) continue;

      zombie.getComponent(ENGINE.CharacterStatsComponent)?.takeDamage(ONE_HIT_DAMAGE, {
        hitLocation: zPos.clone(),
        hitNormal: new THREE.Vector3(0, 1, 0),
      });

      this._showHitNumber(world, zPos);

      (zombie as unknown as { flashYellow(): void }).flashYellow?.();
      GoreExplosionActor.spawnAt(world, zPos);
      this._hasHit = true;
    }
  }

  private _showHitNumber(world: ENGINE.World, pos: THREE.Vector3): void {
    HitNumberUI.getInstance(world).showDamage(ONE_HIT_DAMAGE, pos);
  }

  private _spawnImpactFlash(): void {
    const world = this.getWorld();
    if (!world) return;

    const origin = new THREE.Vector3(
      this.rootComponent.position.x,
      this._groundY,
      this.rootComponent.position.z,
    );

    const material = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(FLASH_GEO, material);
    mesh.scale.setScalar(0.3);
    mesh.position.copy(origin);
    world.scene.add(mesh);

    this._flashes.push({ mesh, elapsed: 0 });
  }

  private _spawnShockwave(): void {
    const world = this.getWorld();
    if (!world) return;

    const origin = new THREE.Vector3(
      this.rootComponent.position.x,
      this._groundY + 0.04,
      this.rootComponent.position.z,
    );

    const material = new THREE.MeshBasicMaterial({
      color: 0x5a8fc8,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(SHOCKWAVE_GEO, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(0.2);
    mesh.position.copy(origin);
    world.scene.add(mesh);

    this._shockwaves.push({ mesh, elapsed: 0 });
  }

  private async _spawnRisingDustPuff(): Promise<void> {
    const world = this.getWorld();
    if (!world) return;

    if (!this._dustTexture) {
      this._dustTexture = await loadSmokeTexture(DUST_TEXTURE_PATH);
    }

    const origin = new THREE.Vector3();
    if (this._sceneFistActor) {
      this._sceneFistActor.rootComponent.getWorldPosition(origin);
    } else {
      origin.set(this.rootComponent.position.x, this._groundY + 0.05, this.rootComponent.position.z);
    }

    spawnBillboardSmokeBurst(world, origin, this._dustTexture, this._smokePuffs, {
      count: 4,
      texturePath: DUST_TEXTURE_PATH,
      lifetime: 1.1,
      hue: [0.08, 0.12],
      saturation: [0.4, 0.55],
      lightness: [0.55, 0.72],
      maxScale: [1.1, 2.0],
      horizontalSpeed: [0.15, 0.55],
      verticalSpeed: [1.0, 2.0],
      peakOpacity: 0.75,
      size: 1.05,
      blending: THREE.AdditiveBlending,
    });
  }

  private async _spawnGroundBreakVFX(): Promise<void> {
    const world = this.getWorld();
    if (!world) return;

    const origin = new THREE.Vector3(
      this.rootComponent.position.x,
      this._groundY,
      this.rootComponent.position.z,
    );

    if (!this._explosionCloudTexture) {
      this._explosionCloudTexture = await loadSmokeTexture(EXPLOSION_CLOUD_TEXTURE_PATH);
    }
    if (!this._dustTexture) {
      this._dustTexture = await loadSmokeTexture(DUST_TEXTURE_PATH);
    }
    if (!this._rockDebrisTexture) {
      this._rockDebrisTexture = await loadSmokeTexture(ROCK_DEBRIS_TEXTURE_PATH);
    }

    // Main explosion cloud (CloudChunky — matches explosion-cloud.vfx.json)
    spawnBillboardSmokeBurst(world, origin, this._explosionCloudTexture, this._smokePuffs, {
      count: 14,
      texturePath: EXPLOSION_CLOUD_TEXTURE_PATH,
      lifetime: 1.85,
      hue: [0.07, 0.11],
      saturation: [0.18, 0.32],
      lightness: [0.48, 0.62],
      maxScale: [2.8, 4.8],
      horizontalSpeed: [0.4, 1.4],
      verticalSpeed: [0.9, 2.4],
      peakOpacity: 0.88,
      size: 2.1,
      blending: THREE.NormalBlending,
    });

    // Fine dust ring (DustPuffSoft)
    spawnBillboardSmokeBurst(world, origin, this._dustTexture, this._smokePuffs, {
      count: 20,
      texturePath: DUST_TEXTURE_PATH,
      lifetime: 1.35,
      hue: [0.07, 0.13],
      saturation: [0.45, 0.6],
      lightness: [0.58, 0.75],
      maxScale: [1.6, 2.8],
      horizontalSpeed: [1.4, 4.0],
      verticalSpeed: [0.5, 1.4],
      peakOpacity: 0.9,
      size: 1.25,
      blending: THREE.AdditiveBlending,
    });

    this._spawnRockDebris(world, origin);
  }

  private _spawnRockDebris(world: ENGINE.World, origin: THREE.Vector3): void {
    if (!this._rockDebrisTexture) return;

    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const size = randomBetween(0.12, 0.42);
      const mat = new THREE.MeshBasicMaterial({
        map: this._rockDebrisTexture,
        alphaMap: this._rockDebrisTexture,
        color: new THREE.Color().setHSL(
          randomBetween(0.06, 0.11),
          randomBetween(0.2, 0.45),
          randomBetween(0.55, 0.78),
        ),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        alphaTest: 0.04,
      });

      const mesh = new THREE.Mesh(DEBRIS_PLANE_GEO, mat);
      mesh.scale.setScalar(size * randomBetween(0.85, 1.35));
      mesh.position.copy(origin);
      mesh.position.y += randomBetween(0, 0.15);
      mesh.rotation.set(-Math.PI / 2, 0, randomBetween(0, Math.PI * 2));
      world.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(4.0, 11.5);

      this._debris.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          randomBetween(3.0, 8.5),
          Math.sin(angle) * speed,
        ),
        spin: randomBetween(-9, 9),
        elapsed: 0,
      });
    }
  }

  private _updateVFX(deltaTime: number): void {
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const d = this._debris[i];
      d.elapsed += deltaTime;
      d.velocity.y -= GRAVITY * deltaTime;
      d.mesh.position.addScaledVector(d.velocity, deltaTime);
      d.mesh.rotation.z += d.spin * deltaTime;
      d.mesh.material.opacity = Math.max(0, 1 - d.elapsed / DEBRIS_LIFETIME);
      if (d.elapsed >= DEBRIS_LIFETIME) {
        d.mesh.material.dispose();
        d.mesh.removeFromParent();
        this._debris.splice(i, 1);
      }
    }

    // Update flashes
    for (let i = this._flashes.length - 1; i >= 0; i--) {
      const f = this._flashes[i];
      f.elapsed += deltaTime;
      const progress = Math.min(f.elapsed / FLASH_LIFETIME, 1);
      const scale = THREE.MathUtils.lerp(0.3, 2.5, easeOutCubic(progress));
      f.mesh.scale.setScalar(scale);
      f.mesh.material.opacity = 0.8 * Math.max(0, 1 - progress);
      if (progress >= 1) {
        f.mesh.material.dispose();
        f.mesh.removeFromParent();
        this._flashes.splice(i, 1);
      }
    }

    // Update shockwaves
    for (let i = this._shockwaves.length - 1; i >= 0; i--) {
      const s = this._shockwaves[i];
      s.elapsed += deltaTime;
      const progress = Math.min(s.elapsed / SHOCKWAVE_LIFETIME, 1);
      const scale = THREE.MathUtils.lerp(0.2, 3.5, easeOutCubic(progress));
      s.mesh.scale.setScalar(scale);
      s.mesh.material.opacity = 0.6 * Math.max(0, 1 - progress);
      if (progress >= 1) {
        s.mesh.material.dispose();
        s.mesh.removeFromParent();
        this._shockwaves.splice(i, 1);
      }
    }
  }

  private _cleanupVFX(): void {
    for (const d of this._debris) { d.mesh.material.dispose(); d.mesh.removeFromParent(); }
    for (const s of this._smokePuffs) { s.mesh.material.dispose(); s.mesh.removeFromParent(); }
    this._smokePuffs.length = 0;
    for (const f of this._flashes) { f.mesh.material.dispose(); f.mesh.removeFromParent(); }
    for (const s of this._shockwaves) { s.mesh.material.dispose(); s.mesh.removeFromParent(); }
    this._debris.length = 0;
    this._flashes.length = 0;
    this._shockwaves.length = 0;
  }

  protected override doEndPlay(): void {
    this._cleanupVFX();
    const world = this.getWorld();
    if (world) slomoManager.resetIfPriority(world, FIST_SLOMO_PRIORITY);
    super.doEndPlay();
  }
}
