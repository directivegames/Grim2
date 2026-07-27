# Poolable contract

Every actor class used with `ActorPool` must implement the `PoolableActor` interface. This is what the pool relies on to hide, reuse, and track actors.

## Required fields

```ts
public isPooled = false;
public onDied: (() => void) | null = null;
```

The pool sets `isPooled = true` after the first `create()` call. The pool sets `onDied` before activating the actor and clears it after death.

## softReset(position)

Called by the pool (inside the GLTF readiness callback) when an actor is reused at a new position. Must be safe to call on both hidden and visible actors, including already-active enemies during the relocation flow.

```ts
public softReset(position: THREE.Vector3): void {
  // 1. Position
  this.rootComponent.position.copy(position);
  this.rootComponent.updateMatrixWorld();

  // 2. Visibility
  this.setHiddenInGame(false);

  // 3. Gameplay state — restore to spawn-ready condition
  this._health = this._maxHealth;
  this._deathSequenceStarted = false;

  // 4. NPC — re-enable and prime aggro
  if (this._npc) {
    this._npc.enabled = true;
    // Set DistanceToPlayer to approximate spawn distance, NOT 0.
    // 0 causes the attack zone to latch immediately, making the enemy stand still.
    this._npc.blackboard.set('DistanceToPlayer', 15);
    this._npc.blackboard.set('_hasAggro', true);
  }
}
```

## handleDeath

Must call `this.onDied?.()` to notify the pool of the death. Must NOT destroy the actor — the pool reuses it.

```ts
protected override handleDeath(): void {
  // 1. Death effects (animation, VFX, audio)
  // 2. Notify pool — always call this
  this.onDied?.();
  // 3. Do NOT call this.destroy() for pooled actors
}
```

The pool handles hiding and parking the actor inside `_onActorDied` before calling the respawn queue.

## Tick guard

Skip all per-frame logic while hidden. Pooled actors remain in the world physics simulation at (0, -1000, 0) while idle:

```ts
public override tickPrePhysics(deltaTime: number): void {
  if (this.isHiddenInGame()) return;
  // ... tick logic
}
```

## Optional: beginVisibilityReassert

If your actor has a `beginVisibilityReassert()` method, you can call it from `softReset` to replay any fade-in or emergence animation from the beginning. This is useful for actors that have a visible spawn animation that needs to restart on each reuse.

## What the pool does on death

After `onDied?.()` fires:

1. Sets `actor.onDied = null`
2. Removes from `_activeActors`
3. Calls `actor.setHiddenInGame(true)`
4. Sets `actor.rootComponent.position.set(0, -1000, 0)` — parks physics body off-screen
5. Adds to `_queue` with `respawnDelaySec` delay

After the delay elapses, `tickAndCollectReady()` returns the actor. Your manager then calls `pool.reuse(actor, world, position)` to re-activate it.
