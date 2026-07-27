# projectile-boomerang — Rationale

## Why outbound + homing rather than parabolic arc

A parabolic arc requires predicting where the player will be when the blade returns, which is usually wrong — the player moves. The two-phase approach (fixed direction outbound, constant-speed homing return) always returns to the player's current position. It feels reliable and satisfying because the player can "lead" the blade by moving.

## Why callbacks not actor subclassing

The blade state machine has no knowledge of weapon meshes, trails, or audio. Everything visual is driven by the callbacks. This means the same `BoomerangSystem` works whether you have a scene-placed weapon actor, an instanced mesh, or a plain `THREE.Mesh` — the caller wires them in `onBladeUpdate`.

## Why per-blade hitActors Set

A single global hit set would prevent a three-blade fan from hitting the same enemy with multiple blades simultaneously. The per-blade set allows this while still preventing a single blade from hitting the same enemy twice on one pass.

Clearing `hitActors` when transitioning to `returning` lets the return journey damage enemies for a second time — useful for "pierce on return" designs.

## Why fan spread is in the system

Multi-blade spread is almost always paired with boomerang projectiles (it matches the "throw spinning blades" fantasy). Including it in `launch()` rather than forcing the caller to loop means the caller only needs to track the `BoomerangSystem` instance, not an array of blade states.

## Combining with ability-key-binding

The boomerang ability is triggered by RMB in a typical setup. The `ability-key-binding` skill documents how to implement `ENGINE.IInputHandler` so you can route `handleMouseDown(MouseButton.Right)` to the launch logic alongside other mouse and key bindings.
