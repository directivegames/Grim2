/**
 * ZombieHordeManager — Wave-based zombie spawning with smoke VFX.
 *
 * Design:
 *  - No pre-spawning — zombies are created lazily in waves
 *  - After 10 total kills, horde activates and first wave (10 zombies) spawns
 *  - Horde zombies spawn at EnemySpawnPointActor markers (closest pool to player) with smoke VFX
 *  - New wave on waveInterval after activation
 *  - Max 65 pooled zombies; pauses spawning until count drops to resume threshold
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
} from '../mission/enemy-spawn-points.js';
import { tryApplyHordeZombieSpawnPointWorldPosition } from '../mission/innocent-spawn-position.js';
import { BigUndeadActor } from './BigUndeadActor.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { destroyActorWhenGltfIdle } from '../utils/safe-actor-destroy.js';
import type { RiskLevel } from '../data/risk-levels.js';

// Configuration
const MAX_ACTIVE_ZOMBIES = 65;
const RESUME_SPAWN_THRESHOLD = 50;
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

    for (const type of this._hordeEnemyTypes) {
      this._activeEliteActors.set(type.id, new Set());
    }

    // Warm GLB caches so first reveals are not blocked on async load.
    void ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(NEW_ZOMBIE_MODEL_URL));
    void ENGINE.resourceManager.loadModel(
      ENGINE.AssetPath.fromString('@project/assets/models/Vomitball.glb'),
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
   * Reveal a zombie only once its GLTF visual exists.
   *
   * Newly-created horde zombies load their GLB asynchronously after addActor().
   * If smoke is spawned before that load completes, the player sees smoke with
   * no zombie. Pooled zombies are already loaded, so this returns immediately.
   */
  private revealZombieWhenVisualReady(
    world: ENGINE.World,
    zombie: NewZombieActor,
    spawnPos: THREE.Vector3
  ): void {
    const finalSpawnPos = spawnPos.clone();
    const visual = zombie.getComponent(ENGINE.GLTFMeshComponent);

    const reveal = (): void => {
      if (!zombie.getWorld()) return;
      zombie.softReset(finalSpawnPos);
      ZombieRiseVFXActor.spawnAt(world, finalSpawnPos);
    };

    if (!visual || visual.isModelLoaded()) {
      reveal();
      return;
    }

    void visual.waitForLoad().then(reveal).catch(() => {
      // If loading errors, don't spawn smoke-only — drop from active set for retry.
      zombie.onDied = null;
      this._activeZombies.delete(zombie);
      zombie.setHiddenInGame(true);
      this._respawnQueue.push({ delayRemaining: RESPAWN_RETRY_SEC, zombie });
    });
  }

  private spawnWave(): void {
    if (this._activeZombies.size >= this._maxActiveZombies) {
      if (!this._spawningPaused) {
        this._spawningPaused = true;
      }
      return;
    }

    const toSpawn = Math.min(WAVE_SIZE, this._maxActiveZombies - this._activeZombies.size);
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

    const actor = type.create(world, spawnPos);
    actor.setHiddenInGame(true);
    const onDied = () => this._onEliteEnemyDied(type, actor);
    type.hookDeath(actor, onDied);

    const activeSet = this._activeEliteActors.get(type.id);
    activeSet?.add(actor);

    this._revealActorWhenVisualReady(world, actor, spawnPos, type);
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
    const finalSpawnPos = spawnPos.clone();
    const visual = actor.getComponent(ENGINE.GLTFMeshComponent);

    const reveal = (): void => {
      if (!actor.getWorld()) return;
      actor.rootComponent.position.copy(finalSpawnPos);
      actor.rootComponent.updateMatrixWorld();
      actor.setHiddenInGame(false);
      if (actor instanceof BigUndeadActor) {
        actor.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
        actor.wakeForHordeSpawn();
      }
      ZombieRiseVFXActor.spawnAt(world, finalSpawnPos);
    };

    if (!visual || visual.isModelLoaded()) {
      reveal();
      return;
    }

    void visual.waitForLoad().then(reveal).catch(() => {
      type.clearDeathHook(actor);
      this._activeEliteActors.get(type.id)?.delete(actor);
      actor.setHiddenInGame(true);
      destroyActorWhenGltfIdle(actor);
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
   * Create a brand-new zombie actor. Only called for initial wave fill —
   * subsequent respawns go through respawnZombie() which reuses the actor.
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

  /** Horde spawns only from scene-placed EnemySpawnPointActor markers (nav-validated). */
  private getSpawnPosition(
    playerPos: THREE.Vector3,
    reason: 'spawn' | 'respawn' | 'relocate' | 'elite',
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

    const nav = world.getNavigationServer();
    const triedMarkers = new Set<EnemySpawnPointActor>();
    const maxMarkerTries = Math.min(MAX_MARKER_SPAWN_TRIES, markerCount);

    for (let i = 0; i < maxMarkerTries; i++) {
      const marker = pickClosestEnemySpawnPoint(playerPos, this._spawnPos, triedMarkers);
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

    for (const { actor: zombie } of this._activeZombies.values()) {
      if (zombie.isHiddenInGame() || this._relocateCooldowns.has(zombie)) {
        continue;
      }

      zombie.rootComponent.getWorldPosition(this._zombiePos);
      if (this._horizontalDistSq(this._zombiePos, this._playerPos) < RELOCATE_MIN_DISTANCE_SQ) {
        continue;
      }

      const spawnPos = this.getSpawnPosition(this._playerPos, 'relocate');
      if (!spawnPos) {
        continue;
      }

      zombie.softReset(spawnPos);
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

        const spawnPos = this.getSpawnPosition(this._playerPos, 'relocate');
        if (!spawnPos) {
          continue;
        }

        actor.rootComponent.position.copy(spawnPos);
        actor.rootComponent.updateMatrixWorld();
        if (actor instanceof BigUndeadActor) {
          actor.wakeForHordeSpawn();
        }
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
      this._maxActiveZombies = options.spawnCap;
      this._resumeSpawnThreshold = Math.max(20, Math.floor(this._maxActiveZombies * 0.77));
    } else {
      this._maxActiveZombies = MAX_ACTIVE_ZOMBIES;
      this._resumeSpawnThreshold = RESUME_SPAWN_THRESHOLD;
    }

    const baseInterval = options?.aggressiveSpawn ? 4 : WAVE_INTERVAL_SEC;
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
    this._maxActiveZombies = MAX_ACTIVE_ZOMBIES;
    this._resumeSpawnThreshold = RESUME_SPAWN_THRESHOLD;
    this.waveInterval = WAVE_INTERVAL_SEC;
    this._waveIntervalSec = WAVE_INTERVAL_SEC;
    this._applyRiskToAllZombies();
  }

  private _applyRiskToAllZombies(): void {
    const world = this.getWorld();
    if (!world) return;

    for (const actor of world.getActors()) {
      if (actor instanceof NewZombieActor) {
        this._applyRiskToZombie(actor);
      } else if (actor instanceof BigUndeadActor) {
        actor.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
      }
    }
  }

  private _applyRiskToZombie(zombie: NewZombieActor): void {
    zombie.applyMissionRiskMultipliers(this._riskHealthMult, this._riskDamageMult);
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
    this._respawnQueue.length = 0;
    this._relocateCooldowns.clear();
    this._eliteRelocateCooldowns.clear();
    this._relocateTimer = 0;
    this._spawnFailLogTimer = 0;

    for (const [zombie] of this._activeZombies) {
      zombie.onDied = null;
    }
    this._activeZombies.clear();
  }

  /**
   * Reset wave state between missions (e.g. replaying same rank).
   * Parks all live pooled zombies off-screen, disconnects elite actors,
   * and resets kill/wave counters so the next mission starts fresh.
   */
  public resetForMissionStart(): void {
    this._pendingWaveSpawns.length = 0;
    this._respawnQueue.length = 0;
    this._relocateCooldowns.clear();
    this._eliteRelocateCooldowns.clear();
    this._relocateTimer = 0;

    for (const [zombie] of this._activeZombies) {
      zombie.onDied = null;
      zombie.parkForHordeReset();
    }
    this._activeZombies.clear();

    for (const type of this._hordeEnemyTypes) {
      const active = this._activeEliteActors.get(type.id);
      if (!active) continue;
      for (const actor of active) {
        type.clearDeathHook(actor);
        actor.setHiddenInGame(true);
        actor.rootComponent.position.set(0, -1000, 0);
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
