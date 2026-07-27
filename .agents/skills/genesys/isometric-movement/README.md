# isometric-movement

Extracted from Grim2's player movement system (`src/components/movement/IsometricMovementComponent.ts`).

## Why the root never rotates

In a standard third-person pawn the root component rotates to face the movement direction. For isometric movement this causes camera flicker and quaternion math issues because the spring arm is attached to the root. Instead, this component keeps the root at yaw 0 at all times and the pawn rotates the visual mesh independently. The camera pivot is attached to the (non-rotating) root, so it stays perfectly stable.

## Why movement runs in tickPostPhysics

The character controller step happens at the end of the physics tick. Moving in `tickPrePhysics` would apply delta before the controller resolves collisions; `tickPostPhysics` applies it at the correct point so collision response and grounding detection are accurate.

## Why diagonal normalisation

Raw input (W+D) produces a vector of length √2. Without normalisation the player moves ~41% faster diagonally. The component normalises the input vector before computing velocity so all directions produce the same speed.

## The inputLocked pattern

Grim2 originally called a module-level `isGameplayUnlocked()` function from its pause system. The portable version replaces this with a `public inputLocked = false` property on the component. This removes the project-specific import and lets any project hook in their own pause/modal state without modifying the component.

The key invariant: the character controller must still run every frame even when input is locked, because (a) gravity must keep accumulating so the character is correctly grounded after a teleport, and (b) a teleport position queued via `teleportPosition` must be flushed on the next tick. Calling `resetRuntimeMotion` clears both of these, so it must not be used to implement locking.

## Source

Extracted from `src/components/movement/IsometricMovementComponent.ts` in Grim2. The only change is replacing `import { isGameplayUnlocked } from '../../utils/game-pause.js'` with a `public inputLocked = false` property. No movement logic was changed.
