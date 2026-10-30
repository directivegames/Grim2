---
name: genesys-combat
description: "Weapons, projectiles, hitscan, melee, stomps, damage, health (CharacterStatsNode), hit detection, i-frames, teams, death, high-volume bullets, and firing on GSS pawns. Use when anything shoots, swings, or takes damage: guns, swords, bullets, HP, enemy death, player death. Not for enemy AI or waves (use `genesys-creatures`), knockback (use `genesys-movement`), hit flash, hitstop or shake (use `genesys-game-feel`), or damage numbers and health bars (use `genesys-ui`)."
metadata:
  tokens: 3263
---

# Combat

This skill owns how damage is dealt, detected, received, and resolved. The rule: **start from the engine's combat classes.** These are `ProjectileWeaponNode`, `InstantHitWeaponNode`, `Projectile`, `CharacterStatsNode`, and the physics queries. A hand-rolled projectile pool, a distance-based hit test, or a bare `health` field on a pawn is a defect unless the volume needs the instanced bullet field ([high-volume-projectiles](references/high-volume-projectiles.md)).

## Use another skill when
- Enemy brain, spawning, waves, the enemy baseline, death animation → `genesys-creatures`
- Behavior tree combat actions (`ShootAction`, `MeleeAttackAction`) API → `behavior-tree`
- Hit flash, hitstop, screen shake, fail/retry pacing → `genesys-game-feel`
- Knockback or launch on a character (player or enemy) → `genesys-movement`; pushing dynamic props → `genesys-physics`
- Hit sparks, muzzle flash, death burst → `genesys-vfx`
- Shot, impact, hurt, and death sounds → `genesys-audio`
- Health bar, ammo counter, crosshair, damage numbers, overhead enemy bars → `genesys-ui`
- Raw raycast, sweep, overlap, collision profiles, ignore pairs → `genesys-physics`
- Damage and death in an online game (authority, replication, server-side firing) → `genesys-multiplayer`
- Health pickups and ammo pickups → `genesys-interactions`
- Result screen when the player dies → `genesys-game-boot`
- A hitch on every shot or spawn → `genesys-profiler`

## Decide

Defaults by genre when the user did not say (full table with receivers and death rules: [genre-defaults](references/genre-defaults.md)):
- **Shooter (FPS/TPS):** `InstantHitWeaponNode` for rifles, `ProjectileWeaponNode` for slow or visible shots, parented to the pawn camera; `CharacterStatsNode` on every damageable root.
- **Melee brawler:** an `overlapShape` sphere in front of the attacker for 80–150 ms active frames, one hit per root per swing; 0.3–0.5 s i-frames.
- **Platformer stomp:** an overlap box under the feet while falling; 1 HP enemies.
- **Tower defense:** a weapon on the tower, `tryFireAtTarget(enemyPos)` at the closest enemy in range; creeps reaching the goal (`TriggerZoneNode`) cost base HP.
- **Twin-stick:** `ProjectileWeaponNode` with `tryFireAtTarget(aimPoint)` while fire is held; past ~150 live bullets, the instanced lane.
- **Bullet hell:** the instanced bullet field ([high-volume-projectiles](references/high-volume-projectiles.md)); player hitbox 30–50% of the visual, 1–2 s blinking i-frames.

Other defaults:
- Player stack: `DefaultCharacterPawn` + `DefaultPlayerController`, so firing needs no input code. A GSS pawn (online, or GSS abilities are the design) needs the controller recipe below.
- Health on every pawn, classic or GSS, is a `CharacterStatsNode`. `GSSTags.Health` and `GSSTags.Ammo` are registered attribute keys that no engine weapon, projectile, or pickup reads or writes; use them only if a custom GSS effect owns all damage (`genesys-movement`).
- Player HP 100, regen 0 (`CharacterStatsNode` defaults regen to **1 per second**; set `healthRegen: 0` unless the design wants regen).
- Player i-frames 0.5–1.0 s after a hit. Enemies get none unless they are bosses with phase changes.
- Friendly fire is off. Projectiles already ignore their owner. Teammates need a team check (below).
- Every projectile has `range` **and** `projectileLifespan`. A projectile with neither lives 10 s, the default lifespan: set limits that fit the shot.
- Third-person shooters: `BaseWeaponNode` aims each shot at whatever the screen-centre ray hits. Keep the over-the-shoulder camera near level (5–7° down, `genesys-camera`) and projectile `gravityScale` ≤ 0.15 unless arcs are the design. A steeper camera or heavy gravity lands every shot on the floor a few metres ahead.
- Every hit the player lands or takes gets at least two channels: VFX plus sound, and camera or UI for the big ones (`genesys-game-feel`).

## Build

**Never pay per spawn** (`genesys-profiler`): projectiles carry no light (a light per projectile recompiles every shader on spawn and destroy; glow is an emissive material plus bloom); `projectileOptions` geometry and material are created once per weapon, not per shot; fire one shot and one hit VFX during the title screen so the first real shot does not hitch.

### Weapons on a pawn

`DefaultCharacterPawn` and `GameplayPawn` implement `fire()`, `endFire()`, `altFire()`, `endAltFire()`, and `reload()`. Each forwards to the first child node that is `IEquipment`. `DefaultPlayerController` maps left mouse to fire, right mouse to alt-fire, `R` to reload, and `E` to interact. Add a weapon node to the pawn and firing works with no input code.

Source: .engine/demos/examples/fps-advanced/weapons.ts (trimmed) — typechecked against 18.1.0-alpha.317
```ts
@ENGINE.GameClass()
export class Blaster extends ENGINE.ProjectileWeaponNode {
  public override initialize(options?: ENGINE.ProjectileWeaponOptions): void {
    super.initialize({
      fireInterval: 0.15,          // seconds between shots while held
      isSingleFire: false,         // true = one shot per press
      ammoCapacity: 0,             // 0 = infinite ammo, no reload
      fireSoundUrl: '@engine/assets/sounds/laser.mp3',
      projectileSpawnOffset: new THREE.Vector3(0, -0.2, -0.8),
      projectileOptions: {
        velocity: 40, range: 60, projectileLifespan: 2,
        damageDealt: 10, destroyOnHit: true, useOverlapCheck: false,
        geometry: new THREE.SphereGeometry(0.1),
        material: new THREE.MeshStandardMaterial({ color: 0xffcc00 }),
      },
      ...options,
    });
  }
}
// FPS: parent to the camera so shots follow the view.
// pawn.camera.add(Blaster.create());
```

Hitscan is the same shape with `ENGINE.InstantHitWeaponNode` and `damage`, `range`, and `spread` (radians, 0–1). It calls `raycast` (no collision profile, nearest hit, shooter's root ignored), calls `takeDamage` on the hit root's `CharacterStatsNode`, spawns a `hitSparks` VFX, and fires `onHit(HitInfo)`.

### GSS pawns

`GSSCharacterPawn` is not an `ICombatPawn`, and `GSSPlayerController` has no fire input. Add the weapon as a child of the pawn, and subclass `GSSPlayerController` so left mouse calls `weapon.beginFire()` / `endFire()` and `R` calls `reload()` (the weapon is `getPawn()?.getNode(ENGINE.BaseWeaponNode)`); register it as the player controller. Online, this fires on the client only; route the shot through the server (`genesys-multiplayer`). Controller code: [weapons-and-projectiles](references/weapons-and-projectiles.md#gss-fire-controller).

### Receiving damage

Put one `CharacterStatsNode` on every damageable root. All engine damage paths look for it: `Projectile`, `InstantHitWeaponNode`, `MeleeAttackAction`, and `HealthPickupNode`. It owns `takeDamage(amount, hitInfo?)`, `heal`, `revive`, `getIsDead`, and the delegates `onHealthChanged(current, max)`, `onDeath(hitInfo?)`, and `onRevive`.

The default `handleDeath` **destroys the root in the same call**, right after `onDeath` fires, so nothing can play on the body afterwards. The player uses `Health` (a subclass whose `takeDamage` adds i-frames on `world.getGameTime()` and a `team`, and whose `handleDeath` is empty so the GameMode opens the result); enemies use `EnemyHealth` (death beat, then remove). Both: [damage-and-health](references/damage-and-health.md).

### Friendly fire

`Projectile` ignores collisions with every physics node of its `owner` (set by the weapon). For teams, override the protected hooks: `Projectile.onHit(node, otherNode, event)` and `InstantHitWeaponNode.applyDamage(target, damage, hitResult)`. Return early when both roots carry the same `team`. A blocking projectile (`useOverlapCheck: false`) still bounces off a teammate's body, so use `useOverlapCheck: true` if team shots should pass through.

### Melee and stomp

The engine has no player melee weapon node. During the active frames, run `overlapShape` with a sphere ~1.2 m in front of the attacker's **root** (`root.forwardDirection()` on a yawing root; the visual's world direction on a top-down pawn), with `ignoredRootNodes: [root]`, and damage each hit root once through a per-swing `Set`. A stomp is the same query with a box under the feet, run only while falling. Snippet: [hit-detection](references/hit-detection.md#melee-and-stomp).

### Death is a moment

`onDeath` fires while the body still exists: play the reaction there (VFX plus sound at the hit location, the creature's death beat from `genesys-creatures`), and let the GameMode count the kill (the fps-advanced demo subscribes to the enemy's `onDeath`). `EnemyHealth.handleDeath` then disables the collider, stops the brain and movement, and destroys the root after `removeAfterSeconds` (default 0.5 s, on `world.timerSystem`, in seconds). Keep the death beat shorter than that delay.

## Bugs

- Projectiles hang at the muzzle: [weapons-and-projectiles](references/weapons-and-projectiles.md#bugs). Player health creeps back up: [damage-and-health](references/damage-and-health.md#bugs).

## Limitations

- Clicking fires nothing on a GSS pawn → `GSSPlayerController` has no fire path → the controller subclass above.
- Knockback on hit does nothing → characters are kinematic → `genesys-movement` (jump-and-knockback reference).

## Traps

- Every throw or shot "explodes in the hand" → it hits the floor 10–20 m ahead within half a second: the camera pitches too far down, so the screen-centre aim point is on the ground. Projectiles fly straight (`gravityScale` defaults to 0); a non-zero `projectileOptions.gravityScale` (thrown objects, `ShotgunNode` 0.2) drops them further. Level the camera, lower that `gravityScale`, and log the first hits in the smoke test (`genesys-verification`).
- A hitch on every shot → something is created per projectile (a light, a material, a geometry) → `genesys-profiler` → *Never pay per spawn*.
- An enemy pops out of existence with no reaction, or a "remove after 0.4 s" timer in `onDeath` never matters → the default `handleDeath` already destroyed the root that frame → `EnemyHealth`.
- Contact damage drains the player in one touch → damage applied every tick (`enableStayEvents`, or a per-tick overlap query); enter / collide delegates fire once → i-frames in the `takeDamage` override.
- More traps: weapons (default projectiles, top-down aim into the floor, two weapons) in [weapons-and-projectiles](references/weapons-and-projectiles.md#traps); health and death (player vanishes at 0 HP, no reaction, dead enemy blocks shots, wall-clock cooldowns) in [damage-and-health](references/damage-and-health.md#traps); melee direction and self-hits in [hit-detection](references/hit-detection.md#traps).
- Hand-rolled projectile pool or `hull`/`hp` fields → reinvented engine code → `Projectile` plus `CharacterStatsNode`; the instanced lane only when volume demands it.

## Done

- `query_node` on each damageable root shows a `CharacterStatsNode` (or subclass) with the intended `maxHealth` and `healthRegen`.
- In Play: fire at an enemy. A hit shows VFX plus sound in the same frame, and its health bar or reaction moves. A miss despawns within `projectileLifespan`.
- Kill an enemy. Its death beat plays, it stops blocking shots, stops acting, and is removed. The score or wave count updates.
- Swing a melee attack with an enemy behind you: only the enemy in front takes damage, and you take none.
- Take damage. You see and hear it, and a second hit inside the i-frame window deals 0.
- Reach 0 HP. The result screen opens with Retry. Retry restores full health (`revive()` or a fresh pawn).
- Teammates (if any) take no damage from each other.
- Hold fire for 5 s: no frame hitch on the first shot or later ones (`genesys-profiler`). Bullet-heavy games show a stable frame time at the cap.

## References
- [genre-defaults](references/genre-defaults.md) — attack, hit detection, receiver and death per genre
- [weapons-and-projectiles](references/weapons-and-projectiles.md) — every weapon and projectile option, aiming, recoil/reload, the GSS fire controller, weapon bugs and traps
- [damage-and-health](references/damage-and-health.md) — `CharacterStatsNode` API, `Health` and `EnemyHealth`, i-frames, teams, death flow, revive, multiplayer authority, health bugs and traps
- [hit-detection](references/hit-detection.md) — collision events vs raycast vs overlap vs sweep, query shapes, the melee and stomp snippet
- [high-volume-projectiles](references/high-volume-projectiles.md) — where `Projectile` stops scaling, the instanced bullet field, caps and lifetime
