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
const VFX_CHUNK_COUNT = 20;
const VFX_CHUNK_LIFETIME = 1.5;
const GRAVITY = 9.5;

const DUST_PUFF_COUNT = 12;
const DUST_LIFETIME = 1.2;

const FLASH_LIFETIME = 0.35;
const SHOCKWAVE_LIFETIME = 0.5;

// ─── Geometry ────────────────────────────────────────────────────────────────

const CHUNK_GEO = new THREE.BoxGeometry(1, 1, 1);
const FLASH_GEO = new THREE.SphereGeometry(1, 16, 12);
const SHOCKWAVE_GEO = new THREE.TorusGeometry(1, 0.035, 6, 32);
const PUFF_GEOMETRY = new THREE.PlaneGeometry(1.1, 1.1);

const DUST_TEXTURE_PATH = '@project/assets/textures/vfx/DustPuffSoft.png';

// ─── Types ────────────────────────────────────────────────────────────────────

type FistPhase = 'rising' | 'paused' | 'retracting' | 'finishing' | 'done';

interface Chunk {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
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

interface DustPuff {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: number;
  elapsed: number;
  maxScale: number;
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

  private readonly _chunks: Chunk[] = [];
  private readonly _flashes: ImpactFlash[] = [];
  private readonly _shockwaves: Shockwave[] = [];
  private readonly _dustPuffs: DustPuff[] = [];
  private _dustTexture: THREE.Texture | null = null;

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
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this._phase === 'done' || !this._sceneFistActor) return;

    this._phaseElapsed = (performance.now() - this._phaseStartMs) / 1000;

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

        const vfxFinished = this._chunks.length === 0 &&
          this._flashes.length === 0 &&
          this._shockwaves.length === 0 &&
          this._dustPuffs.length === 0;

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
      color: 0xffaa44,
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

  private async _spawnGroundBreakVFX(): Promise<void> {
    const world = this.getWorld();
    if (!world) return;

    const origin = new THREE.Vector3(
      this.rootComponent.position.x,
      this._groundY,
      this.rootComponent.position.z,
    );

    // Rock/earth chunks
    for (let i = 0; i < VFX_CHUNK_COUNT; i++) {
      const size = randomBetween(0.06, 0.26);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(
          randomBetween(0.06, 0.12),
          randomBetween(0.35, 0.65),
          randomBetween(0.22, 0.42),
        ),
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(CHUNK_GEO, mat);
      mesh.scale.set(
        size * randomBetween(0.7, 1.6),
        size * randomBetween(0.5, 1.1),
        size * randomBetween(0.7, 1.5),
      );
      mesh.position.copy(origin);
      world.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(3.5, 10);

      this._chunks.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          randomBetween(2.5, 7),
          Math.sin(angle) * speed,
        ),
        spin: new THREE.Vector3(
          randomBetween(-12, 12),
          randomBetween(-12, 12),
          randomBetween(-12, 12),
        ),
        elapsed: 0,
      });
    }

    // Load texture and spawn dust puffs
    if (!this._dustTexture) {
      try {
        const resolvedPath = await ENGINE.resolveAssetPathsInText(DUST_TEXTURE_PATH);
        this._dustTexture = await new Promise<THREE.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(
            resolvedPath,
            (texture) => {
              texture.wrapS = THREE.ClampToEdgeWrapping;
              texture.wrapT = THREE.ClampToEdgeWrapping;
              resolve(texture);
            },
            undefined,
            (err) => reject(err)
          );
        });
      } catch (e) {
        console.warn('[FistOfAnnoyanceActor] Failed to load dust texture:', e);
      }
    }

    // Spawn dust puffs
    for (let i = 0; i < DUST_PUFF_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(1.0, 3.0);

      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(randomBetween(0.08, 0.12), 0.5, 0.65), // tan/dust
        map: this._dustTexture || undefined,
        alphaMap: this._dustTexture || undefined,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        alphaTest: 0.01,
      });

      const mesh = new THREE.Mesh(PUFF_GEOMETRY, material);
      mesh.position.copy(origin);
      mesh.position.y += randomBetween(-0.05, 0.1);
      mesh.rotation.set(-Math.PI / 2, 0, randomBetween(0, Math.PI * 2));

      world.scene.add(mesh);

      this._dustPuffs.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          randomBetween(0.2, 0.6),
          Math.sin(angle) * speed
        ),
        spin: randomBetween(-1.5, 1.5),
        elapsed: randomBetween(0, 0.1),
        maxScale: randomBetween(1.2, 2.2),
      });
    }
  }

  private _updateVFX(deltaTime: number): void {
    // Update chunks
    for (let i = this._chunks.length - 1; i >= 0; i--) {
      const c = this._chunks[i];
      c.elapsed += deltaTime;
      c.velocity.y -= GRAVITY * deltaTime;
      c.mesh.position.addScaledVector(c.velocity, deltaTime);
      c.mesh.rotation.x += c.spin.x * deltaTime;
      c.mesh.rotation.y += c.spin.y * deltaTime;
      c.mesh.rotation.z += c.spin.z * deltaTime;
      c.mesh.material.opacity = Math.max(0, 1 - c.elapsed / VFX_CHUNK_LIFETIME);
      if (c.elapsed >= VFX_CHUNK_LIFETIME) {
        c.mesh.material.dispose();
        c.mesh.removeFromParent();
        this._chunks.splice(i, 1);
      }
    }

    // Update dust puffs
    for (let i = this._dustPuffs.length - 1; i >= 0; i--) {
      const puff = this._dustPuffs[i];
      puff.elapsed += deltaTime;

      const progress = Math.min(puff.elapsed / DUST_LIFETIME, 1);
      const scale = THREE.MathUtils.lerp(0.5, puff.maxScale, easeOutCubic(progress));
      puff.mesh.scale.setScalar(scale);

      puff.mesh.position.addScaledVector(puff.velocity, deltaTime);
      puff.velocity.multiplyScalar(0.97); // drag

      puff.mesh.rotation.z += puff.spin * deltaTime;
      puff.mesh.material.opacity = 0.75 * Math.max(0, 1 - progress);

      if (progress >= 1) {
        puff.mesh.material.dispose();
        puff.mesh.removeFromParent();
        this._dustPuffs.splice(i, 1);
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
    for (const c of this._chunks) { c.mesh.material.dispose(); c.mesh.removeFromParent(); }
    for (const p of this._dustPuffs) { p.mesh.material.dispose(); p.mesh.removeFromParent(); }
    for (const f of this._flashes) { f.mesh.material.dispose(); f.mesh.removeFromParent(); }
    for (const s of this._shockwaves) { s.mesh.material.dispose(); s.mesh.removeFromParent(); }
    this._chunks.length = 0;
    this._dustPuffs.length = 0;
    this._flashes.length = 0;
    this._shockwaves.length = 0;
    if (this._dustTexture) {
      this._dustTexture.dispose();
      this._dustTexture = null;
    }
  }

  protected override doEndPlay(): void {
    this._cleanupVFX();
    const world = this.getWorld();
    if (world) slomoManager.resetIfPriority(world, FIST_SLOMO_PRIORITY);
    super.doEndPlay();
  }
}
