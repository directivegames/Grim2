import * as THREE from 'three';

export const ZOMBIE_STEER_LOOKAHEAD = 2.5;
export const ZOMBIE_STEER_GOAL_STOP = 0.12;
export const ZOMBIE_STEER_SEPARATION_RADIUS = 0.88;
export const ZOMBIE_STEER_SEPARATION_WEIGHT = 2.0;
export const ZOMBIE_STEER_GOAL_MIN_XY_FROM_AGENT = 0.35;

/** Orbit only when close — seek dominates until zombies are in a tight ring around the player. */
export const ZOMBIE_STEER_TANGENTIAL_WEIGHT = 0.75;
export const ZOMBIE_STEER_TANGENTIAL_MIN_DIST = 1.25;
export const ZOMBIE_STEER_TANGENTIAL_MAX_DIST = 3.5;
export const ZOMBIE_STEER_TANGENTIAL_ATTACK_FADE = 1.5;

export interface ZombieSteerScratch {
  toPlayer: THREE.Vector3;
  separation: THREE.Vector3;
  tangential: THREE.Vector3;
  combined: THREE.Vector3;
  goal: THREE.Vector3;
  goalDelta: THREE.Vector3;
}

export function createZombieSteerScratch(): ZombieSteerScratch {
  return {
    toPlayer: new THREE.Vector3(),
    separation: new THREE.Vector3(),
    tangential: new THREE.Vector3(),
    combined: new THREE.Vector3(),
    goal: new THREE.Vector3(),
    goalDelta: new THREE.Vector3(),
  };
}

/** Stable +1 or -1 orbit direction from an arbitrary seed. */
export function tangentialSignFromSeed(seed: number): number {
  return Math.abs(Math.floor(seed * 17.31)) % 2 === 0 ? 1 : -1;
}

/** Tangential weight 0..max based on distance band and attack-range fade. */
export function computeTangentialWeight(distToPlayer: number, attackRange: number): number {
  if (distToPlayer < ZOMBIE_STEER_TANGENTIAL_MIN_DIST) {
    return 0;
  }

  const ringT = THREE.MathUtils.clamp(
    (distToPlayer - ZOMBIE_STEER_TANGENTIAL_MIN_DIST) /
      (ZOMBIE_STEER_TANGENTIAL_MAX_DIST - ZOMBIE_STEER_TANGENTIAL_MIN_DIST),
    0,
    1,
  );
  const attackFade = THREE.MathUtils.clamp(
    (distToPlayer - attackRange) / ZOMBIE_STEER_TANGENTIAL_ATTACK_FADE,
    0,
    1,
  );
  return ringT * attackFade * ZOMBIE_STEER_TANGENTIAL_WEIGHT;
}

export function computeZombieSteerGoal(options: {
  myPos: THREE.Vector3;
  seekDir: THREE.Vector3;
  separation: THREE.Vector3;
  tangentialSign: number;
  distToPlayer: number;
  attackRange: number;
  scratch: ZombieSteerScratch;
}): THREE.Vector3 {
  const { myPos, seekDir, separation, tangentialSign, distToPlayer, attackRange, scratch } = options;

  const tangWeight = computeTangentialWeight(distToPlayer, attackRange);
  scratch.tangential.set(-seekDir.z * tangentialSign, 0, seekDir.x * tangentialSign);
  scratch.tangential.multiplyScalar(tangWeight);

  scratch.combined.copy(seekDir).add(separation).add(scratch.tangential);
  scratch.combined.y = 0;
  if (scratch.combined.lengthSq() < 1e-8) {
    scratch.combined.copy(seekDir);
  } else {
    scratch.combined.normalize();
  }

  scratch.goal.copy(scratch.combined).multiplyScalar(ZOMBIE_STEER_LOOKAHEAD).add(myPos);
  return scratch.goal;
}

export function ensureSteerGoalMinDistance(
  myPos: THREE.Vector3,
  goal: THREE.Vector3,
  fallbackDir: THREE.Vector3,
  scratch: THREE.Vector3,
): void {
  scratch.copy(goal).sub(myPos);
  scratch.y = 0;
  if (scratch.length() < ZOMBIE_STEER_GOAL_MIN_XY_FROM_AGENT) {
    goal
      .copy(myPos)
      .addScaledVector(
        fallbackDir,
        Math.max(ZOMBIE_STEER_LOOKAHEAD, ZOMBIE_STEER_GOAL_MIN_XY_FROM_AGENT),
      );
  }
}
