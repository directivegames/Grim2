/** Run souls required to trigger Grim Grinder (resets when used). */
export const GRIM_GRINDER_SOUL_THRESHOLD = 50;

/** How long Grim Grinder mode lasts (seconds). */
export const GRIM_GRINDER_DURATION_SEC = 20;

/** Contact radius for ramming enemies (world units). */
export const GRIM_GRINDER_CONTACT_RADIUS = 2.8;

/** Boss must move this far away before another 4% hit registers. */
export const GRIM_GRINDER_BOSS_RESET_RADIUS = 4.5;

/** Boss damage per contact as a fraction of max health. */
export const GRIM_GRINDER_BOSS_DAMAGE_FRAC = 0.04;

export const GRIM_GRINDER_SKILL_ID = 'grimGrinder';

/** Yaw offset so grimgrinder.glb forward matches iso movement (atan2 x,z). */
export const GRIM_GRINDER_CAR_YAW_OFFSET = Math.PI / 2;
