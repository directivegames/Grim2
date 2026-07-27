# projectile-boomerang

A projectile that flies outbound in a chosen direction, then homes back to the thrower. Supports multi-blade spread (fan of projectiles from a single launch), variable range, and skill-level gating. Hit detection fires via callback each frame. The visual (weapon mesh, trail) is managed by the caller.

---

## How it works

Each projectile (blade) has two phases. In the `outbound` phase it travels in a fixed direction at constant speed until it covers the configured range. In the `returning` phase it homes directly toward the player's current position. The blade is dismissed when it comes within the catch radius.

Multiple blades can be active at once. Launching again while blades are in flight either blocks (level 1–2 gate) or stacks additional blades (level 3 allows simultaneous throws).

---

## 1. Create the system

Copy `BoomerangSystem.ts` from this skill's assets. Construct once inside `beginPlay`:

```ts
import { BoomerangSystem, type BoomerangCallbacks } from './BoomerangSystem.js';

const callbacks: BoomerangCallbacks = {
  onBladeUpdate(blade) {
    // Move your weapon mesh / trail to blade.pos
    // Check hits against enemies near blade.pos
    weaponMesh.position.copy(blade.pos);
    trail.addPoint(blade.pos);
    checkHits(blade);
  },
  onBladeDismiss(blade) {
    // Hide weapon mesh, stop trail
    weaponMesh.visible = false;
    trail.stop();
  },
};

this._boomerang = new BoomerangSystem(callbacks);
```

---

## 2. Tick every frame

```ts
// Inside tickPrePhysics:
player.rootComponent.getWorldPosition(this._playerPos);
this._boomerang.tick(deltaTime, this._playerPos);
```

---

## 3. Launch

Resolve the aim direction (see `references/aim-resolution.md`), then call `launch`:

```ts
import { resolveAimDirection } from './BoomerangSystem.js';

const dir = new THREE.Vector3();
resolveAimDirection(world, player, groundY, dir);

this._boomerang.launch(launchPos, dir, {
  bladeCount: 3,          // 1 for single, 3 for fan spread
  spreadHalfAngle: 0.35,  // radians between outer blades and center (ignored for count=1)
});
```

Typical launch position: player world position offset upward by `BOOMERANG_HEIGHT` and forward along `dir` by `LAUNCH_OFFSET`.

---

## 4. Gate on skill level

Check active blade count before launching. Return early without launching when appropriate:

```ts
const level = vault.getSkillLevel('myProjectile');
if (level < 1) return;                                        // ability not unlocked
if (this._boomerang.hasActiveBlades() && level < 3) return;  // blades in flight, low level
if (this._boomerang.isCooldownActive(world.getGameTime())) return; // cooldown (level 3)
```

At level 3 you may want a cooldown rather than the "blades in flight" block. See `references/level-gating.md`.

---

## 5. Hit detection in onBladeUpdate

```ts
onBladeUpdate(blade) {
  const nearby = spatialQuery(blade.pos, HIT_RADIUS);
  for (const enemy of nearby) {
    if (!blade.hitActors.has(enemy)) {
      blade.hitActors.add(enemy);
      enemy.takeDamage(damage);
    }
  }
}
```

`blade.hitActors` is a `Set` on each blade so you can clear it on phase transition if you want the return pass to hit again:

```ts
onBladeUpdate(blade) {
  if (blade.phase === 'returning' && !blade.returnHitOpen) {
    blade.hitActors.clear();
    blade.returnHitOpen = true;
  }
  // ... hit check
}
```

---

## 6. Cooldown (level 3)

```ts
// At launch:
if (level >= 3) {
  this._lastThrowTime = world.getGameTime();
}

// Cooldown check:
isCooldownActive(now: number): boolean {
  return now - this._lastThrowTime < COOLDOWN_L3;
}
```

---

## Constraints

- Call `tick` once per `tickPrePhysics`. Blade positions update in tick, not in the callback.
- `onBladeUpdate` fires every frame per blade — keep it cheap.
- A single spatial query per blade per frame is fine; a physics sweep is not needed.
- The system does not manage visuals — you provide one mesh/trail per blade. Pre-allocate them for the max possible blade count.
- `launchPos` should be cloned before passing; the system stores it internally.
