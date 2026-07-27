/**
 * ZombieHordeManager — Wave-based zombie spawning with smoke VFX.
 *
 * Design:
 *  - No pre-spawning — zombies are created lazily in waves
 *  - After 10 total kills, horde activates and first wave (10 zombies) spawns
 *  - Horde zombies spawn at EnemySpawnPointActor markers (closest pool to player) with smoke VFX
 *  - New wave on waveInterval after activation
 *  - Max 50 pooled zombies (desktop); pauses spawning until count drops to resume threshold
 *  - Far-off horde zombies relocate to a nearby orange spawn pad
 *  - Each death queues the SAME actor for reuse — no new actor allocations after
 *    the initial wave fill. This prevents zombie actor accumulation over long sessions.
 *  - Smoke VFX hides the respawn pop-in
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import {
  createDefaultHordeEnemyTypes,
  HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT,
  type HordeEnemyType,
} from '../horde/HordeEnemyRegistry.js';
import { NEW_ZOMBIE_MODEL_URL, NewZombieActor } from './NewZombieActor.js';
import { ZombieRiseVFXActor } from './ZombieRiseVFXActor.js';
import type { EnemySpawnPointActor } from './EnemySpawnPointActor.js';
import {
  getEnemySpawnPointCount,
  pickClosestEnemySpawnPoint,
  pickSpreadEnemySpawnPoint,
} from '../mission/enemy-spawn-points.js';
import { tryApplyHordeZombieSpawnPointWorldPosition } from '../mission/innocent-spawn-position.js';
import { revealActorWhenVisualReady } from '../horde/horde-spawn-utils.js';
import { BigUndeadActor } from './BigUndeadActor.js';
import { DemonboxActor } from './DemonboxActor.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { destroyActorWhenGltfIdle } from '../utils/safe-actor-destroy.js';
import type { RiskLevel } from '../data/risk-levels.js';
import { isIosDevice, isMobileDevice } from '../utils/mobile-device.js';

// Configuration
const MAX_ACTIVE_ZOMBIES = 50;
const RESUME_SPAWN_THRESHOLD = 50;
const MOBILE_MAX_ACTIVE_ZOMBIES = 30;
const MOBILE_RESUME_SPAWN_THRESHOLD = 22;
const MOBILE_WAVE_SIZE = 8;
const MOBILE_IDLE_POOL_LIMIT = 10;

// iOS (real-device WebKit) survival budget. Real iPhones hit Safari's memory /
// watchdog limit far sooner than Android, so iOS runs a tighter horde: fewer
// concurrent skinned-mesh zombies, smaller waves, and a slower cadence to spread
// spawn cost across more frames. These apply ONLY when isIosDevice() is true —
// Android keeps the MOBILE_* values above, desktop keeps the unprefixed values.
const IOS_MAX_ACTIVE_ZOMBIES = 14;
const IOS_RESUME_SPAWN_THRESHOLD = 9;
const IOS_WAVE_SIZE = 4;
const IOS_WAVE_INTERVAL_SEC = 12;
/** Slower aggressive-spawn floor on iOS (Android/desktop aggressive stays at 4s). */
const IOS_AGGRESSIVE_WAVE_INTERVAL_SEC = 8;
const KILLS_TO_ACTIVATE_HORDE = 10;
const MAX_TOTAL_KILLS = 500;

// Wave settings
const WAVE_SIZE = 15;
const WAVE_INTERVAL_SEC = 8;
const RESPAWN_DELAY_SEC = 5;
const RESPAWN_RETRY_SEC = 2;

// Relocate horde zombies that fall far behind the player
const RELOCATE_MIN_DISTANCE_XZ = 30;
const RELOCATE_INTERVAL_SEC = 2.5;
const RELOCATE_COOLDOWN_SEC = 10;
const RELOCATE_MIN_DISTANCE_SQ = RELOCATE_MIN_DISTANCE_XZ * RELOCATE_MIN_DISTANCE_XZ;

const MAX_MARKER_SPAWN_TRIES = 8;
const SPAWN_FAIL_LOG_INTERVAL_SEC = 5;

interface ActiveZombie {
  actor: NewZombieActor;
  onDiedCallback: () => void;
}

/**
 * Respawn queue entry — tracks the exact actor to reuse so no new actor
 * is ever allocated on respawn. delayRemaining ≤ 0 means ready.
 */
interface RespawnQueueEntry {
  delayRemaining: number;
  zombie: NewZombieActor;
}

@ENGINE.GameClass()
export class ZombieHordeManager extends ENGINE.Actor {
  private _activeZombies = new Map<NewZombieActor, ActiveZombie>();
  private _respawnQueue: RespawnQueueEntry[] = [];
  private _pendingWaveSpawns: { delayRemaining: number }[] = [];

  private _totalKills = 0;
  private _hordeActive = false;
  private _waveTimer = 0;
  private _placedZombiesCount = 0;
  private _spawningPaused = false;
  private _needsHookPlaced = true;
  private _riskHealthMult = 1;
  private _riskDamageMult = 1;
  private _riskEliteSpawnWeightBonus = 0;
  private _missionRiskLevel: RiskLevel = 1;
  private _maxActiveZombies = MAX_ACTIVE_ZOMBIES;
  private _resumeSpawnThreshold = RESUME_SPAWN_THRESHOLD;
  private _waveIntervalSec = WAVE_INTERVAL_SEC;
  private _mobileMemoryMode = false;
  /** iOS-only tighter budget. Strict subset of _mobileMemoryMode (never set on Android). */
  private _iosMemoryMode = false;

  /** Placed-zombie references — cleared in doEndPlay to avoid dangling callbacks. */
  private _placedZombies: NewZombieActor[] = [];

  /** Elite / alternate enemy types (Big Undead, etc.) — see HordeEnemyRegistry. */
  private readonly _hordeEnemyTypes: HordeEnemyType[] = createDefaultHordeEnemyTypes();
  private readonly _activeEliteActors = new Map<string, Set<ENGINE.Actor>>();

  // Scratch vectors
  private readonly _playerPos = new THREE.Vector3();
  private readonly _spawnPos = new THREE.Vector3();
  private readonly _zombiePos = new THREE.Vector3();

  private _relocateTimer = 0;
  private _spawnFailLogTimer = 0;
  private readonly _relocateCooldowns = new Map<NewZombieActor, number>();
  private readonly _eliteRelocateCooldowns = new Map<ENGINE.Actor, number>();
  private readonly _relocateUsedMarkers = new Set<EnemySpawnPointActor>();

  /** Hidden pooled zombies kept between missions — reused before allocating new actors. */
  private readonly _idlePool = new Set<NewZombieActor>();
  private readonly _idleElitePools = new Map<string, ENGINE.Actor[]>();

  @ENGINE.property({ type: 'number', min: 1, max: 50, step: 1, category: 'Horde' })
  public killsToActivate: number = KILLS_TO_ACTIVATE_HORDE;

  @ENGINE.property({ type: 'number', min: 5, max: 60, step: 1, category: 'Horde' })
  public waveInterval: number = WAVE_INTERVAL_SEC;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    this._needsHookPlaced = true;
    this._mobileMemoryMode = isMobileDevice();
    this._iosMemoryMode = isIosDevice();
    if (this._mobileMemoryMode) {
      this._maxActiveZombies = MOBILE_MAX_ACTIVE_ZOMBIES;
      this._resumeSpawnThreshold = MOBILE_RESUME_SPAWN_THRESHOLD;
    }
    // iOS-only: tighten further than Android. Applied after the mobile block so
    // Android (iosMemoryMode === false) keeps the MOBILE_* values untouched.
    if (this._iosMemoryMode) {
      this._maxActiveZombies = IOS_MAX_ACTIVE_ZOMBIES;
      this._resumeSpawnThreshold = IOS_RESUME_SPAWN_THRESHOLD;
      this.waveInterval = IOS_WAVE_INTERVAL_SEC;
      this._waveIntervalSec = IOS_WAVE_INTERVAL_SEC;
    }

    for (const type of this._hordeEnemyTypes) {
      this._activeEliteActors.set(type.id, new Set());
    }

    if (this._mobileMemoryMode) {
      return;
    }

    // Warm GLB caches so first reveals are not blocked on async load.
    void ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(NEW_ZOMBIE_MODEL_URL));
    void ENGINE.resourceManager.loadModel(
      ENGINE.AssetPath.fromString('@project/assets/models/Vomitball.glb'),
    );
    void ENGINE.resourceManager.loadModel(
      ENGINE.AssetPath.fromString('@project/assets/models/demonletter.glb'),
    );
    for (const type of this._hordeEnemyTypes) {
      if (type.modelUrl) {
        void ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(type.modelUrl));
      }
    }
  }

  private hookPlacedZombies(): void {
    const world = this.getWorld();
    if (!world) return;

    const placedZombies = world.getActors().filter(
      (a): a is NewZombieActor => a instanceof NewZombieActor && !a.isPooled
    );

    this._placedZombiesCount = placedZombies.length;
    this._placedZombies = placedZombies;

    for (const zombie of placedZombies) {
      zombie.onDied = () => this.onPlacedZombieDied();
    }
  }

  private onPlacedZombieDied(): void {
    this._totalKills++;

    if (!this._hordeActive && this._totalKills >= this.killsToActivate) {
      this.activateHorde();
    }

    this.checkVictoryCondition();
  }

  /**
   * Called when a pooled zombie dies.
   * The zombie is NOT destroyed — it is hidden and queued for reuse.
   */
  private onPoolZombieDied(zombie: NewZombieActor): void {
    this._totalKills++;

    const entry = this._activeZombies.get(zombie);
    if (entry) {
      zombie.onDied = null;
      this._activeZombies.delete(zombie);
    }

    if (this._spawningPaused && this._activeZombies.size <= this._resumeSpawnThreshold) {
      this._spawningPaused = false;
      this._waveTimer = 0;
    }

    // Queue the same actor for reuse — no new actor ever allocated here
    this._respawnQueue.push({ delayRemaining: RESPAWN_DELAY_SEC, zombie });

    this.checkVictoryCondition();
  }

  private activateHorde(): void {
    this._hordeActive = true;
    console.log(`[ZombieHordeManager] HORDE ACTIVATED! Total kills: ${this._totalKills}`);
    this.spawnWave();
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (this._needsHookPlaced) {
      this._needsHookPlaced = false;
      this.hookPlacedZombies();
    }

    if (!isGameplayUnlocked()) {
      return;
    }

    // Mobile boots a minimal empty scene with no editor-placed zombies, so the
    // normal "kill N placed zombies to activate" gate can never be met. With no
    // placed zombies to gate on, self-activate so the wave system runs. Desktop
    // always has placed zombies (_placedZombiesCount > 0) so this never fires there.
    if (this._mobileMemoryMode && !this._hordeActive && this._placedZombiesCount === 0) {
      this.activateHorde();
    }

    this._processPendingWaveSpawns(deltaTime);

    if (!this._hordeActive) return;
    if (this._totalKills >= MAX_TOTAL_KILLS) return;

    this.processRespawnQueue(deltaTime);
    this._tickRelocateCooldowns(deltaTime);
    this._relocateTimer += deltaTime;
    if (this._relocateTimer >= RELOCATE_INTERVAL_SEC) {
      this._relocateTimer = 0;
      this._relocateFarHordeEnemies();
    }

    this._waveTimer += deltaTime;
    if (this._waveTimer >= this.waveInterval) {
      this._waveTimer = 0;
      this.spawnWave();
    }
  }

  private processRespawnQueue(deltaTime: number): void {
    for (const entry of this._respawnQueue) {
      entry.delayRemaining -= deltaTime;
    }

    let writeIdx = 0;
    for (let i = 0; i < this._respawnQueue.length; i++) {
      const entry = this._respawnQueue[i]!;
      if (entry.delayRemaining > 0 || this._activeZombies.size >= this._maxActiveZombies) {
        // Not ready, or at capacity — keep in queue
        this._respawnQueue[writeIdx++] = entry;
      } else {
        // Ready and have capacity — reuse this actor at a new spawn position
        if (!this.respawnZombie(entry.zombie)) {
          entry.delayRemaining = RESPAWN_RETRY_SEC;
          this._respawnQueue[writeIdx++] = entry;
        }
      }
    }
    this._respawnQueue.length = writeIdx;
  }

  /**
   * Reuse an existing (hidden) zombie at a fresh spawn position.
   * Never allocates a new actor.
   */
  private respawnZombie(zombie: NewZombieActor): boolean {
    if (this._activeZombies.size >= this._maxActiveZombies) return false;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return false;

    player.rootComponent.getWorldPosition(this._playerPos);
    const spawnPos = this.getSpawnPosition(this._playerPos, 'respawn');
    if (!spawnPos) {
      return false;
    }

    // Re-wire death callback
    const onDied = () => this.onPoolZombieDied(zombie);
    zombie.onDied = onDied;
    this._activeZombies.set(zombie, { actor: zombie, onDiedCallback: onDied });

    this._applyRiskToZombie(zombie);
    this.revealZombieWhenVisualReady(world, zombie, spawnPos);
    return true;
  }

  /**
   * Reveal a zombie only once its GLTF visual is renderable.
   * VFX plays only after softReset confirms the enemy is visible in-world.
   */
  private revealZombieWhenVisualReady(
    world: ENGINE.World,
    zombie: NewZombieActor,
    spawnPos: THREE.Vector3
  ): void {
    revealActorWhenVisualReady({
      actor: zombie,
      onReady: () => {
        if (!zombie.getWorld()) {
          return;
        }
        zombie.softReset(spawnPos);
        if (zombie.isHiddenInGame()) {
          zombie.onDied = null;
          this._activeZombies.delete(zombie);
          zombie.setHiddenInGame(true);
          this._respawnQueue.push({ delayRemaining: RESPAWN_RETRY_SEC, zombie });
          return;
        }
        zombie.beginVisibilityReassert();
        ZombieRiseVFXActor.spawnAt(world, spawnPos);
      },
      onFailed: () => {
        zombie.onDied = null;
        this._activeZombies.delete(zombie);
        zombie.setHiddenInGame(true);
        this._respawnQueue.push({ delayRemaining: RESPAWN_RETRY_SEC, zombie });
      },
    });
  }

  private spawnWave(): void {
    if (this._activeZombies.size >= this._maxActiveZombies) {
      if (!this._spawningPaused) {
        this._spawningPaused = true;
      }
      return;
    }

    const toSpawn = Math.min(this._getWaveSize(), this._maxActiveZombies - this._activeZombies.size);
    if (toSpawn <= 0) return;

    for (let i = 0; i < toSpawn; i++) {
      this.spawnSingleZombieWithDelay(i * 0.15);
    }
  }

  private spawnSingleZombieWithDelay(delaySec: number = 0): void {
    if (delaySec > 0) {
      this._pendingWaveSpawns.push({ delayRemaining: delaySec });
    } else {
      this.spawnHordeEnemySlot();
    }
  }

  /**
   * Fills one horde spawn slot — either an elite from the registry (weighted)
   * or a normal pooled zombie.
   */
  private spawnHordeEnemySlot(): void {
    const eliteType = this._pickEliteTypeForSpawn();
    if (eliteType) {
      this._spawnEliteEnemy(eliteType);
      return;
    }
    this.spawnSingleZombie();
  }

  private _pickEliteTypeForSpawn(): HordeEnemyType | null {
    const eligible = this._hordeEnemyTypes.filter(type => {
      if (type.minRiskLevel > this._missionRiskLevel) return false;
      if (this._totalKills < type.killsToUnlock) return false;
      const active = this._activeEliteActors.get(type.id);
      return (active?.size ?? 0) < type.maxActive;
    });
    if (eligible.length === 0) return null;

    let totalWeight = HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT;
    for (const type of eligible) {
      totalWeight += type.spawnWeight + this._riskEliteSpawnWeightBonus;
    }

    let roll = Math.random() * totalWeight;
    if (roll < HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT) {
      return null;
    }
    roll -= HORDE_NORMAL_ZOMBIE_SPAWN_WEIGHT;

    for (const type of eligible) {
      const weight = type.spawnWeight + this._riskEliteSpawnWeightBonus;
      if (roll < weight) {
        return type;
      }
      roll -= weight;
    }

    return null;
  }

  private _spawnEliteEnemy(type: HordeEnemyType): void {
    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return;

    player.rootComponent.getWorldPosition(this._playerPos);
    const spawnPos = this.getSpawnPosition(this._playerPos, 'elite');
    if (!spawnPos) {
      return;
    }

    const idleElite = this._takeIdleElite(type.id);
    if (idleElite) {
      const actor = idleElite;
      const onDied = () => this._onEliteEnemyDied(type, actor);
      actor.setHiddenInGame(true);
      type.hookDeath(actor, onDied);
      const activeSet = this._activeEliteActors.get(type.id);
      activeSet?.add(actor);
      this._revealActorWhenVisualReady(world, actor, spawnPos, type);
      return;
    }

    const actor = type.create(world, spawnPos);
    actor.setHiddenInGame(true);
    const onDied = () => this._onEliteEnemyDied(type, actor);
    type.hookDeath(actor, onDied);

    const activeSet = this._activeEliteActors.get(type.id);
    activeSet?.add(actor);

    this._revealActorWhenVisualReady(world, actor, spawnPos, type);
  }

  private _takeIdleElite(typeId: string): ENGINE.Actor | null {
    const pool = this._idleElitePools.get(typeId);
    if (!pool || pool.length === 0) {
      return null;
    }
    const actor = pool.pop()!;
    if (!actor.getWorld()) {
      return null;
    }
    return actor;
  }

  private _returnEliteToIdlePool(type: HordeEnemyType, actor: ENGINE.Actor): void {
    if (!(actor instanceof BigUndeadActor) && !(actor instanceof DemonboxActor)) {
      destroyActorWhenGltfIdle(actor);
      return;
    }
    type.clearDeathHook(actor);
    zombieSpatialManager.unregisterZombie(actor);

    if (this._mobileMemoryMode) {
      destroyActorWhenGltfIdle(actor);
      return;
    }

    actor.setHiddenInGame(true);
    actor.rootComponent.position.set(0, -1000, 0);
    let pool = this._idleElitePools.get(type.id);
    if (!pool) {
      pool = [];
      this._idleElitePools.set(type.id, pool);
    }
    pool.push(actor);
  }

  private _onEliteEnemyDied(type: HordeEnemyType, actor: ENGINE.Actor): void {
    type.clearDeathHook(actor);
    this._activeEliteActors.get(type.id)?.delete(actor);

    this._totalKills++;

    if (!this._hordeActive && this._totalKills >= this.killsToActivate) {
      this.activateHorde();
    }

    this.checkVictoryCondition();
  }

  private _revealActorWhenVisualReady(
    world: ENGINE.World,
    actor: ENGINE.Actor,
    spawnPos: THREE.Vector3,
    type: HordeEnemyType,
  ): void {
    revealActorWhenVisualReady({
      actor,
      onReady: () => {
        if (!actor.getWorld()) {
          return;
        }
        actor.rootComponent.position.copy(spawnPos);
        actor.rootComponent.updateMatrixWorld();
        actor.setHiddenInGame(false);
        if (actor instanceof BigUndeadActor) {
          actor.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
          actor.wakeForHordeSpawn();
        }
        if (actor instanceof DemonboxActor) {
          actor.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
          actor.wakeForHordeSpawn();
        }
        if (actor.isHiddenInGame()) {
          type.clearDeathHook(actor);
          this._activeEliteActors.get(type.id)?.delete(actor);
          actor.setHiddenInGame(true);
          destroyActorWhenGltfIdle(actor);
          return;
        }
        ZombieRiseVFXActor.spawnAt(world, spawnPos);
      },
      onFailed: () => {
        type.clearDeathHook(actor);
        this._activeEliteActors.get(type.id)?.delete(actor);
        actor.setHiddenInGame(true);
        destroyActorWhenGltfIdle(actor);
      },
    });
  }

  private _processPendingWaveSpawns(deltaTime: number): void {
    if (this._pendingWaveSpawns.length === 0) return;

    let writeIdx = 0;
    for (let i = 0; i < this._pendingWaveSpawns.length; i++) {
      const entry = this._pendingWaveSpawns[i]!;
      entry.delayRemaining -= deltaTime;
      if (entry.delayRemaining > 0) {
        this._pendingWaveSpawns[writeIdx++] = entry;
      } else {
        this.spawnHordeEnemySlot();
      }
    }
    this._pendingWaveSpawns.length = writeIdx;
  }

  /**
   * Fill one horde slot from the idle pool or allocate once when the pool is empty.
   */
  private spawnSingleZombie(): NewZombieActor | null {
    if (this._activeZombies.size >= this._maxActiveZombies) return null;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return null;

    player.rootComponent.getWorldPosition(this._playerPos);
    const spawnPos = this.getSpawnPosition(this._playerPos, 'spawn');
    if (!spawnPos) {
      return null;
    }

    const idle = this._takeIdlePooledZombie();
    if (idle) {
      const onDied = () => this.onPoolZombieDied(idle);
      idle.onDied = onDied;
      this._activeZombies.set(idle, { actor: idle, onDiedCallback: onDied });
      this._applyRiskToZombie(idle);
      this.revealZombieWhenVisualReady(world, idle, spawnPos);
      return idle;
    }

    const zombie = NewZombieActor.create({ position: spawnPos });
    zombie.isPooled = true;
    zombie.rootComponent.scale.set(1.224317, 1.157981, 1.410963);
    this._applyRiskToZombie(zombie);

    const onDied = () => this.onPoolZombieDied(zombie);
    zombie.onDied = onDied;
    zombie.setHiddenInGame(true);

    world.addActor(zombie);
    this._activeZombies.set(zombie, { actor: zombie, onDiedCallback: onDied });

    this.revealZombieWhenVisualReady(world, zombie, spawnPos);

    return zombie;
  }

  private _takeIdlePooledZombie(): NewZombieActor | null {
    for (const zombie of this._idlePool) {
      this._idlePool.delete(zombie);
      if (zombie.getWorld()) {
        return zombie;
      }
    }
    return null;
  }

  private _returnZombieToIdlePool(zombie: NewZombieActor): void {
    if (!zombie.isPooled) {
      return;
    }
    zombie.onDied = null;

    if (this._mobileMemoryMode && this._idlePool.size >= MOBILE_IDLE_POOL_LIMIT) {
      destroyActorWhenGltfIdle(zombie);
      return;
    }

    zombie.parkForHordeReset();
    this._idlePool.add(zombie);
  }

  /** Register any hidden pooled zombies left in the world after mission cleanup. */
  public absorbParkedPooledZombies(): void {
    const world = this.getWorld();
    if (!world) return;

    for (const actor of world.getActors()) {
      if (actor instanceof NewZombieActor && actor.isPooled && actor.isHiddenInGame()) {
        actor.onDied = null;
        if (this._mobileMemoryMode && this._idlePool.size >= MOBILE_IDLE_POOL_LIMIT) {
          destroyActorWhenGltfIdle(actor);
          continue;
        }
        this._idlePool.add(actor);
      }
    }
  }

  /** Horde spawns only from scene-placed EnemySpawnPointActor markers (nav-validated). */
  private getSpawnPosition(
    playerPos: THREE.Vector3,
    reason: 'spawn' | 'respawn' | 'relocate' | 'elite',
    excludeMarkers?: Set<EnemySpawnPointActor>,
  ): THREE.Vector3 | null {
    const world = this.getWorld();
    if (!world) {
      return null;
    }

    const markerCount = getEnemySpawnPointCount();
    if (markerCount === 0) {
      this._logSpawnFailure(
        'no EnemySpawnPointActor registered (place orange spawn markers in the scene)',
        reason,
      );
      return null;
    }

    const nav = world.gameLoop?.navigationServer ?? null;
    const triedMarkers = excludeMarkers ?? new Set<EnemySpawnPointActor>();
    const maxMarkerTries = Math.min(MAX_MARKER_SPAWN_TRIES, markerCount);
    const useSpread = reason === 'relocate';

    for (let i = 0; i < maxMarkerTries; i++) {
      const marker = useSpread
        ? pickSpreadEnemySpawnPoint(playerPos, this._spawnPos, triedMarkers)
        : pickClosestEnemySpawnPoint(playerPos, this._spawnPos, triedMarkers);
      if (!marker) {
        break;
      }
      triedMarkers.add(marker);
      if (
        tryApplyHordeZombieSpawnPointWorldPosition(nav, this._spawnPos, playerPos, this._spawnPos)
      ) {
        return this._spawnPos.clone();
      }
    }

    this._logSpawnFailure(
      `no valid nav spawn on ${markerCount} marker(s) — check marker placement / nav mesh`,
      reason,
    );
    return null;
  }

  private _logSpawnFailure(message: string, reason: string): void {
    const world = this.getWorld();
    const now = world?.getGameTime() ?? 0;
    if (
      this._spawnFailLogTimer > 0 &&
      now - this._spawnFailLogTimer < SPAWN_FAIL_LOG_INTERVAL_SEC
    ) {
      return;
    }
    this._spawnFailLogTimer = now;
    console.warn(`[ZombieHordeManager] Horde ${reason} failed — ${message}`);
  }

  private _tickRelocateCooldowns(deltaTime: number): void {
    for (const [zombie, remaining] of this._relocateCooldowns) {
      const next = remaining - deltaTime;
      if (next <= 0) {
        this._relocateCooldowns.delete(zombie);
      } else {
        this._relocateCooldowns.set(zombie, next);
      }
    }
    for (const [actor, remaining] of this._eliteRelocateCooldowns) {
      const next = remaining - deltaTime;
      if (next <= 0) {
        this._eliteRelocateCooldowns.delete(actor);
      } else {
        this._eliteRelocateCooldowns.set(actor, next);
      }
    }
  }

  /** Pull far-behind horde enemies to a spawn pad near the player. */
  private _relocateFarHordeEnemies(): void {
    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return;

    player.rootComponent.getWorldPosition(this._playerPos);
    this._relocateUsedMarkers.clear();

    for (const { actor: zombie } of this._activeZombies.values()) {
      if (zombie.isHiddenInGame() || this._relocateCooldowns.has(zombie)) {
        continue;
      }

      zombie.rootComponent.getWorldPosition(this._zombiePos);
      if (this._horizontalDistSq(this._zombiePos, this._playerPos) < RELOCATE_MIN_DISTANCE_SQ) {
        continue;
      }

      const spawnPos = this.getSpawnPosition(this._playerPos, 'relocate', this._relocateUsedMarkers);
      if (!spawnPos) {
        continue;
      }

      zombie.softReset(spawnPos);
      zombie.beginVisibilityReassert();
      ZombieRiseVFXActor.spawnAt(world, spawnPos);
      this._relocateCooldowns.set(zombie, RELOCATE_COOLDOWN_SEC);
    }

    for (const type of this._hordeEnemyTypes) {
      const active = this._activeEliteActors.get(type.id);
      if (!active) continue;

      for (const actor of active) {
        if (actor.isHiddenInGame() || this._eliteRelocateCooldowns.has(actor)) {
          continue;
        }

        actor.rootComponent.getWorldPosition(this._zombiePos);
        if (this._horizontalDistSq(this._zombiePos, this._playerPos) < RELOCATE_MIN_DISTANCE_SQ) {
          continue;
        }

        const spawnPos = this.getSpawnPosition(this._playerPos, 'relocate', this._relocateUsedMarkers);
        if (!spawnPos) {
          continue;
        }

        actor.rootComponent.position.copy(spawnPos);
        actor.rootComponent.updateMatrixWorld();
        if (actor instanceof BigUndeadActor) {
          actor.wakeForHordeSpawn();
        }
        if (actor instanceof DemonboxActor) {
          actor.wakeForHordeSpawn();
        }
        ZombieRiseVFXActor.spawnAt(world, spawnPos);
        this._eliteRelocateCooldowns.set(actor, RELOCATE_COOLDOWN_SEC);
      }
    }
  }

  private _horizontalDistSq(a: THREE.Vector3, b: THREE.Vector3): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  }

  private checkVictoryCondition(): void {
    if (this._totalKills >= MAX_TOTAL_KILLS) {
      console.log(`[ZombieHordeManager] VICTORY! ${this._totalKills} zombies killed!`);
    }
  }

  /** Scale horde zombies for the active mission risk level. */
  public applyMissionRisk(
    healthMult: number,
    damageMult: number,
    eliteSpawnWeightBonus: number,
    riskLevel: RiskLevel = 1,
    options?: { spawnCap?: number; aggressiveSpawn?: boolean; waveIntervalMult?: number },
  ): void {
    this._riskHealthMult = healthMult;
    this._riskDamageMult = damageMult;
    this._riskEliteSpawnWeightBonus = eliteSpawnWeightBonus;
    this._missionRiskLevel = riskLevel;

    if (options?.spawnCap !== undefined) {
      if (this._iosMemoryMode) {
        // iOS-only: cap at the iOS ceiling and use a resume floor below that
        // ceiling (the Android/desktop Math.max(20, …) below would exceed it).
        this._maxActiveZombies = Math.min(options.spawnCap, IOS_MAX_ACTIVE_ZOMBIES);
        this._resumeSpawnThreshold = Math.max(6, Math.floor(this._maxActiveZombies * 0.7));
      } else {
        this._maxActiveZombies = this._mobileMemoryMode
          ? Math.min(options.spawnCap, MOBILE_MAX_ACTIVE_ZOMBIES)
          : options.spawnCap;
        this._resumeSpawnThreshold = Math.max(20, Math.floor(this._maxActiveZombies * 0.77));
      }
    } else {
      this._maxActiveZombies = this._getDefaultMaxActiveZombies();
      this._resumeSpawnThreshold = this._getDefaultResumeSpawnThreshold();
    }

    const aggressiveInterval = this._iosMemoryMode ? IOS_AGGRESSIVE_WAVE_INTERVAL_SEC : 4;
    const baseInterval = options?.aggressiveSpawn ? aggressiveInterval : this._getDefaultWaveInterval();
    const mult = options?.waveIntervalMult ?? 1;
    this.waveInterval = Math.max(2, baseInterval * mult);
    this._waveIntervalSec = this.waveInterval;

    this._applyRiskToAllZombies();
  }

  public clearMissionRisk(): void {
    this._riskHealthMult = 1;
    this._riskDamageMult = 1;
    this._riskEliteSpawnWeightBonus = 0;
    this._missionRiskLevel = 1;
    this._maxActiveZombies = this._getDefaultMaxActiveZombies();
    this._resumeSpawnThreshold = this._getDefaultResumeSpawnThreshold();
    this.waveInterval = this._getDefaultWaveInterval();
    this._waveIntervalSec = this._getDefaultWaveInterval();
    this._applyRiskToAllZombies();
  }

  private _applyRiskToAllZombies(): void {
    for (const { actor } of this._activeZombies.values()) {
      this._applyRiskToZombie(actor);
    }
    for (const zombie of this._placedZombies) {
      this._applyRiskToZombie(zombie);
    }
    for (const type of this._hordeEnemyTypes) {
      const active = this._activeEliteActors.get(type.id);
      if (!active) continue;
      for (const actor of active) {
        if (actor instanceof BigUndeadActor) {
          actor.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
        }
        if (actor instanceof DemonboxActor) {
          actor.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
        }
      }
    }
  }

  private _applyRiskToZombie(zombie: NewZombieActor): void {
    zombie.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
  }

  private _getWaveSize(): number {
    if (this._iosMemoryMode) return IOS_WAVE_SIZE;
    return this._mobileMemoryMode ? MOBILE_WAVE_SIZE : WAVE_SIZE;
  }

  private _getDefaultMaxActiveZombies(): number {
    if (this._iosMemoryMode) return IOS_MAX_ACTIVE_ZOMBIES;
    if (this._mobileMemoryMode) return MOBILE_MAX_ACTIVE_ZOMBIES;
    return MAX_ACTIVE_ZOMBIES;
  }

  /**
   * Desktop graphics-quality hook — clamps the active spawn cap without
   * overriding mobile/iOS memory modes.
   */
  public applyGraphicsHordeCap(desktopCap: number): void {
    if (this._iosMemoryMode || this._mobileMemoryMode) {
      return;
    }
    const next = Math.max(20, Math.min(MAX_ACTIVE_ZOMBIES, Math.floor(desktopCap)));
    this._maxActiveZombies = next;
    this._resumeSpawnThreshold = Math.max(12, Math.floor(next * 0.7));
  }

  private _getDefaultResumeSpawnThreshold(): number {
    if (this._iosMemoryMode) return IOS_RESUME_SPAWN_THRESHOLD;
    return this._mobileMemoryMode ? MOBILE_RESUME_SPAWN_THRESHOLD : RESUME_SPAWN_THRESHOLD;
  }

  /** Default wave interval for this device class (iOS slower, Android/desktop unchanged). */
  private _getDefaultWaveInterval(): number {
    return this._iosMemoryMode ? IOS_WAVE_INTERVAL_SEC : WAVE_INTERVAL_SEC;
  }

  public getStats(): {
    totalKills: number;
    hordeActive: boolean;
    activeZombies: number;
    respawnQueue: number;
    activeElites: Record<string, number>;
  } {
    const activeElites: Record<string, number> = {};
    for (const [id, set] of this._activeEliteActors) {
      activeElites[id] = set.size;
    }
    return {
      totalKills: this._totalKills,
      hordeActive: this._hordeActive,
      activeZombies: this._activeZombies.size,
      respawnQueue: this._respawnQueue.length,
      activeElites,
    };
  }

  /** Reset wave state when the player quits to the main menu. */
  public resetForMainMenu(): void {
    this.clearMissionRisk();
    this._hordeActive = false;
    this._totalKills = 0;
    this._waveTimer = 0;
    this._spawningPaused = false;
    this._pendingWaveSpawns.length = 0;

    for (const entry of this._respawnQueue) {
      this._returnZombieToIdlePool(entry.zombie);
    }
    this._respawnQueue.length = 0;

    for (const [zombie] of this._activeZombies) {
      this._returnZombieToIdlePool(zombie);
    }
    this._activeZombies.clear();

    this._relocateCooldowns.clear();
    this._eliteRelocateCooldowns.clear();
    this._relocateTimer = 0;
    this._spawnFailLogTimer = 0;
  }

  /**
   * Reset wave state between missions (e.g. replaying same rank).
   * Parks all live pooled zombies into the idle pool for reuse.
   */
  public resetForMissionStart(): void {
    this._pendingWaveSpawns.length = 0;

    for (const entry of this._respawnQueue) {
      this._returnZombieToIdlePool(entry.zombie);
    }
    this._respawnQueue.length = 0;
    this._relocateCooldowns.clear();
    this._eliteRelocateCooldowns.clear();
    this._relocateTimer = 0;

    for (const [zombie] of this._activeZombies) {
      this._returnZombieToIdlePool(zombie);
    }
    this._activeZombies.clear();

    for (const type of this._hordeEnemyTypes) {
      const active = this._activeEliteActors.get(type.id);
      if (!active) continue;
      for (const actor of active) {
        this._returnEliteToIdlePool(type, actor);
      }
      active.clear();
    }

    this._hordeActive = false;
    this._totalKills = 0;
    this._waveTimer = 0;
    this._spawningPaused = false;

    // Re-hook placed zombies so they count toward activation again
    this._needsHookPlaced = true;
  }

  protected override doEndPlay(): void {
    this._pendingWaveSpawns.length = 0;

    // Disconnect placed-zombie callbacks
    for (const zombie of this._placedZombies) {
      zombie.onDied = null;
    }
    this._placedZombies.length = 0;

    // Disconnect pooled-zombie callbacks
    for (const [zombie] of this._activeZombies) {
      zombie.onDied = null;
    }
    this._activeZombies.clear();
    this._respawnQueue.length = 0;
    this._relocateCooldowns.clear();
    this._eliteRelocateCooldowns.clear();
    this._idlePool.clear();
    this._idleElitePools.clear();

    for (const type of this._hordeEnemyTypes) {
      const active = this._activeEliteActors.get(type.id);
      if (!active) continue;
      for (const actor of active) {
        type.clearDeathHook(actor);
      }
      active.clear();
    }

    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
