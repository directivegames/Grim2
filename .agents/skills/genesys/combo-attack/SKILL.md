# combo-attack

A three-hit melee combo state machine for an isometric action game. The player clicks or holds LMB to chain hits. Each hit sweeps through an arc aimed at the mouse cursor. Input is buffered so clicking during a swing queues the next hit rather than dropping it. Hit detection fires via callback so you wire your own damage/VFX logic.

---

## How it works

The state machine has four phases in sequence: `idle → windup → swing → recovery`.

The combo index (0, 1, 2) cycles after each completed swing. You define the arc for each index: Grim uses 180° right-to-left, 180° left-to-right, then a full 360°.

Input buffering: clicking during `windup`, `swing`, or `recovery` sets a queued flag. Holding LMB has the same effect. Both chain automatically into the next hit as soon as the recovery finishes.

---

## 1. Create the combo instance

Copy `ComboAttack.ts` from this skill's assets. Construct it once in your actor's `beginPlay`:

```ts
import { ComboAttack, type ComboCallbacks } from './ComboAttack.js';

const callbacks: ComboCallbacks = {
  onWindupStart(comboIndex, startAngle) {
    // show wind-up indicator, lock arc color
  },
  onSwingStart(comboIndex, startAngle, endAngle) {
    // reveal weapon mesh, start slash trail, play sound
  },
  onSwingProgress(comboIndex, orbitAngle, progress) {
    // update weapon position, collect hits this frame
  },
  onSwingEnd(comboIndex) {
    // hide weapon mesh, stop slash trail
  },
};

this._combo = new ComboAttack(callbacks);
```

---

## 2. Tick every frame

Call `tick(dt, playerPos, aimAngle)` in your actor's `tickPrePhysics`. `aimAngle` is the yaw from the player toward the mouse cursor (see `references/arc-math.md`).

```ts
const aimAngle = resolveAimAngle(world, player);
this._combo.tick(deltaTime, playerPos, aimAngle);
```

---

## 3. Handle left mouse input

Wire `ENGINE.IInputHandler` (see the `ability-key-binding` skill) and call these:

```ts
// LMB down
this._combo.onMouseDown();

// LMB up
this._combo.onMouseUp();
```

---

## 4. Detect hits inside onSwingProgress

The combo does not do hit detection — you call your own spatial query inside `onSwingProgress`. Use `orbitAngle` to compute the blade tip position:

```ts
onSwingProgress(comboIndex, orbitAngle, progress) {
  const tipX = playerPos.x + Math.cos(orbitAngle) * BLADE_REACH;
  const tipZ = playerPos.z + Math.sin(orbitAngle) * BLADE_REACH;
  const tipPos = new THREE.Vector3(tipX, playerPos.y + WEAPON_HEIGHT, tipZ);

  for (const enemy of spatialQuery(tipPos, HIT_RADIUS)) {
    enemy.takeDamage(damage, { hitLocation: tipPos });
  }
},
```

Use a `Set` to track which enemies were hit this frame and a per-enemy cooldown map to prevent multiple hits per swing. See `references/hit-detection.md`.

---

## 5. Resolve mouse aim angle

```ts
import { resolveAimAngle } from './ComboAttack.js';

const aimAngle = resolveAimAngle(world, player, groundY);
// returns yaw in radians from +Z toward the mouse cursor ground intersection
// falls back to player facing yaw when no mouse hit
```

---

## 6. Release input on pause or map exit

```ts
this._combo.releaseCombatInput();
```

Clears hold and queued flags, resets to idle, and fires `onSwingEnd` if mid-swing.

---

## Constraints

- Call `tick` exactly once per `tickPrePhysics`. Do not call it in `tickPostPhysics`.
- `onSwingProgress` is called every frame during a swing — keep it cheap. Use a per-enemy cooldown map to cap hit frequency.
- The combo does not manage weapon visuals — do all mesh positioning inside `onWindupStart` and `onSwingProgress`.
- Do not hold a reference to `orbitAngle` outside the callback; it changes each frame.
- To block the combo (e.g. transformation active, dead), call `releaseCombatInput()` and skip calling `onMouseDown`.
