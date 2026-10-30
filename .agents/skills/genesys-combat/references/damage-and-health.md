# Damage and health

Source of truth: `.engine/src/nodes/CharacterStatsNode.ts`.

## `CharacterStatsNode`

A non-spatial `SceneNode`. Put one on each damageable root, classic or GSS. GSS pawns use it too: `GSSTags.Health` / `GSSTags.Ammo` are attribute keys that no engine damage, weapon, or pickup path reads.

| Option / property | Default | Notes |
|---|---|---|
| `maxHealth` | `100` | Current health resets to max at `initialize`, `postLoad`, and `beginPlay`. |
| `healthRegen` | `1` per second | Heals every `tickPrePhysics` while below max. Set `0` for most games. |
| `attackCooldown` | `1.0` s | Stat only; nothing in the engine reads it automatically. |
| `attackRange` | `2.0` | Stat only. |
| `attackDamage` | `10` | Stat only. |
| `speed` | `5.0` | Stat only. |

Methods:
- `takeDamage(amount, hitInfo?) → number` returns damage actually dealt. Returns `0` when already dead. Clamps at 0, fires `onHealthChanged(current, max)`, and at 0 sets dead, fires `onDeath(hitInfo)`, then calls `handleDeath(hitInfo)`.
- `heal(amount) → number` returns the amount healed. No-op when dead or amount is 0. Fires `onHealthChanged`.
- `revive(health = maxHealth)` clears dead, clamps health to `[1, maxHealth]`, fires `onHealthChanged`, and fires `onRevive` if it was dead.
- Getters: `getIsDead`, `getMaxHealth`, `getCurrentHealth`, `getHealthRegen`, `getAttackCooldown`, `getAttackRange`, `getSpeed`, `getAttackDamage`.
- Setters: `setMaxHealth` (clamps current and fires `onHealthChanged`), `setHealthRegen`, `setAttackCooldown`, `setAttackRange`, `setSpeed`, `setAttackDamage`.
- `protected handleDeath(hitInfo?)` destroys `getRoot()` by default, synchronously, inside the `takeDamage` call that killed it. Override it on every root that needs a death beat or must survive death.

`DamageHitInfo` = `{ hitLocation: THREE.Vector3; hitNormal: THREE.Vector3 }`. `Projectile` and `InstantHitWeaponNode` pass it. `MeleeAttackAction` passes nothing, so guard for `undefined` before spawning a hit effect.

Who calls `takeDamage`: `Projectile.onHit`, `InstantHitWeaponNode.applyDamage`, and `MeleeAttackAction`. `HealthPickupNode` calls `heal` and only accepts pawns that have this node. `HpAbovePercentCondition` and `TargetBelowHpPercentCondition` read it.

## Patterns

**Player health.** Subclass as `Health` below (i-frames and a team). Set `healthRegen: 0`. Override `handleDeath` to keep the pawn.

Source: .engine/src/nodes/CharacterStatsNode.ts (`takeDamage` public, `handleDeath` protected) — typechecked against 18.1.0-alpha.317
```ts
@ENGINE.GameClass()
export class Health extends ENGINE.CharacterStatsNode {
  @ENGINE.property() public team: number = 0;
  @ENGINE.property() public invulnerableSeconds: number = 0.6;
  private invulnerableUntil = 0;

  public override takeDamage(amount: number, hit?: ENGINE.DamageHitInfo): number {
    const now = this.getWorld()?.getGameTime() ?? 0;
    if (now < this.invulnerableUntil) return 0;
    const dealt = super.takeDamage(amount, hit);
    if (dealt > 0) this.invulnerableUntil = now + this.invulnerableSeconds;
    return dealt;
  }

  protected override handleDeath(): void {
    // Keep the root. The GameMode listens to onDeath and opens the result screen.
  }
}
```

The rest of the player flow: The GameMode subscribes to `onDeath` and moves to the result state (`genesys-game-boot`). On Retry, call `revive()` or respawn the pawn.

Source: .engine/demos/examples/side-scroller-advanced/player.ts
```ts
public override beginPlay(): boolean {
  if (!super.beginPlay()) return false;
  this.add(ENGINE.CharacterStatsNode.create({ maxHealth: 100, healthRegen: 0 }));
  return true;
}
```

**Enemy health.** Created with the enemy root. The GameMode counts kills from `onDeath`. The demo uses the base class, so its enemies vanish on the killing frame; for a death beat use `EnemyHealth` (below) in place of `CharacterStatsNode`.

Source: .engine/demos/examples/fps-advanced/enemies.ts, game-mode.ts
```ts
this.healthNode = ENGINE.CharacterStatsNode.create({
  name: 'HealthStats', maxHealth: 100, healthRegen: 0,
});
this.add(meshNode, this.healthNode);
// GameMode:
enemy.getNode(ENGINE.CharacterStatsNode)?.onDeath.add(() => this.onEnemyKilled());
```

**Health bars and damage numbers.** HUD bar: `ProgressBar` updated from `onHealthChanged`. Overhead enemy bars and floating damage numbers are world-space UI (`UI3DNode` hosting a `ProgressBar` or text, as in fps-advanced `enemies.ts`); `genesys-ui` owns the recipe, placement, and styling.

**Lives.** Keep a lives count in the GameMode. On player `onDeath`, decrement, then `revive()` and move the pawn to its spawn point, or open the result at 0.

**Invulnerability windows.** The engine has no i-frame field. Override `takeDamage` and compare `world.getGameTime()` against an `invulnerableUntil` time (`Health`, above). Show the window: blink the mesh at 10–15 Hz or tint it. A window nobody can see reads as a bug.

**Teams and friendly fire.** The engine has no team concept. Add a `team` number to your stats subclass. Check it in `Projectile.onHit` and `InstantHitWeaponNode.applyDamage` overrides, and in your melee query loop.

**Damage modifiers** (armor, crits, headshots, falloff). Compute them in the attacker's override (`applyDamage` has the `PhysicsQueryHit` with `hitNode`, so you can check for a head collider). Keep `takeDamage` as the single entry point on the receiver.

**Knockback.** Character pawns (player and enemies) are kinematic, so physics velocity writes do nothing to them: use the knockback recipe in `genesys-movement` (jump-and-knockback reference). Dynamic props get a velocity change (`pushBody`, `genesys-physics`).

**Hit feedback.** Hit flash (per-instance material clone or scale pop), hitstop, and screen shake are owned by `genesys-game-feel`; call them from `onHealthChanged` when health went down.

## Death flow

1. `onDeath` fires before `handleDeath`. The root still exists, so read its position here.
2. Reaction (in `onDeath` listeners): VFX burst plus sound at the hit location or the root position (`genesys-vfx`, `genesys-audio`), and the creature's death beat — a death clip if the model has one, else a tip-over/shrink tween (`genesys-creatures`). For big moments, add hitstop or shake (`genesys-game-feel`).
3. Stop mattering (in `handleDeath`): `root.overridePhysicsOptions({ enabled: false })` so shots pass through, stop the brain (`getNode(ENGINE.BehaviorTreeNode)?.stopBehaviorTree()`), stop movement (`NpcMovementNode.stop()` or `AIController.stopMovement()`).
4. Remove (in `handleDeath`): `world.timerSystem.setTimeout(() => root.destroy(), 0.5)` (seconds), or hide and recycle it (the fps-advanced weapon pickup hides with `visible = false` and disables physics, then re-enables on a timer).

Steps 3–4 replace the default `handleDeath`. With the base class, the root is already destroyed when step 2 ends, so a timer in `onDeath` never matters and nothing can play on the body.

Source: Composed — typechecked against 18.1.0-alpha.317 (`CharacterStatsNode.handleDeath`, `TimerSystem.setTimeout`, `BehaviorTreeNode.stopBehaviorTree`)
```ts
@ENGINE.GameClass()
export class EnemyHealth extends ENGINE.CharacterStatsNode {
  @ENGINE.property() public team: number = 1;
  @ENGINE.property() public removeAfterSeconds: number = 0.5;  // the death beat

  // Replaces the default (destroy the root this frame). onDeath listeners already ran:
  // they play the reaction and count the kill while the body still exists.
  protected override handleDeath(): void {
    const root = this.getRoot();
    const world = this.getWorld();
    if (!root || !world) { root?.destroy(); return; }
    root.overridePhysicsOptions({ enabled: false });          // shots pass through
    root.getNode(ENGINE.BehaviorTreeNode)?.stopBehaviorTree(); // stops acting
    root.getNode(ENGINE.NpcMovementNode)?.stop();              // stops walking
    world.timerSystem.setTimeout(() => root.destroy(), this.removeAfterSeconds);
  }
}
```

GSS enemies stop with `AIController.stopMovement()` instead of `NpcMovementNode.stop()`.

## Multiplayer

Damage and death are authoritative. Apply `takeDamage` only where `node.hasAuthority()` is true (server or standalone). Replicate health to clients and play reactions on every client. `AIController` sets `replicated = false` because AI runs on the authority. The replication, RPC, and spawner details are in `genesys-multiplayer`.

## Bugs

- Player health creeps back up → `healthRegen` defaults to 1/s → set `healthRegen: 0`.

## Traps

- The player pawn vanishes at 0 HP and the game hangs → default `handleDeath` destroyed the root → `Health` with an empty `handleDeath`; let the GameMode open the result.
- Damage lands but the target never reacts → no `CharacterStatsNode` on the hit **root** (engine paths call `hitRoot.getNode(CharacterStatsNode)`) → add it to the root, not to a deep child of another root. A code-built root that is not a pawn needs `isRoot` (`genesys-engine`).
- A dead enemy still blocks shots → the collider outlived the death → `EnemyHealth` disables it.
- Enemy cooldowns finish during pause or ignore slow motion → a custom action times with `Date.now()` → use `blackboard.getGameTime()`, as `ShootAction`, `MeleeAttackAction`, and `WaitAction` do (`behavior-tree`).
