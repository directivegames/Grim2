/**
 * In-game store for Sandbox games (monetization-store skills).
 *
 *   const store = await installStore(world);          // in GameMode.beginPlay
 *   store.controller.on('purchased', ({ sku }) => …); // react in gameplay
 *   store.destroy();                                   // in GameMode.endPlay
 */
export { installStore, type InstalledStore } from './install-store.js';
export { storeConfig, resolveGameId, type StoreConfig } from './store-config.js';
export {
  StoreClient,
  StoreApiError,
  type GameItem,
  type InventoryItem,
  type SessionInfo,
  type Price,
  type Currency,
  type Balance,
  type AcquireResult,
} from './store-client.js';
export {
  StoreController,
  type StoreState,
  type StorePhase,
  type StoreTab,
  type ItemView,
  type StoreEvents,
} from './store-controller.js';
