/**
 * Engine 10.13's `BasePawnMovementComponent.tickPrePhysics/tickPostPhysics` calls
 * `owner?.getMovementPredictor()` on the owning actor. That method only exists on
 * `Pawn`, so any `MovementComponent` attached to a plain `Actor` (e.g. zombies
 * with `NpcMovementComponent`) crashes with:
 *
 *   TypeError: t?.getMovementPredictor is not a function
 *
 * Add a no-op `getMovementPredictor` to `Actor.prototype` so the engine's null
 * check (`if (owner && actorPredictor)`) skips the predictor block cleanly.
 */
import * as ENGINE from '@gnsx/genesys.js';

const PATCHED = '__grimActorPredictorPatched' as const;

function applyPatch(): void {
  const proto = (ENGINE.Actor as unknown as { prototype: Record<string, unknown> }).prototype;
  if (proto[PATCHED]) return;

  if (typeof proto.getMovementPredictor !== 'function') {
    proto.getMovementPredictor = function (): null {
      return null;
    };
  }

  proto[PATCHED] = true;
}

applyPatch();
