# Player Reset Contract

## What prepareForMissionStart must guarantee

When `prepareForMissionStart()` is called, the pawn must be fully ready for gameplay to begin the next frame. Every time it is called it should be idempotent — calling it twice in a row must produce the same result as calling it once.

Required outcomes:
- Pawn is visible (`setHiddenInGame(false)`)
- Pawn is at the mission spawn point (teleported)
- Pawn has full health
- All active effects are cleared (slomo overlay, special transformations, combo state, etc.)

## Implementing prepareForMissionStart

```ts
public prepareForMissionStart(): void {
  // 1. Show the pawn — death or endPlay may have hidden it
  this.setHiddenInGame(false);

  // 2. Full health
  this.getComponent(ENGINE.CharacterStatsComponent)?.resetHealth();

  // 3. Cancel all active effects
  this.clearSlomoEffect?.();
  this.clearOrbitEffect?.();
  this.combo?.releaseCombatInput();

  // 4. Teleport to spawn
  const world = this.getWorld();
  if (world) {
    teleportPawnToSpawn(this, world);
  }
}
```

## Why call it twice

Call `prepareForMissionStart` during world reset, and again just before `setGameplayUnlocked(true)` in `finishMissionIntro`.

The second call is a safety net. If the intro sequence (Ready-To-Reap, tutorial, fade-in) triggers any code that partially modifies pawn state (e.g. visibility toggles, position changes), the second call ensures the pawn is in a clean state exactly when gameplay begins.

## setHiddenInGame override

The engine's default `setHiddenInGame` sets a flag and calls `world.setActorHiddenInGame`. On some engine versions, child mesh objects may have their render layers disabled separately (e.g. by an explode/death animation). If the pawn is invisible after reset, override `setHiddenInGame` to traverse the full hierarchy:

```ts
public override setHiddenInGame(hidden: boolean): void {
  super.setHiddenInGame(hidden);
  this.rootComponent.visible = !hidden;
  this.rootComponent.traverse(obj => {
    obj.visible = !hidden;
    if (hidden) { obj.layers.disableAll(); }
    else        { obj.layers.enable(0);    }
  });
}
```

## Teleport constraint (KinematicVelocityBased pawns)

For pawns with a `KinematicVelocityBased` physics body, writing `rootComponent.position` directly has no effect — the physics body drives the component. Use the movement component's `setPawnWorldTransform` instead:

```ts
mc.setPawnWorldTransform({ position: spawnPos });
```

Physics must be running (slomo > 0) for this queued teleport to commit. Ensure `clearMissionPause` was called before `prepareForMissionStart`. See the `grim-mission-reset` skill for the full explanation.
