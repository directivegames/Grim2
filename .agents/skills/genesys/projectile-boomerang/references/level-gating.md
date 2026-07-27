# Level Gating Reference

## Typical three-tier design

A common design for a projectile ability with three unlock tiers:

Level 1 — Single blade. Launching again is blocked while the blade is in flight.
Level 2 — Three-blade fan. Still blocked while blades are in flight.
Level 3 — Single or three blades with a cooldown instead of the in-flight block. Multiple throws can stack.

## Implementing the block pattern

```ts
private _onRightClick(): void {
  const level = vault.getSkillLevel('soulThrow');
  if (level < 1) return;                                          // not unlocked

  if (this._boomerang.hasActiveBlades() && level < 3) return;    // in-flight block for L1/L2

  if (level >= 3 && this._isCooldownActive()) return;            // cooldown for L3

  const player = world.getFirstPlayerPawn();
  if (!player) return;

  player.rootComponent.getWorldPosition(this._launchPos);
  this._launchPos.y += BOOMERANG_HEIGHT;
  resolveAimDirection(world, player, this._launchPos.y, this._aimDir);
  this._launchPos.addScaledVector(this._aimDir, LAUNCH_OFFSET);

  this._boomerang.launch(this._launchPos, this._aimDir, {
    bladeCount:       level >= 2 ? 3 : 1,
    spreadHalfAngle:  0.35,
  });

  if (level >= 3) {
    this._lastThrowTime = world.getGameTime();
  }
}

private _isCooldownActive(): boolean {
  const world = this.getWorld();
  if (!world) return false;
  return world.getGameTime() - this._lastThrowTime < COOLDOWN_L3;
}
```

## Cooldown display

Expose the remaining cooldown fraction to your HUD:

```ts
getCooldownFraction(): number {
  const world = this.getWorld();
  if (!world) return 0;
  const elapsed = world.getGameTime() - this._lastThrowTime;
  return Math.max(0, 1 - elapsed / COOLDOWN_L3);
}
```

A progress bar set to `1 - getCooldownFraction()` drains as the cooldown runs.
