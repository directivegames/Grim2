/**
 * Global combat tuning — enemy pressure vs soul heal / upgrades.
 */

/** Applied on top of per-risk enemyDamageMult in MissionRunner. */
export const ENEMY_DAMAGE_GLOBAL_MULT = 1.25;

/** NewZombieActor melee damage before risk scaling. */
export const ZOMBIE_BASE_ATTACK_DAMAGE = 14;

/** BigUndead vomitball damage before risk scaling. */
export const BIG_UNDEAD_BASE_PROJECTILE_DAMAGE = 20;

/** Demonbox explosion blast damage before risk scaling. */
export const DEMONBOX_BASE_BLAST_DAMAGE = 35;

/** Postman boss max health at risk 2 (scaled further per risk tier). */
export const POSTMAN_BOSS_BASE_HEALTH = 800;

/** Demonletter projectile damage before risk scaling. */
export const POSTMAN_BOSS_BASE_BULLET_DAMAGE = 18;

/** Postman strafe / reposition speed before risk scaling. */
export const POSTMAN_BOSS_BASE_MOVE_SPEED = 2.5;

/** Demonletter travel speed before risk scaling. */
export const POSTMAN_BOSS_BASE_BULLET_SPEED = 18;
