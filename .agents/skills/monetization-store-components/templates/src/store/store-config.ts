/**
 * Version of the store templates. Shown in the panel footer and logged at
 * start, so a build can be told apart from an older one. The install script
 * compares it with the shipped templates.
 */
export const STORE_VERSION = '2.1.0';

/**
 * Store configuration for this game. `gameId` is filled from
 * `<project>.genesys-project` by the install script; the other values are the
 * creator's choices and survive template updates.
 */
export interface StoreConfig {
  /**
   * Genesys game id from `<project>.genesys-project`. Used when the runtime id
   * is a placeholder (play-in-editor passes "editor", `pnpm dev` passes
   * "dev-game"); a published game always receives its real id at runtime.
   */
  gameId: string;
  /**
   * Store API base URL (session, balance, Test Silicon). One deployment serves
   * dev and production. Items come from core, picked by host in core-api.ts.
   */
  apiBaseUrl: string;
  /** Keyboard key that toggles the store (lower-case). null disables the hotkey. */
  hotkey: string | null;
  /** Show the always-visible HUD chip (balance + Shop button). false: call store.open() yourself. */
  showHudChip: boolean;
  hudPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  /** Optional accent color for primary buttons and the active tab; null keeps the kit blue. */
  accent: string | null;
  /** Low-opacity line in the panel footer: signed-in state, user id, environment, game id. */
  showSessionInfo: boolean;
}

export const storeConfig: StoreConfig = {
  gameId: '',
  apiBaseUrl: 'https://api-store.sandbox.game',
  hotkey: 'b',
  showHudChip: true,
  hudPosition: 'top-right',
  accent: null,
  showSessionInfo: true,
};

/** Runtime game ids that do not identify a real game. */
export const PLACEHOLDER_GAME_IDS: ReadonlySet<string> = new Set(['editor', 'dev-game', 'default', 'local', '']);

/**
 * The page says where the game runs: the published play page sets
 * `_genesys_is_published_game_` before the game starts. Without it (editor
 * play, local folder, dev server) the store is in the editor: Test Silicon,
 * drafts visible.
 */
export function storeContextOf(page: { _genesys_is_published_game_?: unknown } = globalThis as { _genesys_is_published_game_?: unknown }): 'editor' | 'game' {
  return page._genesys_is_published_game_ === true ? 'game' : 'editor';
}

export type GameIdSource = 'runtime' | 'config' | 'none';

export interface ResolvedGameId {
  gameId: string | null;
  source: GameIdSource;
  /** True when the runtime id is real but differs from the configured one. */
  mismatch: boolean;
}

/**
 * A real runtime id (published game) wins; otherwise the configured id
 * (editor, local dev); otherwise the store stays unlinked.
 */
export function resolveGameId(
  runtimeGameId: string | null | undefined,
  configuredGameId: string,
): ResolvedGameId {
  const runtime = runtimeGameId?.trim() ?? '';
  const configured = configuredGameId.trim();
  const runtimeIsReal = !PLACEHOLDER_GAME_IDS.has(runtime);
  const configuredIsReal = !PLACEHOLDER_GAME_IDS.has(configured);

  if (runtimeIsReal) {
    return { gameId: runtime, source: 'runtime', mismatch: configuredIsReal && configured !== runtime };
  }
  if (configuredIsReal) {
    return { gameId: configured, source: 'config', mismatch: false };
  }
  return { gameId: null, source: 'none', mismatch: false };
}
