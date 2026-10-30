# Weapons and projectiles

All classes live in `.engine/src/nodes/gameplay/` except `Projectile` (`.engine/src/entities/Projectile.ts`). Read the source for anything not listed here.

## Class map

| Class | Extends | What it adds |
|---|---|---|
| `IEquipment` (`Equipment.ts`) | interface | `beginFire`, `endFire`, `beginAltFire`, `endAltFire`, `reload`. `isEquipment(obj)` type guard. |
| `GenericEquipment` | `SceneNode` | Fire timing. `fireInterval` (s, default `0.5`), `isSingleFire` (default `false`). Abstract `doFire()`. Alt-fire and reload return `false`. |
| `BaseWeaponNode` | `GenericEquipment` | Model, sounds, ammo, reload, crosshair, recoil, camera aiming, `range` (default `1000`). Abstract. |
| `ProjectileWeaponNode` | `BaseWeaponNode` | Spawns a `Projectile` per shot. `onProjectileFired(projectile)`. |
| `InstantHitWeaponNode` | `BaseWeaponNode` | Raycast per shot. `damage` (default `25`), `spread` (radians, `0`–`1`, default `0`). `onHit(HitInfo)`. |
| `ShotgunNode` | `ProjectileWeaponNode` | Preset: engine shotgun model, `fireInterval` 1/1.5 s, single fire, 8 shells, 2.5 s reload, gold pellet (velocity 30, range 50, damage 25, gravityScale 0.2, overlap check), reload rotation animation, `shotgunMuzzleFlash` VFX. It fires **one** projectile per shot despite the file comment about multi-pellet spread. |
| `Projectile` | `PrimitiveNode` (root) | Dynamic body with CCD, collision events, owner ignore, range and lifespan expiry, damage on hit. |

## Fire timing (`GenericEquipment`)

- `beginFire()` sets a flag and checks immediately. `tickPrePhysics` keeps checking while the flag is set, and fires as many times as `fireInterval` allows since the last shot.
- `isSingleFire: true` fires once per `beginFire` until `endFire` resets the count.
- `tryFireAtTarget(pos)` (on `BaseWeaponNode`) sets a target, calls `beginFire()` then `endFire()`, and clears the target. Calling it every tick while a button is held gives rate-limited auto fire at `fireInterval`.
- An override of `tickPrePhysics` on a weapon must call `super.tickPrePhysics`: `GenericEquipment` runs `SceneNode` lifespan and `onTickPrePhysics` listeners there, then `checkFire`.

## `BaseWeaponOptions`

| Option | Default | Notes |
|---|---|---|
| `modelPath` | none | Loaded as a child `ModelMeshNode` named `WeaponMesh` with physics disabled. Engine example: `@engine/assets/models/Weapons/SM_ShotGun_01.glb`. |
| `modelTransform` | none | `{ position, rotation, scale }` for the weapon mesh. |
| `fireSpawnOffset` | none | Muzzle offset in the weapon's local space. |
| `crosshairOptions` | none | Creates a `Crosshair` UI widget (`size`, `color`, `accentColor`, `style`) **only** when the root is player controlled at `beginPlay`. |
| `ammoCapacity` | `0` | `0` = infinite, and reload is refused. |
| `reloadTime` | `2.0` s | Auto reload starts when the magazine empties. |
| `fireSoundUrl`, `emptyFireSoundUrl`, `reloadSoundUrl` | none | Built into a child `SoundNode` at `beginPlay`. Engine clips: `@engine/assets/sounds/laser.mp3`, `game-gun-short.mp3`, `explosion.mp3`. |
| `recoilOptions` | distance `0.1`, duration `0.15`, rotation `0.05` | Moves the weapon mesh back and pitches it up, then eases back. |
| `range` | `1000` | Max hitscan and camera-target distance. |

Ammo API: `getCurrentAmmo()`, `getMaxAmmo()`, `isAmmoInfinite()`, `setCurrentAmmo(n)` (clamped), `reload()`. Delegates: `onReloadStarted`, `onReloadCompleted`. While reloading, `canFire()` is false. Firing with an empty magazine plays the empty sound. Override `canFire()` or `canReload()` for custom rules.

## Aiming

`getFirePositionAndDirection()` uses the weapon's world position plus `fireSpawnOffset`. The direction is the root's `THREE.Camera` forward if the root has a camera. Otherwise it is the weapon node's `getWorldDirection()`, which is three's world **+Z** of the weapon, not the engine's −Z forward: a camera-less turret fires backwards unless its weapon is turned 180° or it fires with `tryFireAtTarget`.

`getTargetDirection()` then aims from the muzzle at `targetPosition` (set by `tryFireAtTarget`) or at `getTargetLocationFromCamera(range)`. That is a `raycast` from the camera center that ignores the owner root. This is what makes an FPS gun converge on the crosshair.

Other cameras:
- **Third person over the shoulder**: the camera ray still works. Put the weapon on the hand or the pawn and keep the camera on the pawn root.
- **Top-down, isometric, side view**: the camera looks at the ground, so shots go down or toward screen center. Call `tryFireAtTarget(aimPoint)` with the cursor's or stick's world point raised to muzzle height. Or override `getFirePositionAndDirection` to use the pawn's facing.
- **NPC**: `ShootAction` calls `tryFireAtTarget(targetWorldPosition)` on the first `ProjectileWeaponNode` it finds under the owner (`behavior-tree`).

## `ProjectileWeaponOptions`

| Option | Notes |
|---|---|
| `projectileOptions` | `WeaponProjectileOptions` = `ProjectileOptions` with `position` and `direction` optional. Optional: without it each shot fires `ProjectileWeaponNode.createDefaultProjectileOptions()`, a glowing round (radius 0.15 m) at 80 m/s that deals 10 damage and expires after 100 m or 3 s. Options you pass are used as given, with no defaults merged in, so set `velocity` and `range` yourself. A fixed `position` or `direction` here overrides the computed muzzle and aim. |
| `projectileClass` | Subclass of `Projectile` with a static `create`. Use it for team checks or custom hit effects. |
| `projectileSpawnOffset` | Extra offset added on top of `fireSpawnOffset`, rotated by the weapon. |

Each shot creates the projectile with `owner: this.getRoot()`, adds it to the world, fires `onProjectileFired`, consumes ammo, plays the fire sound, and applies recoil.

## `Projectile`

| Option | Default | Notes |
|---|---|---|
| `velocity` | none | Units per second. Set as linear velocity at `beginPlay`. No velocity means no movement. |
| `direction` | none | World direction (normalized). |
| `range` | none | Destroy after this distance from spawn (checked in `tickPostPhysics`). |
| `projectileLifespan` | `10` | Destroy after this many seconds (`setLifeSpan`); `0` means no time limit. |
| `damageDealt` | `0` | Applied to the hit root's `CharacterStatsNode` with `hitLocation`/`hitNormal` from the collision event. |
| `destroyOnHit` | `true` | Destroy on first contact (walls included). |
| `useOverlapCheck` | `false` | `false` = `BlockAll` profile, fires `onCollideWith`. `true` = `OverlapAll`, fires `onOverlapWith`, and passes through bodies. |
| `gravityScale` | `0` | Above 0 for lobbed shots and grenades. |
| `geometry`, `material` | sphere radius 0.5, default material | Child `MeshNode` named `Mesh` that contributes the collider. Keep bullets small (radius 0.05–0.2). |
| `owner` | weapon root | All physics nodes of the owner get `setNodeCollisionIgnore`. `getOwner()`, `setOwner(node)`. |
| `physicsOptions` | Dynamic, CCD, collision events | Merged last, so you can override any field. |

`onHit(node, otherNode, event)` is protected. It ignores hits on itself, destroys if `destroyOnHit`, then applies damage. Override it to add team checks, impact VFX, or sounds, and call `super.onHit`.

Source: .engine/demos/examples/fps-advanced/weapons.ts
```ts
@ENGINE.GameClass()
export class ImpactProjectile extends ENGINE.Projectile {
  protected override onHit(node: ENGINE.SceneNode, other: ENGINE.SceneNode, event: ENGINE.CollisionEvent): void {
    const at = this.getWorldPosition(new THREE.Vector3());
    super.onHit(node, other, event);
    // spawn impact VFX + sound at `at` (genesys-vfx, genesys-audio)
  }
}
```

## `InstantHitWeaponNode`

`doFire` → muzzle and direction → optional `applySpread` (random cone) → `performInstantHit` (`raycast` with the owner ignored) → `processHit` with the nearest hit.

`HitInfo`: `hitActor` (root or null), `hitLocation`, `hitNormal`, `distance`, `damageDealt`.

Overridable: `applyDamage(target, damage, hitResult)` (team checks, headshots, falloff) and `playHitEffect(hitInfo)` (replace the default yellow `hitSparks` burst). Add a visible tracer yourself (`genesys-vfx`); hitscan has no travel otherwise.

## Pawn wiring

- `GameplayPawn` and `DefaultCharacterPawn` implement `ICombatPawn` (`fire`, `endFire`, `altFire`, `endAltFire`, `reload`) by calling the matching `IEquipment` method on child nodes. They stop at the first node that returns `true`.
- `DefaultPlayerController` checks `isCombatPawn(pawn)` and maps left mouse → `fire`/`endFire`, right mouse → `altFire`/`endAltFire`, `R` → `reload`. It also maps gamepad buttons (see `.engine/src/entities/DefaultPlayerController.ts`).
- Base `Pawn`, `MovementPawn`, `CharacterPawn`, and `GSSCharacterPawn` do not implement `ICombatPawn`, and `GSSPlayerController` has no fire input (the `GSSTags.InputFire` tag is registered but nothing reads it). Call `weapon.beginFire()` / `endFire()` yourself from a controller subclass (*GSS fire controller*, below).
- Weapon swap (fps-advanced demo `player.ts`): destroy the old weapon node, `pawn.camera.add(newWeapon)`, and update the HUD.

## GSS fire controller

The short version is in [SKILL.md → GSS pawns](../SKILL.md#gss-pawns). The pawn holds the weapon as a child (`pawn.add(Blaster.create())` after spawning, or `this.add(...)` in a `GSSCharacterPawn` subclass's `initialize` after `super`); it aims along the pawn camera's screen-centre ray like any weapon. The controller forwards the buttons; register it as the player controller in the GameMode (`genesys-game-boot`). Online, this fires on the client only; route the shot through the server (`genesys-multiplayer`).

Source: Composed — typechecked against 18.1.0-alpha.317 (`GSSPlayerController.ts`, `PlayerController.handleMouseDown`, `GenericEquipment.beginFire`)
```ts
@ENGINE.GameClass()
export class GSSShooterController extends ENGINE.GSSPlayerController {
  private weapon(): ENGINE.BaseWeaponNode | null {
    return this.getPawn()?.getNode(ENGINE.BaseWeaponNode) ?? null;
  }
  public override handleMouseDown(button: ENGINE.MouseButton, e: MouseEvent): boolean {
    if (button === ENGINE.MouseButton.Left && this.weapon()?.beginFire()) return true;
    return super.handleMouseDown(button, e);
  }
  public override handleMouseUp(button: ENGINE.MouseButton, e: MouseEvent): boolean {
    if (button === ENGINE.MouseButton.Left && this.weapon()?.endFire()) return true;
    return super.handleMouseUp(button, e);
  }
  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'KeyR' && this.weapon()?.reload()) return true;
    return super.handleKeyDown(e);
  }
}
```

## Weapon HUD

Ammo and reload state come from `getCurrentAmmo()`, `getMaxAmmo()`, `onReloadStarted`, and `onReloadCompleted`. Build the HUD with the widgets in `genesys-ui`.

## Bugs

- Projectiles hang at the muzzle → `projectileOptions` without `velocity` → set `velocity` (and `range` or `projectileLifespan`).

## Traps

- Every shot is a small yellow round doing 10 damage → the weapon has no `projectileOptions` and fires the engine default → pass your own to `ProjectileWeaponNode.create()`.
- A top-down or side-view gun shoots into the floor or at screen center → `BaseWeaponNode` aims along the root's camera and raycasts from it → call `tryFireAtTarget(aimPoint)` with a world point at muzzle height, or override `getFirePositionAndDirection`.
- Two weapons on one pawn, only one fires → `callEquipment` stops at the first equipment that accepts → keep one active weapon; swap by destroying the old one (demo `setWeapon`).
