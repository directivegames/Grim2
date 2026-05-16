/**
 * ZombieHordeManager — Wave-based zombie spawning with smoke VFX.
 *
 * Design:
 *  - No pre-spawning — zombies are created lazily in waves
 *  - After 10 total kills, horde activates and first wave (10 zombies) spawns
 *  - Zombies spawn 12-15 units from player with dark smoke VFX
 *  - New wave every 15 seconds after activation
 *  - Max 35 zombies active at once
 *  - Each death queues the SAME actor for reuse — no new actor allocations after
 *    the initial wave fill. This prevents zombie actor accumulation over long sessions.
 *  - Smoke VFX hides the respawn pop-in
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { NewZombieActor } from './NewZombieActor.js';
import { ZombieRiseVFXActor } from './ZombieRiseVFXActor.js';

// Configuration
const MAX_ACTIVE_ZOMBIES = 35;
const RESUME_SPAWN_THRESHOLD = 25;
const KILLS_TO_ACTIVATE_HORDE = 10;
const MAX_TOTAL_KILLS = 500;

// Wave settings
const WAVE_SIZE = 10;
const WAVE_INTERVAL_SEC = 8;
const RESPAWN_DELAY_SEC = 5;

// Spawn positioning
const SPAWN_MIN_DISTANCE = 12;
const SPAWN_MAX_DISTANCE = 15;
const SPAWN_HEIGHT = 0.9;

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

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

@ENGINE.GameClass()
export class ZombieHordeManager extends ENGINE.Actor {
  private _activeZombies = new Map<NewZombieActor, ActiveZombie>();
  private _respawnQueue: RespawnQueueEntry[] = [];

  private _totalKills = 0;
  private _hordeActive = false;
  private _waveTimer = 0;
  private _placedZombiesCount = 0;
  private _spawningPaused = false;

  /** Placed-zombie references — cleared in doEndPlay to avoid dangling callbacks. */
  private _placedZombies: NewZombieActor[] = [];

  /** All pending setTimeout handles — cleared in doEndPlay to prevent stale callbacks. */
  private _pendingTimeouts: TimeoutHandle[] = [];

  // Scratch vectors
  private readonly _playerPos = new THREE.Vector3();
  private readonly _spawnPos = new THREE.Vector3();
  private readonly _navmeshPos = new THREE.Vector3();

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
    const id = globalThis.setTimeout(() => this.hookPlacedZombies(), 0);
    this._pendingTimeouts.push(id);
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

    if (this._spawningPaused && this._activeZombies.size <= RESUME_SPAWN_THRESHOLD) {
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
    if (!this._hordeActive) return;
    if (this._totalKills >= MAX_TOTAL_KILLS) return;

    this.processRespawnQueue(deltaTime);

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
      if (entry.delayRemaining > 0 || this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) {
        // Not ready, or at capacity — keep in queue
        this._respawnQueue[writeIdx++] = entry;
      } else {
        // Ready and have capacity — reuse this actor at a new spawn position
        this.respawnZombie(entry.zombie);
      }
    }
    this._respawnQueue.length = writeIdx;
  }

  /**
   * Reuse an existing (hidden) zombie at a fresh spawn position.
   * Never allocates a new actor.
   */
  private respawnZombie(zombie: NewZombieActor): void {
    if (this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) return;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return;

    player.rootComponent.getWorldPosition(this._playerPos);
    const spawnPos = this.getSpawnPosition(this._playerPos);
    if (!spawnPos) return;

    // Re-wire death callback
    const onDied = () => this.onPoolZombieDied(zombie);
    zombie.onDied = onDied;
    this._activeZombies.set(zombie, { actor: zombie, onDiedCallback: onDied });

    this.revealZombieWhenVisualReady(world, zombie, spawnPos);
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
      // If loading errors, don't spawn smoke-only. Leave this actor hidden so
      // it can be recycled/retried without creating a visible empty spawn.
      zombie.setHiddenInGame(true);
    });
  }

  private spawnWave(): void {
    if (this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) {
      if (!this._spawningPaused) {
        this._spawningPaused = true;
      }
      return;
    }

    const toSpawn = Math.min(WAVE_SIZE, MAX_ACTIVE_ZOMBIES - this._activeZombies.size);
    if (toSpawn <= 0) return;

    for (let i = 0; i < toSpawn; i++) {
      this.spawnSingleZombieWithDelay(i * 0.15);
    }
  }

  private spawnSingleZombieWithDelay(delaySec: number = 0): void {
    if (delaySec > 0) {
      const id = globalThis.setTimeout(() => this.spawnSingleZombie(), delaySec * 1000);
      this._pendingTimeouts.push(id);
    } else {
      this.spawnSingleZombie();
    }
  }

  /**
   * Create a brand-new zombie actor. Only called for initial wave fill —
   * subsequent respawns go through respawnZombie() which reuses the actor.
   */
  private spawnSingleZombie(): NewZombieActor | null {
    if (this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) return null;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return null;

    player.rootComponent.getWorldPosition(this._playerPos);
    const spawnPos = this.getSpawnPosition(this._playerPos);
    if (!spawnPos) return null;

    const zombie = NewZombieActor.create({ position: spawnPos });
    zombie.isPooled = true;
    zombie.rootComponent.scale.set(1.224317, 1.157981, 1.410963);

    const onDied = () => this.onPoolZombieDied(zombie);
    zombie.onDied = onDied;
    zombie.setHiddenInGame(true);

    world.addActor(zombie);
    this._activeZombies.set(zombie, { actor: zombie, onDiedCallback: onDied });

    this.revealZombieWhenVisualReady(world, zombie, spawnPos);

    return zombie;
  }

  private getSpawnPosition(playerPos: THREE.Vector3): THREE.Vector3 | null {
    const world = this.getWorld();
    const nav = world?.getNavigationServer() as {
      isReady?: () => boolean;
      getClosestPointOnNavigationMesh?: (p: THREE.Vector3) => THREE.Vector3;
    } | null;

    const maxAttempts = 5;
    const maxSnapDistance = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = SPAWN_MIN_DISTANCE + Math.random() * (SPAWN_MAX_DISTANCE - SPAWN_MIN_DISTANCE);

      this._spawnPos.set(
        playerPos.x + Math.cos(angle) * distance,
        playerPos.y,
        playerPos.z + Math.sin(angle) * distance
      );

      if (nav?.isReady?.() && nav.getClosestPointOnNavigationMesh) {
        try {
          this._navmeshPos.copy(nav.getClosestPointOnNavigationMesh(this._spawnPos));
          const snapDistance = this._spawnPos.distanceTo(this._navmeshPos);
          if (snapDistance <= maxSnapDistance) {
            this._spawnPos.copy(this._navmeshPos);
            this._spawnPos.y = SPAWN_HEIGHT;
            return this._spawnPos;
          }
        } catch {
          return this._spawnPos;
        }
      } else {
        return this._spawnPos;
      }
    }

    return null;
  }

  private checkVictoryCondition(): void {
    if (this._totalKills >= MAX_TOTAL_KILLS) {
      console.log(`[ZombieHordeManager] VICTORY! ${this._totalKills} zombies killed!`);
    }
  }

  public getStats(): {
    totalKills: number;
    hordeActive: boolean;
    activeZombies: number;
    respawnQueue: number;
  } {
    return {
      totalKills: this._totalKills,
      hordeActive: this._hordeActive,
      activeZombies: this._activeZombies.size,
      respawnQueue: this._respawnQueue.length,
    };
  }

  protected override doEndPlay(): void {
    // Cancel all pending timeouts — prevents callbacks from firing after world teardown
    for (const id of this._pendingTimeouts) {
      globalThis.clearTimeout(id);
    }
    this._pendingTimeouts.length = 0;

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

    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
