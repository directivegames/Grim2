import * as ENGINE from '@gnsx/genesys.js';

/** Read current world slomo scale (1 = normal). */
export function getWorldSlomo(world: ENGINE.World): number {
  const slomo = (world as unknown as { slomo?: number }).slomo ?? 1;
  return slomo > 0 ? slomo : 1;
}

/**
 * Convert tick deltaTime (scaled by world.slomo) back to real seconds.
 * Use for timers that should expire in wall-clock time while slomo is active.
 */
export function getUnscaledDeltaTime(world: ENGINE.World, scaledDeltaTime: number): number {
  return scaledDeltaTime / getWorldSlomo(world);
}
