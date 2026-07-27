import * as THREE from 'three';

export const STEER_LOOKAHEAD = 2.5;
export const STEER_GOAL_STOP = 0.12;
export const STEER_SEPARATION_RADIUS = 0.88;
export const STEER_SEPARATION_WEIGHT = 2.0;
export const STEER_GOAL_MIN_XY_FROM_AGENT = 0.35;

/** Orbit only when close — seek dominates until agents are in a tight ring around the target. */
export const STEER_TANGENTIAL_WEIGHT = 0.75;
export const STEER_TANGENTIAL_MIN_DIST = 1.25;
export const STEER_TANGENTIAL_MAX_DIST = 3.5;
export const STEER_TANGENTIAL_ATTACK_FADE = 1.5;

/** Pre-allocated per-agent scratch vectors. Allocate once at spawn, reuse every tick. */
export interface CrowdSteerScratch {
  toTarget: THREE.Vector3;
  separation: THREE.Vector3;
  tangential: THREE.Vector3;
  combined: THREE.Vector3;
  goal: THREE.Vector3;
  goalDelta: THREE.Vector3;
}

export function createCrowdSteerScratch(): CrowdSteerScratch {
  return {
    toTarget: new THREE.Vector3(),
    separation: new THREE.Vector3(),
    tangential: new THREE.Vector3(),
    combined: new THREE.Vector3(),
    goal: new THREE.Vector3(),
    goalDelta: new THREE.Vector3(),
  };
}

/**
 * Returns a stable +1 or -1 orbit direction from an arbitrary seed.
 * Compute once per agent at spawn from a unique stable integer (e.g. spawn index).
 */
export function tangentialSignFromSeed(seed: number): number {
  return Math.abs(Math.floor(seed * 17.31)) % 2 === 0 ? 1 : -1;
}

/** Tangential weight 0..max based on distance band and attack-range fade. */
export function computeTangentialWeight(distToTarget: number, attackRange: number): number {
  if (distToTarget < STEER_TANGENTIAL_MIN_DIST) {
    return 0;
  }

  const ringT = THREE.MathUtils.clamp(
    (distToTarget - STEER_TANGENTIAL_MIN_DIST) /
      (STEER_TANGENTIAL_MAX_DIST - STEER_TANGENTIAL_MIN_DIST),
    0,
    1,
  );
  const attackFade = THREE.MathUtils.clamp(
    (distToTarget - attackRange) / STEER_TANGENTIAL_ATTACK_FADE,
    0,
    1,
  );
  return ringT * attackFade * STEER_TANGENTIAL_WEIGHT;
}

/**
 * Compute the nav goal for one agent for this frame.
 *
 * Returns `scratch.goal` (mutated in place) — do not store the reference, copy the value.
 * Always call `ensureSteerGoalMinDistance` after this function.
 */
export function computeCrowdSteerGoal(options: {
  myPos: THREE.Vector3;
  /** Normalised XZ direction toward the target. */
  seekDir: THREE.Vector3;
  /** Pre-summed repulsion vector from nearby agents. Build this yourself before calling. */
  separation: THREE.Vector3;
  tangentialSign: number;
  distToTarget: number;
  attackRange: number;
  scratch: CrowdSteerScratch;
}): THREE.Vector3 {
  const { myPos, seekDir, separation, tangentialSign, distToTarget, attackRange, scratch } = options;

  const tangWeight = computeTangentialWeight(distToTarget, attackRange);
  scratch.tangential.set(-seekDir.z * tangentialSign, 0, seekDir.x * tangentialSign);
  scratch.tangential.multiplyScalar(tangWeight);

  scratch.combined.copy(seekDir).add(separation).add(scratch.tangential);
  scratch.combined.y = 0;
  if (scratch.combined.lengthSq() < 1e-8) {
    scratch.combined.copy(seekDir);
  } else {
    scratch.combined.normalize();
  }

  scratch.goal.copy(scratch.combined).multiplyScalar(STEER_LOOKAHEAD).add(myPos);
  return scratch.goal;
}

/**
 * Clamp the nav goal so it is never placed inside the agent's own capsule.
 * Call this after `computeCrowdSteerGoal`.
 */
export function ensureSteerGoalMinDistance(
  myPos: THREE.Vector3,
  goal: THREE.Vector3,
  fallbackDir: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  scratch.copy(goal).sub(myPos);
  scratch.y = 0;
  if (scratch.length() < STEER_GOAL_MIN_XY_FROM_AGENT) {
    goal
      .copy(myPos)
      .addScaledVector(
        fallbackDir,
        Math.max(STEER_LOOKAHEAD, STEER_GOAL_MIN_XY_FROM_AGENT),
      );
  }
}
