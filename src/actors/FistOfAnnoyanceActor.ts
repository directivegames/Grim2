/**
 * FistOfAnnoyanceActor — Giant fist impact effect.
 *
 * Plays at normal speed — no slow-mo, no cinematic camera.
 * Slow-mo is exclusively controlled by kill streak.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { PostmanBossActor } from './PostmanBossActor.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { HitNumberUI } from '../ui/HitNumberUI.js';
import { loadSmokeTexture } from '../components/vfx/BillboardSmokePuffs.js';
import { acquireSceneFist, releaseSceneFist } from '../utils/scene-visual-pool.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIST_START_Y = -3.5;
const FIST_PEAK_Y = -0.1;

const RISE_DURATION = 0.26;
const PAUSE_DURATION = 0.01;
const RETRACT_DURATION = 0.20;

const FIST_HIT_RADIUS = 2.4;
const ONE_HIT_DAMAGE = 99999;
const VFX_CHUNK_COUNT = 26;
const VFX_CHUNK_LIFETIME = 1.65;
const GRAVITY = 9.5;

const FLASH_LIFETIME = 0.35;
const SHOCKWAVE_LIFETIME = 0.5;
const EXPLOSION_EMIT_DURATION = 1.0;

// ─── Geometry / assets ───────────────────────────────────────────────────────

const FLASH_GEO = new THREE.SphereGeometry(1, 16, 12);
const SHOCKWAVE_GEO = new THREE.TorusGeometry(1, 0.035, 6, 32);

const EXPLOSION_CLOUD_VFX = '@project/assets/VFX/explosion-cloud.vfx.json';
const ROCK_DEBRIS_TEXTURE_PATH = '@project/assets/VFX/rockdebris.webp';

// ─── Types ────────────────────────────────────────────────────────────────────

type FistPhase = 'rising' | 'paused' | 'retracting' | 'finishing' | 'done';

interface RockDebris {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  spinRate: number;
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

// ─── Module-level VFX pools (reuse across fist uses) ─────────────────────────

const DEBRIS_POOL_SIZE = 32;
const FLASH_POOL_SIZE = 2;
const SHOCK_POOL_SIZE = 2;

interface PooledDebrisSlot {
  sprite: THREE.Sprite;
  inUse: boolean;
}

interface PooledFlashSlot {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  inUse: boolean;
}

interface PooledShockSlot {
  mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  inUse: boolean;
}

const _debrisSlots: PooledDebrisSlot[] = [];
const _debrisFree: PooledDebrisSlot[] = [];
const _flashSlots: PooledFlashSlot[] = [];
const _flashFree: PooledFlashSlot[] = [];
const _shockSlots: PooledShockSlot[] = [];
const _shockFree: PooledShockSlot[] = [];
let _fistVfxPoolsBuilt = false;
let _fistVfxSceneAttached = false;

function _ensureFistVfxPools(world: ENGINE.World, debrisTexture: THREE.Texture | null): void {
  if (!_fistVfxPoolsBuilt) {
    for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({
        map: debrisTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: true,
        blending: THREE.NormalBlending,
        alphaTest: debrisTexture ? 0.08 : 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      const slot: PooledDebrisSlot = { sprite, inUse: false };
      _debrisSlots.push(slot);
      _debrisFree.push(slot);
    }

    for (let i = 0; i < FLASH_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffcc66,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(FLASH_GEO, mat);
      mesh.visible = false;
      const slot: PooledFlashSlot = { mesh, inUse: false };
      _flashSlots.push(slot);
      _flashFree.push(slot);
    }

    for (let i = 0; i < SHOCK_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5a8fc8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(SHOCKWAVE_GEO, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible = false;
      const slot: PooledShockSlot = { mesh, inUse: false };
      _shockSlots.push(slot);
      _shockFree.push(slot);
    }

    _fistVfxPoolsBuilt = true;
  }

  if (!_fistVfxSceneAttached) {
    for (const slot of _debrisSlots) world.scene.add(slot.sprite);
    for (const slot of _flashSlots) world.scene.add(slot.mesh);
    for (const slot of _shockSlots) world.scene.add(slot.mesh);
    _fistVfxSceneAttached = true;
  }

  if (debrisTexture) {
    for (const slot of _debrisSlots) {
      slot.sprite.material.map = debrisTexture;
      slot.sprite.material.alphaTest = 0.08;
      slot.sprite.material.color.setHex(0xffffff);
    }
  }
}

// ─── FistOfAnnoyanceActor ────────────────────────────────────────────────────

@ENGINE.GameClass()
export class FistOfAnnoyanceActor extends ENGINE.Actor {

  private _sceneFistActor: ENGINE.Actor | null = null;
  private _explosionVfx: ENGINE.VFXComponent | null = null;
  private _phase: FistPhase = 'rising';
  private _phaseElapsed = 0;
  private _groundY = 0;
  private _hasHit = false;
  private _vfxSpawned = false;
  private _explosionEmitTimer = -1;

  private readonly _rockDebris: RockDebris[] = [];
  private readonly _flashes: ImpactFlash[] = [];
  private readonly _shockwaves: Shockwave[] = [];
  private _rockDebrisTexture: THREE.Texture | null = null;

  private readonly _fistPosScratch = new THREE.Vector3();
  private readonly _zPosScratch = new THREE.Vector3();
  private readonly _hitNormalScratch = new THREE.Vector3();
  private readonly _hitLocationScratch = new THREE.Vector3();
  private readonly _originScratch = new THREE.Vector3();

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });

    this._explosionVfx = ENGINE.VFXComponent.create({
      vfxPath: EXPLOSION_CLOUD_VFX,
      autoStart: false,
    });
    this.rootComponent.add(this._explosionVfx);
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const world = this.getWorld();
    if (!world) return;

    this._sceneFistActor = acquireSceneFist(world);

    if (!this._sceneFistActor) {
      console.warn('[FistOfAnnoyanceActor] No free scene fist available (all in use or none placed).');
      this.destroy();
      return;
    }

    this._groundY = this.rootComponent.position.y;
    this._phase = 'rising';
    this._phaseElapsed = 0;
    this._hasHit = false;
    this._vfxSpawned = false;
    this._explosionEmitTimer = -1;
    this._setFistPosition(this._groundY + FIST_START_Y);

    void loadSmokeTexture(ROCK_DEBRIS_TEXTURE_PATH).then((rock) => {
      this._rockDebrisTexture = rock;
    });
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this._phase === 'done' || !this._sceneFistActor) return;

    this._phaseElapsed += deltaTime;
    this._tickExplosionEmit(deltaTime);

    switch (this._phase) {
      case 'rising': {
        const t = Math.min(this._phaseElapsed / RISE_DURATION, 1);
        const y = THREE.MathUtils.lerp(
          this._groundY + FIST_START_Y,
          this._groundY + FIST_PEAK_Y,
          easeOutQuart(t),
        );
        this._setFistPosition(y);

        if (!this._vfxSpawned && t >= 0.5) {
          void this._spawnGroundBreakVFX();
          this._spawnImpactFlash();
          this._spawnShockwave();
          this._triggerExplosionCloud();
          this._vfxSpawned = true;
          const player = this.getWorld()?.getFirstPlayerPawn();
          if (player instanceof IsometricPlayerPawn) {
            player.triggerScreenShake(0.35, 0.7);
          }
        }

        if (!this._hasHit) this._checkHits();

        if (t >= 1) { this._phase = 'paused'; this._phaseElapsed = 0; }
        break;
      }

      case 'paused': {
        if (this._phaseElapsed >= PAUSE_DURATION) {
          this._phase = 'retracting';
          this._phaseElapsed = 0;
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
        this._updateVFX(deltaTime);

        const vfxFinished = this._rockDebris.length === 0 &&
          this._flashes.length === 0 &&
          this._shockwaves.length === 0 &&
          this._explosionEmitTimer < 0;

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

    this._sceneFistActor.rootComponent.getWorldPosition(this._fistPosScratch);

    const nearby = zombieSpatialManager.getNearbyZombies(this._fistPosScratch, FIST_HIT_RADIUS);

    for (const zombie of nearby) {
      if (zombie instanceof PostmanBossActor) continue;
      if ((zombie as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

      zombie.rootComponent.getWorldPosition(this._zPosScratch);
      const dx = this._zPosScratch.x - this._fistPosScratch.x;
      const dz = this._zPosScratch.z - this._fistPosScratch.z;
      if (dx * dx + dz * dz > FIST_HIT_RADIUS * FIST_HIT_RADIUS) continue;

      this._hitNormalScratch.copy(this._zPosScratch).sub(this._fistPosScratch).setY(0);
      if (this._hitNormalScratch.lengthSq() < 1e-8) {
        this._hitNormalScratch.set(1, 0, 0);
      } else {
        this._hitNormalScratch.normalize();
      }
      this._hitLocationScratch.copy(this._zPosScratch);
      zombie.getComponent(ENGINE.CharacterStatsComponent)?.takeDamage(ONE_HIT_DAMAGE, {
        hitLocation: this._hitLocationScratch,
        hitNormal: this._hitNormalScratch,
      });

      this._showHitNumber(world, this._zPosScratch);
      (zombie as unknown as { flashYellow(): void }).flashYellow?.();
      GoreExplosionActor.spawnAt(world, this._zPosScratch);
      this._hasHit = true;
    }
  }

  private _showHitNumber(world: ENGINE.World, pos: THREE.Vector3): void {
    HitNumberUI.getInstance(world).showDamage(ONE_HIT_DAMAGE, pos);
  }

  private _triggerExplosionCloud(): void {
    if (!this._explosionVfx) return;
    this._explosionVfx.position.set(0, 0.12, 0);
    this._explosionVfx.startEmitting();
    this._explosionEmitTimer = EXPLOSION_EMIT_DURATION;
  }

  private _tickExplosionEmit(deltaTime: number): void {
    if (this._explosionEmitTimer < 0) return;
    this._explosionEmitTimer -= deltaTime;
    if (this._explosionEmitTimer <= 0) {
      this._explosionEmitTimer = -1;
      this._explosionVfx?.stopEmitting();
    }
  }

  private _spawnImpactFlash(): void {
    const world = this.getWorld();
    if (!world) return;

    _ensureFistVfxPools(world, this._rockDebrisTexture);
    const slot = _flashFree.pop();
    if (!slot) return;

    slot.inUse = true;
    this._originScratch.set(
      this.rootComponent.position.x,
      this._groundY,
      this.rootComponent.position.z,
    );

    slot.mesh.scale.setScalar(0.3);
    slot.mesh.position.copy(this._originScratch);
    slot.mesh.material.opacity = 0.8;
    slot.mesh.visible = true;
    this._flashes.push({ mesh: slot.mesh, elapsed: 0 });
  }

  private _spawnShockwave(): void {
    const world = this.getWorld();
    if (!world) return;

    _ensureFistVfxPools(world, this._rockDebrisTexture);
    const slot = _shockFree.pop();
    if (!slot) return;

    slot.inUse = true;
    this._originScratch.set(
      this.rootComponent.position.x,
      this._groundY + 0.04,
      this.rootComponent.position.z,
    );

    slot.mesh.scale.setScalar(0.2);
    slot.mesh.position.copy(this._originScratch);
    slot.mesh.material.opacity = 0.6;
    slot.mesh.visible = true;
    this._shockwaves.push({ mesh: slot.mesh, elapsed: 0 });
  }

  private async _ensureDebrisTexture(): Promise<void> {
    if (!this._rockDebrisTexture) {
      this._rockDebrisTexture = await loadSmokeTexture(ROCK_DEBRIS_TEXTURE_PATH);
    }
  }

  private async _spawnGroundBreakVFX(): Promise<void> {
    const world = this.getWorld();
    if (!world) return;

    this._originScratch.set(
      this.rootComponent.position.x,
      this._groundY,
      this.rootComponent.position.z,
    );

    await this._ensureDebrisTexture();
    _ensureFistVfxPools(world, this._rockDebrisTexture);

    for (let i = 0; i < VFX_CHUNK_COUNT; i++) {
      const slot = _debrisFree.pop();
      if (!slot) break;

      slot.inUse = true;
      const scale = randomBetween(0.55, 1.35) * randomBetween(0.85, 1.25);
      slot.sprite.scale.setScalar(scale);
      slot.sprite.position.copy(this._originScratch);
      slot.sprite.position.y += randomBetween(0, 0.15);
      slot.sprite.material.opacity = 1;
      slot.sprite.material.rotation = randomBetween(0, Math.PI * 2);
      slot.sprite.visible = true;

      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(5, 13);

      this._rockDebris.push({
        sprite: slot.sprite,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          randomBetween(4, 11),
          Math.sin(angle) * speed,
        ),
        spinRate: randomBetween(-12, 12),
        elapsed: 0,
      });
    }
  }

  private _updateVFX(deltaTime: number): void {
    let debrisWrite = 0;
    for (let i = 0; i < this._rockDebris.length; i++) {
      const c = this._rockDebris[i]!;
      c.elapsed += deltaTime;
      c.velocity.y -= GRAVITY * deltaTime;
      c.sprite.position.addScaledVector(c.velocity, deltaTime);
      c.sprite.material.rotation += c.spinRate * deltaTime;
      const progress = c.elapsed / VFX_CHUNK_LIFETIME;
      c.sprite.material.opacity = Math.max(0, 1 - Math.pow(progress, 2));
      if (c.elapsed >= VFX_CHUNK_LIFETIME) {
        c.sprite.visible = false;
        for (const slot of _debrisSlots) {
          if (slot.sprite === c.sprite) {
            slot.inUse = false;
            _debrisFree.push(slot);
            break;
          }
        }
      } else {
        this._rockDebris[debrisWrite++] = c;
      }
    }
    this._rockDebris.length = debrisWrite;

    let flashWrite = 0;
    for (let i = 0; i < this._flashes.length; i++) {
      const f = this._flashes[i]!;
      f.elapsed += deltaTime;
      const progress = Math.min(f.elapsed / FLASH_LIFETIME, 1);
      const scale = THREE.MathUtils.lerp(0.3, 2.5, easeOutCubic(progress));
      f.mesh.scale.setScalar(scale);
      f.mesh.material.opacity = 0.8 * Math.max(0, 1 - progress);
      if (progress >= 1) {
        f.mesh.visible = false;
        for (const slot of _flashSlots) {
          if (slot.mesh === f.mesh) {
            slot.inUse = false;
            _flashFree.push(slot);
            break;
          }
        }
      } else {
        this._flashes[flashWrite++] = f;
      }
    }
    this._flashes.length = flashWrite;

    let shockWrite = 0;
    for (let i = 0; i < this._shockwaves.length; i++) {
      const s = this._shockwaves[i]!;
      s.elapsed += deltaTime;
      const progress = Math.min(s.elapsed / SHOCKWAVE_LIFETIME, 1);
      const scale = THREE.MathUtils.lerp(0.2, 3.5, easeOutCubic(progress));
      s.mesh.scale.setScalar(scale);
      s.mesh.material.opacity = 0.6 * Math.max(0, 1 - progress);
      if (progress >= 1) {
        s.mesh.visible = false;
        for (const slot of _shockSlots) {
          if (slot.mesh === s.mesh) {
            slot.inUse = false;
            _shockFree.push(slot);
            break;
          }
        }
      } else {
        this._shockwaves[shockWrite++] = s;
      }
    }
    this._shockwaves.length = shockWrite;
  }

  private _cleanupVFX(): void {
    this._explosionEmitTimer = -1;
    this._explosionVfx?.stopEmitting();
    for (const c of this._rockDebris) {
      c.sprite.visible = false;
      for (const slot of _debrisSlots) {
        if (slot.sprite === c.sprite) {
          slot.inUse = false;
          _debrisFree.push(slot);
          break;
        }
      }
    }
    for (const f of this._flashes) {
      f.mesh.visible = false;
      for (const slot of _flashSlots) {
        if (slot.mesh === f.mesh) {
          slot.inUse = false;
          _flashFree.push(slot);
          break;
        }
      }
    }
    for (const s of this._shockwaves) {
      s.mesh.visible = false;
      for (const slot of _shockSlots) {
        if (slot.mesh === s.mesh) {
          slot.inUse = false;
          _shockFree.push(slot);
          break;
        }
      }
    }
    this._rockDebris.length = 0;
    this._flashes.length = 0;
    this._shockwaves.length = 0;
  }

  protected override doEndPlay(): void {
    releaseSceneFist(this._sceneFistActor);
    this._sceneFistActor = null;
    this._cleanupVFX();
    super.doEndPlay();
  }
}
