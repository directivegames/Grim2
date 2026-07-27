# Pooling contract

Every enemy class used with `ZombieHordeManager` must satisfy this interface. Use `NewZombieActor` as the reference implementation.

## Required fields

```ts
class MyEnemy extends ENGINE.Actor {
  public isPooled: boolean = false;
  public onDied: (() => void) | null = null;
}
```

`isPooled` is set to `true` by the manager after the actor is created for the pool. Placed (editor) enemies keep `isPooled = false` and are destroyed on death rather than recycled.

## softReset(position)

Called by the manager when reusing a pooled actor at a new spawn position, and by the relocation system when moving a live active enemy. Must be safe to call on both hidden and visible actors.

```ts
public softReset(position: THREE.Vector3): void {
  // 1. Position
  this.rootComponent.position.copy(position);
  this.rootComponent.updateMatrixWorld();

  // 2. Visibility
  this.setHiddenInGame(false);

  // 3. Health — restore to full
  this._health = this._maxHealth;

  // 4. NPC — re-enable and set aggro
  if (this._npc) {
    this._npc.enabled = true;
    // Set DistanceToPlayer to approximately the spawn distance (~15), NOT 0.
    // Setting 0 causes attackZoneLatched to trigger immediately, making the
    // enemy stand still instead of chasing.
    this._npc.blackboard.set('DistanceToPlayer', 15);
    this._npc.blackboard.set('_hasAggro', true);
  }

  // 5. Animation — reset to idle/walk state
  this._deathSequenceStarted = false;

  // Do NOT call followActor() — conflicts with direct-steer chase.
}
```

## handleDeath

Must call `this.onDied?.()` to notify the manager. Must then either destroy (placed) or recycle (pooled) the actor.

```ts
public override handleDeath(): void {
  // ... death VFX, animation ...

  this.onDied?.();  // MUST call this — manager uses it to count kills

  if (this.isPooled) {
    this._recycle();
  } else {
    this.destroy();
  }
}

private _recycle(): void {
  this._deathSequenceStarted = false;
  this.setHiddenInGame(true);
  this.rootComponent.position.set(0, -1000, 0); // park physics body off-screen
}
```

## Tick guard

Skip all per-frame logic when hidden. Pooled actors remain in the world while in the idle pool and will consume budget if they tick:

```ts
public override tickPrePhysics(deltaTime: number): void {
  if (this.isHiddenInGame()) return;
  // ... rest of tick
}
```

## GLTF readiness

`revealActorWhenVisualReady` checks for a `GLTFMeshComponent` on the actor and waits until `isModelLoaded()` is true and at least one renderable mesh is attached before calling `softReset`. If your enemy has no `GLTFMeshComponent`, the readiness check passes immediately and `softReset` is called on the next frame.

If `softReset` is called but `isHiddenInGame()` returns true immediately after (can happen if the actor hides itself during softReset due to a state issue), the manager re-queues the actor with a 2s delay instead of counting it as active.

## beginVisibilityReassert (optional)

If your actor has a `beginVisibilityReassert()` method, the manager calls it after `softReset` during respawn and relocation. This is used to replay any visibility/transparency animation from the start. Implement it if your enemy has a fade-in or emergence effect that needs to replay on each spawn.

## Scale after creation

If your placed actors have non-default scale set in the scene editor, spawned (pooled) actors default to `(1, 1, 1)`. Set scale explicitly after pool creation:

```ts
zombie.rootComponent.scale.set(1.224317, 1.157981, 1.410963);
```

Check your placed actor's scale in the scene file and match it.
