/**
 * ZombieHordeManager — Wave-based zombie spawning with smoke VFX.
 *
 * Design:
 *  - No pre-spawning — zombies are created lazily in waves
 *  - After 10 total kills, horde activates and first wave (10 zombies) spawns
 *  - Zombies spawn 12-15 units from player with dark smoke VFX
 *  - New wave every 15 seconds after activation
 *  - Max 150 zombies active at once
 *  - Each death adds to a respawn queue (5 second delay)
 *  - Smoke VFX hides the spawn pop-in
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { NewZombieActor } from './NewZombieActor.js';
import { ZombieRiseVFXActor } from './ZombieRiseVFXActor.js';

// Configuration
const MAX_ACTIVE_ZOMBIES = 35;
const RESUME_SPAWN_THRESHOLD = 25; // Resume spawning when count drops to this (10 killed from max)
const KILLS_TO_ACTIVATE_HORDE = 10;
const MAX_TOTAL_KILLS = 500;

// Wave settings
const WAVE_SIZE = 10;
const WAVE_INTERVAL_SEC = 8;
const RESPAWN_DELAY_SEC = 5;

// Spawn positioning
const SPAWN_MIN_DISTANCE = 12; // Units from player
const SPAWN_MAX_DISTANCE = 15;
const SPAWN_HEIGHT = 0.9; // Match placed zombie height (capsule center, puts feet on ground)

interface ActiveZombie {
  actor: NewZombieActor;
  onDiedCallback: () => void;
}

interface RespawnQueueEntry {
  delayRemaining: number;
}

@ENGINE.GameClass()
export class ZombieHordeManager extends ENGINE.Actor {
  // Active pool
  private _activeZombies = new Map<NewZombieActor, ActiveZombie>();
  private _respawnQueue: RespawnQueueEntry[] = [];

  // Tracking
  private _totalKills = 0;
  private _hordeActive = false;
  private _waveTimer = 0;
  private _placedZombiesCount = 0;
  private _spawningPaused = false; // Paused when hitting MAX_ACTIVE_ZOMBIES

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

    // Delay hooking placed zombies to ensure all scene actors are initialized
    globalThis.setTimeout(() => {
      this.hookPlacedZombies();
    }, 0);
  }

  /**
   * Hook into existing placed zombies in the scene to count their deaths.
   */
  private hookPlacedZombies(): void {
    const world = this.getWorld();
    if (!world) return;

    const placedZombies = world.getActors().filter(
      (a): a is NewZombieActor => a instanceof NewZombieActor && !a.isPooled
    );

    this._placedZombiesCount = placedZombies.length;

    for (const zombie of placedZombies) {
      zombie.onDied = () => this.onPlacedZombieDied();
    }

    console.log(`[ZombieHordeManager] Hooked into ${placedZombies.length} placed zombies`);
    console.log(`[ZombieHordeManager] Need ${this.killsToActivate} kills to activate horde`);
  }

  /**
   * Called when a placed (non-pooled) zombie dies.
   */
  private onPlacedZombieDied(): void {
    this._totalKills++;
    console.log(`[ZombieHordeManager] Kill! Total: ${this._totalKills}/${this.killsToActivate}`);

    // Activate horde after threshold
    if (!this._hordeActive && this._totalKills >= this.killsToActivate) {
      this.activateHorde();
    }

    this.checkVictoryCondition();
  }

  /**
   * Called when a pool zombie dies — add to respawn queue.
   */
  private onPoolZombieDied(zombie: NewZombieActor): void {
    this._totalKills++;

    // Remove from active pool
    const entry = this._activeZombies.get(zombie);
    if (entry) {
      zombie.onDied = null;
      this._activeZombies.delete(zombie);
    }

    // Check if we should resume spawning (dropped below threshold)
    if (this._spawningPaused && this._activeZombies.size <= RESUME_SPAWN_THRESHOLD) {
      this._spawningPaused = false;
      this._waveTimer = 0; // Reset wave timer so next wave spawns soon
      console.log(`[ZombieHordeManager] Spawning resumed! Zombies: ${this._activeZombies.size}/${MAX_ACTIVE_ZOMBIES}`);
    }

    // Add to respawn queue
    this._respawnQueue.push({ delayRemaining: RESPAWN_DELAY_SEC });

    console.log(`[ZombieHordeManager] Pool zombie died. Respawn queue: ${this._respawnQueue.length}`);

    this.checkVictoryCondition();
  }

  /**
   * Activate the horde — first wave spawns immediately.
   */
  private activateHorde(): void {
    this._hordeActive = true;
    console.log(`[ZombieHordeManager] HORDE ACTIVATED! Total kills: ${this._totalKills}`);

    // Spawn first wave immediately
    this.spawnWave();
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (!this._hordeActive) return;
    if (this._totalKills >= MAX_TOTAL_KILLS) return;

    // Process respawn queue
    this.processRespawnQueue(deltaTime);

    // Wave timer
    this._waveTimer += deltaTime;
    if (this._waveTimer >= this.waveInterval) {
      this._waveTimer = 0;
      this.spawnWave();
    }
  }

  /**
   * Process the respawn queue — spawn zombies when their delay expires.
   */
  private processRespawnQueue(deltaTime: number): void {
    // Update delays
    for (const entry of this._respawnQueue) {
      entry.delayRemaining -= deltaTime;
    }

    // Count ready spawns
    let readyCount = 0;
    for (const entry of this._respawnQueue) {
      if (entry.delayRemaining <= 0) readyCount++;
    }

    // Remove ready entries and spawn
    if (readyCount > 0) {
      this._respawnQueue = this._respawnQueue.filter(e => e.delayRemaining > 0);

      for (let i = 0; i < readyCount; i++) {
        if (this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) break;
        this.spawnSingleZombie();
      }
    }
  }

  /**
   * Spawn a wave of zombies.
   */
  private spawnWave(): void {
    // Pause spawning when at max, resume when 10 have been killed
    if (this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) {
      if (!this._spawningPaused) {
        this._spawningPaused = true;
        console.log('[ZombieHordeManager] Spawning paused — max zombies reached. Resume at 40.');
      }
      return;
    }

    const toSpawn = Math.min(WAVE_SIZE, MAX_ACTIVE_ZOMBIES - this._activeZombies.size);

    if (toSpawn <= 0) return;

    console.log(`[ZombieHordeManager] Spawning wave of ${toSpawn} zombies`);

    for (let i = 0; i < toSpawn; i++) {
      this.spawnSingleZombieWithDelay(i * 0.15); // Stagger spawns slightly
    }
  }

  /**
   * Spawn a single zombie with optional delay.
   */
  private spawnSingleZombieWithDelay(delaySec: number = 0): void {
    if (delaySec > 0) {
      globalThis.setTimeout(() => this.spawnSingleZombie(), delaySec * 1000);
    } else {
      this.spawnSingleZombie();
    }
  }

  /**
   * Spawn a single zombie at a distance from the player with smoke VFX.
   */
  private spawnSingleZombie(): NewZombieActor | null {
    if (this._activeZombies.size >= MAX_ACTIVE_ZOMBIES) return null;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return null;

    // Calculate spawn position (navmesh-validated)
    player.rootComponent.getWorldPosition(this._playerPos);
    const spawnPos = this.getSpawnPosition(this._playerPos);

    // If no valid spawn position found, skip this spawn
    if (!spawnPos) {
      console.log('[ZombieHordeManager] No valid spawn position found, skipping spawn');
      return null;
    }

    // Create zombie with correct scale to match placed zombies
    const zombie = NewZombieActor.create({ position: spawnPos });
    zombie.isPooled = true;
    zombie.rootComponent.scale.set(1.224317, 1.157981, 1.410963);

    // Wire up death callback
    const onDied = () => this.onPoolZombieDied(zombie);
    zombie.onDied = onDied;

    // Initially hidden — will be revealed after smoke
    zombie.setHiddenInGame(true);

    world.addActor(zombie);

    // Track as active
    this._activeZombies.set(zombie, { actor: zombie, onDiedCallback: onDied });

    // Spawn smoke VFX
    ZombieRiseVFXActor.spawnAt(world, spawnPos);

    // Reveal zombie after smoke starts (0.3s delay)
    // Clone spawnPos to avoid shared reference bug
    const finalSpawnPos = spawnPos.clone();
    globalThis.setTimeout(() => {
      if (zombie.getWorld()) {
        zombie.setHiddenInGame(false);
        // Force immediate chase
        zombie.softReset(finalSpawnPos);
      }
    }, 300);

    return zombie;
  }

  /**
   * Get a spawn position near the player (visible range, outside melee).
   * Snaps to navigation mesh to avoid spawning inside geometry.
   */
  private getSpawnPosition(playerPos: THREE.Vector3): THREE.Vector3 | null {
    const world = this.getWorld();
    const nav = world?.getNavigationServer() as {
      isReady?: () => boolean;
      getClosestPointOnNavigationMesh?: (p: THREE.Vector3) => THREE.Vector3;
    } | null;

    const maxAttempts = 5;
    const maxSnapDistance = 5; // If navmesh snaps more than this, position was likely inside a wall

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Random angle around the player
      const angle = Math.random() * Math.PI * 2;
      const distance = SPAWN_MIN_DISTANCE + Math.random() * (SPAWN_MAX_DISTANCE - SPAWN_MIN_DISTANCE);

      // Use player's Y height for navmesh query (navmesh is at ground level)
      this._spawnPos.set(
        playerPos.x + Math.cos(angle) * distance,
        playerPos.y,
        playerPos.z + Math.sin(angle) * distance
      );

      // If navmesh is ready, snap to it
      if (nav?.isReady?.() && nav.getClosestPointOnNavigationMesh) {
        try {
          this._navmeshPos.copy(nav.getClosestPointOnNavigationMesh(this._spawnPos));

          // Check if the snap was reasonable (not inside a wall far from intended spot)
          const snapDistance = this._spawnPos.distanceTo(this._navmeshPos);
          if (snapDistance <= maxSnapDistance) {
            // Valid spawn position found - set final height for zombie capsule center
            this._spawnPos.copy(this._navmeshPos);
            this._spawnPos.y = SPAWN_HEIGHT;
            return this._spawnPos;
          }
          // Too far snap — likely inside geometry, try a different angle
        } catch {
          // Navmesh query failed, use raw position as fallback
          return this._spawnPos;
        }
      } else {
        // No navmesh available, use raw position
        return this._spawnPos;
      }
    }

    // All attempts failed — return null to signal spawn should be skipped
    return null;
  }

  /**
   * Check if victory condition reached.
   */
  private checkVictoryCondition(): void {
    if (this._totalKills >= MAX_TOTAL_KILLS) {
      console.log(`[ZombieHordeManager] VICTORY! ${this._totalKills} zombies killed!`);
    }
  }

  /**
   * Get current stats for UI/debugging.
   */
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
    // Clean up references
    for (const [zombie, entry] of this._activeZombies) {
      zombie.onDied = null;
    }
    this._activeZombies.clear();
    this._respawnQueue = [];
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
