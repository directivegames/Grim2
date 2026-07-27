import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';
import { revealActorWhenVisualReady } from './GltfReveal.js';

/**
 * Interface every pooled actor class must satisfy.
 * See the skill's references/poolable-contract.md for full implementation requirements.
 */
export interface PoolableActor extends ENGINE.Actor {
  /** Set to true by the pool after creation. False for editor-placed actors. */
  isPooled: boolean;
  /** The pool sets this before activation. The actor must call it from handleDeath. */
  onDied: (() => void) | null;
  /**
   * Reset state and position for reuse. Called after GLTF readiness is confirmed.
   * Must be safe to call on both hidden and visible actors.
   */
  softReset(position: THREE.Vector3): void;
}

export interface ActorPoolOptions<T extends PoolableActor> {
  /** Create one new actor instance. Called only when the idle pool is empty. */
  create: (world: ENGINE.World, position: THREE.Vector3) => T;
  /** Maximum simultaneously active (alive) actors. */
  maxActive: number;
  /** Seconds after death before the actor re-enters the ready queue (default 5). */
  respawnDelaySec?: number;
  /** Seconds before retrying a spawn that had no valid position (default 2). */
  respawnRetrySec?: number;
  /**
   * Called after softReset succeeds and the actor is confirmed visible.
   * Safe to spawn world-space VFX from here.
   */
  onSpawned?: (actor: T, position: THREE.Vector3) => void;
}

interface QueueEntry<T> {
  actor: T;
  delayRemaining: number;
}

/**
 * Generic actor pool for Genesys projects.
 *
 * Manages three actor states:
 *   active  — alive in the world, has onDied callback set
 *   queued  — dead, waiting for respawn delay before being marked ready
 *   idle    — hidden at (0,-1000,0), available for immediate reuse
 *
 * Usage:
 *   1. Call spawn(world, pos) to add an active actor (idles first, then creates).
 *   2. Call tickAndCollectReady(dt) each frame to get expired queue entries.
 *   3. Call reuse(actor, world, pos) to re-activate a ready actor.
 *   4. Call reset() between missions, destroy() on session end.
 */
export class ActorPool<T extends PoolableActor> {
  private readonly _create: (world: ENGINE.World, pos: THREE.Vector3) => T;
  private readonly _maxActive: number;
  private readonly _respawnDelaySec: number;
  private readonly _respawnRetrySec: number;
  private readonly _onSpawned: (actor: T, pos: THREE.Vector3) => void;

  private readonly _activeActors = new Map<T, () => void>();
  private readonly _queue: QueueEntry<T>[] = [];
  private readonly _idlePool = new Set<T>();

  constructor(options: ActorPoolOptions<T>) {
    this._create        = options.create;
    this._maxActive     = options.maxActive;
    this._respawnDelaySec = options.respawnDelaySec ?? 5;
    this._respawnRetrySec = options.respawnRetrySec ?? 2;
    this._onSpawned     = options.onSpawned ?? (() => {});
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Spawn one actor at position. Pulls from idle pool first; creates a new actor
   * only when the pool is empty. Does nothing if activeCount >= maxActive.
   * Returns true if a spawn was initiated.
   */
  spawn(world: ENGINE.World, position: THREE.Vector3): boolean {
    if (this._activeActors.size >= this._maxActive) return false;

    const actor = this._takeIdle() ?? this._createNew(world, position);
    if (!actor) return false;

    this._activate(actor, world, position);
    return true;
  }

  /**
   * Decrement respawn timers. Returns every actor whose delay has elapsed.
   * Call each frame. Pass the returned actors to reuse() or returnToIdle().
   */
  tickAndCollectReady(deltaTime: number): T[] {
    if (this._queue.length === 0) return [];

    const ready: T[] = [];
    let writeIdx = 0;

    for (let i = 0; i < this._queue.length; i++) {
      const entry = this._queue[i]!;
      entry.delayRemaining -= deltaTime;
      if (entry.delayRemaining <= 0) {
        ready.push(entry.actor);
      } else {
        this._queue[writeIdx++] = entry;
      }
    }
    this._queue.length = writeIdx;
    return ready;
  }

  /**
   * Re-activate a ready actor at a new position.
   * Call with actors returned by tickAndCollectReady().
   */
  reuse(actor: T, world: ENGINE.World, position: THREE.Vector3): void {
    if (this._activeActors.size >= this._maxActive) {
      this._park(actor);
      return;
    }
    this._activate(actor, world, position);
  }

  /**
   * Return a ready actor to the idle pool without spawning it.
   * Use when no valid position is available right now.
   */
  returnToIdle(actor: T): void {
    this._park(actor);
  }

  /**
   * Park all active and queued actors into the idle pool.
   * Call between missions. The next spawn() will reuse them before creating new ones.
   */
  reset(): void {
    for (const entry of this._queue) {
      this._park(entry.actor);
    }
    this._queue.length = 0;

    for (const actor of this._activeActors.keys()) {
      this._park(actor);
    }
    this._activeActors.clear();
  }

  /**
   * Destroy all pooled actors and clear all state.
   * Call on session end (back to main menu, world teardown).
   */
  destroy(): void {
    for (const actor of this._activeActors.keys()) {
      actor.onDied = null;
    }
    this._activeActors.clear();
    this._queue.length = 0;

    for (const actor of this._idlePool) {
      if (actor.getWorld()) actor.destroy();
    }
    this._idlePool.clear();
  }

  getActiveCount(): number { return this._activeActors.size; }
  getQueuedCount(): number { return this._queue.length; }
  getIdleCount(): number   { return this._idlePool.size; }

  // ── Internals ─────────────────────────────────────────────────────────────

  private _activate(actor: T, world: ENGINE.World, position: THREE.Vector3): void {
    const onDied = () => this._onActorDied(actor);
    actor.onDied = onDied;
    actor.isPooled = true;
    this._activeActors.set(actor, onDied);

    revealActorWhenVisualReady({
      actor,
      onReady: () => {
        if (!actor.getWorld()) {
          this._activeActors.delete(actor);
          actor.onDied = null;
          return;
        }
        actor.softReset(position);
        if (actor.isHiddenInGame()) {
          // softReset left the actor hidden — re-queue with retry delay
          actor.onDied = null;
          this._activeActors.delete(actor);
          this._queue.push({ actor, delayRemaining: this._respawnRetrySec });
          return;
        }
        this._onSpawned(actor, position);
      },
      onFailed: () => {
        actor.onDied = null;
        this._activeActors.delete(actor);
        this._queue.push({ actor, delayRemaining: this._respawnRetrySec });
      },
    });
  }

  private _onActorDied(actor: T): void {
    actor.onDied = null;
    this._activeActors.delete(actor);
    actor.setHiddenInGame(true);
    actor.rootComponent.position.set(0, -1000, 0);
    this._queue.push({ actor, delayRemaining: this._respawnDelaySec });
  }

  private _takeIdle(): T | null {
    for (const actor of this._idlePool) {
      this._idlePool.delete(actor);
      if (actor.getWorld()) return actor;
    }
    return null;
  }

  private _createNew(world: ENGINE.World, position: THREE.Vector3): T | null {
    try {
      const actor = this._create(world, position);
      actor.isPooled = true;
      actor.setHiddenInGame(true);
      return actor;
    } catch (e) {
      console.error('[ActorPool] create() threw:', e);
      return null;
    }
  }

  private _park(actor: T): void {
    actor.onDied = null;
    actor.setHiddenInGame(true);
    actor.rootComponent.position.set(0, -1000, 0);
    this._idlePool.add(actor);
  }
}
