/**
 * The editor / harness can bundle its own copy of `@gnsx/genesys.js` without our
 * `node_modules` edits. Zombie horde logic needs follow-target world offsets on
 * `NpcMovementComponent`; if those methods are missing at runtime, install them here.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const PATCHED = '__grimNpcFollowOffsetPatched' as const;
const OFFSET_VEC_KEY = '__grimFollowTargetWorldOffset' as const;

const pathGoalScratch = new THREE.Vector3();

function offsetVec(self: Record<string, unknown>): THREE.Vector3 {
  let v = self[OFFSET_VEC_KEY] as THREE.Vector3 | undefined;
  if (!v) {
    v = new THREE.Vector3(0, 0, 0);
    self[OFFSET_VEC_KEY] = v;
  }
  return v;
}

function patchedUpdateActorFollowingTarget(this: any, currentPosition: THREE.Vector3): void {
  if (!this.actorToFollow) return;

  const actorPosition = new THREE.Vector3();
  this.actorToFollow.rootComponent.getWorldPosition(actorPosition);
  const distanceToActor = currentPosition.distanceTo(actorPosition);

  const hold = this.actorFollowingDistance;
  const Ctor = ENGINE.NpcMovementComponent as unknown as { ACTOR_FOLLOW_HOLD_HYSTERESIS_OUT?: number };
  const hOut = Ctor.ACTOR_FOLLOW_HOLD_HYSTERESIS_OUT ?? 0.14;

  if (distanceToActor <= hold) {
    this.actorFollowHoldLatched = true;
  } else if (distanceToActor > hold + hOut) {
    this.actorFollowHoldLatched = false;
  }

  if (this.actorFollowHoldLatched) {
    this.targetPosition = null;
    if (!this.continueFollowingAfterReached) {
      this.actorToFollow = null;
    }
    return;
  }

  const pathGoal = pathGoalScratch.copy(actorPosition).add(offsetVec(this));
  if (this.shouldRecalculatePathToActor(pathGoal)) {
    this.calculateAndSetPathToPosition(pathGoal);
  }
}

function applyPatch(): void {
  // Avoid casting `NpcMovementComponent.prototype` directly (strict SDK tsconfig rejects it).
  const proto = (ENGINE.NpcMovementComponent as any).prototype as Record<string, unknown>;
  if (proto[PATCHED]) return;

  if (typeof proto.clearFollowTargetWorldOffset === 'function') {
    proto[PATCHED] = true;
    return;
  }

  proto.setFollowTargetWorldOffset = function (this: any, v: THREE.Vector3): void {
    offsetVec(this).copy(v);
  };
  proto.clearFollowTargetWorldOffset = function (this: any): void {
    offsetVec(this).set(0, 0, 0);
  };

  proto.updateActorFollowingTarget = patchedUpdateActorFollowingTarget;

  const wrap = (name: string, after?: (self: any) => void): void => {
    const orig = proto[name] as (...args: any[]) => unknown;
    if (typeof orig !== 'function') return;
    proto[name] = function (this: any, ...args: any[]) {
      const r = orig.apply(this, args);
      after?.(this);
      return r;
    };
  };

  wrap('stop', self => offsetVec(self).set(0, 0, 0));
  wrap('setTargetPosition', self => offsetVec(self).set(0, 0, 0));
  wrap('followActor', self => offsetVec(self).set(0, 0, 0));

  const origSetTargetActor = proto.setTargetActor as (this: any, ...args: any[]) => unknown;
  proto.setTargetActor = function (this: any, actor: unknown, ...rest: any[]) {
    if (!actor) offsetVec(this).set(0, 0, 0);
    return origSetTargetActor.call(this, actor, ...rest);
  };

  proto[PATCHED] = true;
}

applyPatch();
