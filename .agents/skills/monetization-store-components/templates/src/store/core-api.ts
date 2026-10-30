/**
 * Where the game's items live: tsb-core-api, one deployment per platform
 * environment. The game picks it from the host it runs on. Core knows players
 * only by their Studio login, so this file also says where a player can sign in to Studio.
 *
 * Platform-owned, not a creator setting: store updates overwrite this file
 * (store-config.ts is the one they keep). To test another core build, set
 * localStorage 'store.coreApiUrl' in the browser console.
 */
export const CORE_API_URLS = {
  production: 'https://api-v2.sandbox.game',
  staging: 'https://api-v2-staging.sandbox.game',
  dev: 'https://api-v2-dev.sandbox.game',
} as const;

export type CoreEnvironment = keyof typeof CORE_API_URLS;

/**
 * The dev stack: the dev editor, its CDN bucket, the dev platform site, and
 * local development (the local editor signs in to the dev realm).
 */
const DEV_HOSTS: ReadonlySet<string> = new Set([
  'genesys-preprod.sandbox.game',
  'cdn-studio-dev.sandbox.game',
  'demo.sandbox.game',
  'localhost',
  '127.0.0.1',
]);

/** The staging stack: the staging editor and its CDN bucket. */
const STAGING_HOSTS: ReadonlySet<string> = new Set([
  'genesys-staging.sandbox.game',
  'cdn-studio-staging.sandbox.game',
  'nonprod.sandbox.game',
]);

/** Studio editors. Their /auth/signin gives the page the Studio login core needs. */
const STUDIO_HOSTS: ReadonlySet<string> = new Set([
  'studio.sandbox.game',
  'genesys-staging.sandbox.game',
  'genesys-preprod.sandbox.game',
]);

/**
 * dev and staging on their own hosts, production everywhere else: studio and
 * sandbox.game, and the editor CDN that preprod and live share (its host
 * cannot tell them apart).
 */
export function coreEnvironmentFor(hostname: string | undefined): CoreEnvironment {
  const host = hostname?.toLowerCase() ?? '';
  if (DEV_HOSTS.has(host)) return 'dev';
  if (STAGING_HOSTS.has(host)) return 'staging';
  return 'production';
}

export function resolveCoreApiUrl(hostname: string | undefined): string {
  return CORE_API_URLS[coreEnvironmentFor(hostname)];
}

/**
 * The Studio sign-in page that brings the player back to this page, or null
 * when the game does not run on a Studio editor host.
 */
export function studioSignInUrl(location: { hostname: string; origin: string; pathname: string; search: string }): string | null {
  if (!STUDIO_HOSTS.has(location.hostname.toLowerCase())) return null;
  return `${location.origin}/auth/signin?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`;
}
