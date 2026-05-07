import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { requestHitStopSlomo, endHitStopSlomo, SLOMO_PRIORITY, slomoManager } from './KillStreakTracker.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIST_ACTOR_NAME = 'fistofannoyance';
const SLOMO_VALUE     = 0.30; // Slightly slower for more cinematic feel

/** Priority for fist slomo (higher than kill streak, lower than hit stop). */
const FIST_SLOMO_PRIORITY = 2;

/** Y offset below ground level where the fist starts (fully hidden). */
const FIST_START_Y = -3.5;

/** Y offset above ground level at the peak of the punch. */
const FIST_PEAK_Y = -0.1;

const RISE_DURATION     = 0.26;  // fast punch up
const PAUSE_DURATION    = 0.38;  // brief hold at top
const RETRACT_DURATION  = 0.20;  // very quick pull-back

const FIST_HIT_RADIUS   = 2.4;
const ONE_HIT_DAMAGE    = 99999;
const VFX_CHUNK_COUNT   = 20;
const VFX_DUST_COUNT    = 16;
const VFX_CHUNK_LIFETIME = 1.5;
const VFX_DUST_LIFETIME  = 1.3;
const GRAVITY           = 9.5;

// ─── VFX geometry (shared) ────────────────────────────────────────────────────

const CHUNK_GEO = new THREE.BoxGeometry(1, 1, 1);
const DUST_GEO  = new THREE.SphereGeometry(1, 8, 6);

// ─── Types ────────────────────────────────────────────────────────────────────

type FistPhase = 'rising' | 'paused' | 'retracting' | 'finishing' | 'done';

interface Chunk {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  elapsed: number;
}

interface Dust {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  maxScale: number;
  elapsed: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutQuart(t: number): number { return 1 - Math.pow(1 - t, 4); }
function easeInQuart(t: number): number  { return t * t * t * t; }
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

// ─── FistOfAnnoyanceActor ────────────────────────────────────────────────────

@ENGINE.GameClass()
export class FistOfAnnoyanceActor extends ENGINE.Actor {

  private _sceneFistActor: ENGINE.Actor | null = null;
  private _phase: FistPhase = 'rising';
  private _phaseElapsed  = 0;
  private _phaseStartMs  = 0;   // real-time stamp (performance.now) for current phase
  private _groundY       = 0;
  private _hasHit        = false;
  private _vfxSpawned    = false;
  private _cinematicReturned = false;

  private readonly _chunks: Chunk[] = [];
  private readonly _dust:   Dust[]  = [];

  // ── Initialize ──────────────────────────────────────────────────────────────

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const world = this.getWorld();
    if (!world) return;

    // Find editor-placed fist actor
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
    this._phase         = 'rising';
    this._phaseElapsed  = 0;
    this._phaseStartMs  = performance.now();
    this._hasHit        = false;
    this._vfxSpawned    = false;
    this._cinematicReturned = false;

    // Move fist to attack position (it stays "visible" at all times so the GPU
    // shader is always compiled – no stall on first use).
    this._setFistPosition(this._groundY + FIST_START_Y);

    // Cinematic: slow motion + camera pan to fist
    const player = world.getFirstPlayerPawn();
    if (player instanceof IsometricPlayerPawn) {
      player.startCinematicFocus(this.rootComponent.position.clone());
    }

    // Apply slomo with priority (will override kill streak but not hit stop)
    slomoManager.setSlomo(world, SLOMO_VALUE, FIST_SLOMO_PRIORITY);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this._phase === 'done' || !this._sceneFistActor) return;

    // Use real elapsed time (ms→s) so phases are immune to slomo scaling.
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

        // Spawn VFX when fist is halfway up (t >= 0.5) - guarantees they always play
        if (!this._vfxSpawned && t >= 0.5) {
          this._spawnGroundBreakVFX();
          this._vfxSpawned = true;
          // Heavy impact shake - stronger for more cinematic feel
          const world = this.getWorld();
          const player = world?.getFirstPlayerPawn();
          if (player && (player as unknown as { triggerScreenShake?: (a: number, d: number) => void }).triggerScreenShake) {
            (player as unknown as { triggerScreenShake(a: number, d: number): void }).triggerScreenShake(1.0, 1.5);
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

          // Camera starts returning to player as fist retracts
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
          // Transition to finishing phase to let VFX play out fully
          this._phase = 'finishing';
          this._phaseElapsed = 0;
          // Park the fist far underground (stays rendered so shader stays warm)
          this._setFistPosition(-1000);
          // Restore normal speed - VFX will continue at normal time
          const w = this.getWorld();
          if (w) slomoManager.resetIfPriority(w, FIST_SLOMO_PRIORITY);
        }
        break;
      }

      case 'finishing': {
        // Just update VFX - let them complete their natural lifetime
        // Camera returns to player during this phase
        const w = this.getWorld();
        if (w) {
          const p = w.getFirstPlayerPawn();
          if (p instanceof IsometricPlayerPawn && !this._cinematicReturned) {
            p.endCinematicFocus();
            this._cinematicReturned = true;
          }
        }

        // Wait until all VFX particles have expired
        if (this._chunks.length === 0 && this._dust.length === 0) {
          this._phase = 'done';
          this.destroy();
          return;
        }
        break;
      }
    }

    this._updateVFX(deltaTime);
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): FistOfAnnoyanceActor {
    const actor = FistOfAnnoyanceActor.create({ position: position.clone() });
    world.addActor(actor);
    return actor;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private _setFistPosition(y: number): void {
    if (!this._sceneFistActor) return;
    this._sceneFistActor.rootComponent.position.set(
      this.rootComponent.position.x,
      y,
      this.rootComponent.position.z,
    );
  }

  // ── Hit detection ────────────────────────────────────────────────────────────

  private _checkHits(): void {
    const world = this.getWorld();
    if (!world || !this._sceneFistActor) return;

    const fistPos = new THREE.Vector3();
    this._sceneFistActor.rootComponent.getWorldPosition(fistPos);

    const nearby = zombieSpatialManager.getNearbyZombies(fistPos, FIST_HIT_RADIUS);
    const zPos   = new THREE.Vector3();

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

      (zombie as unknown as { flashYellow(): void }).flashYellow?.();
      GoreExplosionActor.spawnAt(world, zPos);
      this._hasHit = true;
    }
  }

  // ── VFX ──────────────────────────────────────────────────────────────────────

  private _spawnGroundBreakVFX(): void {
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
      const mat  = new THREE.MeshBasicMaterial({
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

    // Dust/smoke puffs
    for (let i = 0; i < VFX_DUST_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(
          randomBetween(0.07, 0.13),
          randomBetween(0.2, 0.45),
          randomBetween(0.55, 0.78),
        ),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(DUST_GEO, mat);
      mesh.scale.setScalar(0.12);
      mesh.position.copy(origin);
      mesh.position.y += randomBetween(-0.15, 0.4);
      world.scene.add(mesh);

      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(0.8, 3.0);

      this._dust.push({
        mesh,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          randomBetween(0.4, 1.8),
          Math.sin(angle) * speed,
        ),
        maxScale: randomBetween(0.5, 1.6),
        elapsed: 0,
      });
    }
  }

  private _updateVFX(deltaTime: number): void {
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

    for (let i = this._dust.length - 1; i >= 0; i--) {
      const d = this._dust[i];
      d.elapsed += deltaTime;
      const progress = Math.min(d.elapsed / VFX_DUST_LIFETIME, 1);
      d.mesh.position.addScaledVector(d.velocity, deltaTime);
      d.mesh.scale.setScalar(THREE.MathUtils.lerp(0.12, d.maxScale, easeOutCubic(progress)));
      d.mesh.material.opacity = 0.6 * Math.max(0, 1 - progress);
      if (progress >= 1) {
        d.mesh.material.dispose();
        d.mesh.removeFromParent();
        this._dust.splice(i, 1);
      }
    }
  }

  private _cleanupVFX(): void {
    for (const c of this._chunks) { c.mesh.material.dispose(); c.mesh.removeFromParent(); }
    for (const d of this._dust)   { d.mesh.material.dispose(); d.mesh.removeFromParent(); }
    this._chunks.length = 0;
    this._dust.length   = 0;
  }

  protected override doEndPlay(): void {
    this._cleanupVFX();
    // Safety: restore slomo if we're the current priority
    const world = this.getWorld();
    if (world) slomoManager.resetIfPriority(world, FIST_SLOMO_PRIORITY);
    super.doEndPlay();
  }
}
