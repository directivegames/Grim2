/**
 * Where Get Silicon sends the player, per platform environment (Q30). Silicon
 * is sold only on this Sandbox page, never inside a game; the store opens it
 * in a new tab and picks up the new balance when the player comes back.
 *
 * Platform-owned, not a creator setting: store updates overwrite this file
 * (store-config.ts is the one they keep). An empty value makes Get Silicon
 * report TOP_UP_NOT_CONFIGURED.
 *
 * Both point at sandbox.game/balance (2026-10-12); there is no separate dev
 * page yet.
 */
export const SILICON_TOP_UP_URLS: { production: string; dev: string } = {
  production: 'https://sandbox.game/balance',
  dev: 'https://sandbox.game/balance',
};
