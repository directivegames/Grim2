import * as ENGINE from '@gnsx/genesys.js';

import { StoreClient } from './store-client.js';
import { PLACEHOLDER_GAME_IDS, storeConfig, type StoreConfig, STORE_VERSION } from './store-config.js';
import { StoreController } from './store-controller.js';
import { SILICON_TOP_UP_URLS } from './top-up.js';
import { PurchaseToast } from './ui/purchase-toast.js';
import { StoreHudButton } from './ui/store-hud-button.js';
import { StorePanel } from './ui/store-panel.js';

export interface InstalledStore {
  controller: StoreController;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

/** Keyboard: the configured hotkey toggles the store, Escape closes it. Ignored while typing. */
class StoreHotkeyHandler extends ENGINE.BaseInputHandler {
  constructor(
    private readonly hotkey: string | null,
    private readonly controller: StoreController,
  ) {
    super();
  }

  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.repeat || isTypingTarget(document.activeElement)) return false;
    const key = e.key.toLowerCase();
    if (key === 'escape' && this.controller.state.isOpen) {
      this.controller.close();
      return true;
    }
    if (this.hotkey && key === this.hotkey) {
      this.controller.toggle();
      return true;
    }
    return false;
  }
}

function isTypingTarget(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (element as HTMLElement).isContentEditable;
}

/** The creator's Keycloak token, present on the studio origin while editing. */
function readGenesysToken(): string | null {
  try {
    return window.localStorage.getItem('keycloak_access_token');
  } catch {
    return null;
  }
}

/**
 * Developer override for the API base URL, e.g. to test an API build that is
 * not deployed yet. In the browser console:
 *   localStorage.setItem('store.apiBaseUrl', '<another store API origin>')
 *   localStorage.removeItem('store.apiBaseUrl')   // back to the configured API
 */
function readApiBaseUrlOverride(): string | null {
  try {
    const value = window.localStorage.getItem('store.apiBaseUrl')?.trim();
    return value && /^https?:\/\//.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Wires the store into a running game: client, controller, HUD chip, panel,
 * purchase toast, hotkey, pointer-lock handling and the balance re-read on focus.
 * Call from your GameMode's beginPlay; destroy() in endPlay.
 */
export async function installStore(
  world: ENGINE.World,
  overrides: Partial<StoreConfig> = {},
): Promise<InstalledStore> {
  const config: StoreConfig = { ...storeConfig, ...overrides };
  const uiManager = world.uiManager;
  const inputManager = world.inputManager;

  const apiBaseUrlOverride = readApiBaseUrlOverride();
  if (apiBaseUrlOverride) console.warn(`[Store] API override from localStorage: ${apiBaseUrlOverride}`);
  // A placeholder runtime id ("editor", "dev-game") means we are not a published game.
  const runtimeGameId = world.netWorld.gameId;
  const inEditor = PLACEHOLDER_GAME_IDS.has(runtimeGameId?.trim() ?? '');
  const client = new StoreClient({
    baseUrl: apiBaseUrlOverride ?? config.apiBaseUrl,
    genesysToken: readGenesysToken,
    context: () => (inEditor ? 'editor' : 'game'),
  });

  const controller = new StoreController({
    client,
    configuredGameId: config.gameId,
    runtimeGameId,
    topUpUrls: SILICON_TOP_UP_URLS,
    // Not 'noopener': with it window.open always returns null, and a blocked tab could not be told apart.
    openTopUpWindow: (url) => {
      const tab = window.open(url, '_blank');
      if (!tab) return false;
      tab.opener = null;
      return true;
    },
    openLoginWindow: (url) => {
      const popup = window.open(url, 'sandbox-store-login', 'popup=yes,width=520,height=760');
      return popup ? { close: () => popup.close() } : null;
    },
    navigate: (url) => window.location.assign(url),
    currentUrl: () => window.location.href,
  });

  const panel = new StorePanel(uiManager, {
    accent: config.accent,
    showSessionInfo: config.showSessionInfo,
    onClose: () => controller.close(),
    onGetSilicon: () => void controller.getSilicon(),
    onRefill: () => void controller.refillTestCoins(),
    onTab: (tab) => controller.setTab(tab),
    onRetry: () => void controller.refresh(),
    onLogin: () => void controller.logIn(),
    onCancelLogin: () => controller.cancelLogIn(),
    onAction: (sku, action) => {
      if (action === 'use') void controller.consume(sku);
      else if (action !== 'owned') void controller.acquire(sku);
    },
  });

  const hud = config.showHudChip
    ? new StoreHudButton(uiManager, {
        position: config.hudPosition,
        hotkey: config.hotkey,
        accent: config.accent,
        onOpen: () => controller.open(),
      })
    : null;

  const toast = new PurchaseToast();

  await Promise.all([panel.initialize(), toast.initialize(uiManager), hud?.initialize()]);

  const nameOf = (sku: string): string => controller.state.items.find((item) => item.sku === sku)?.name ?? 'Item';
  const priceOf = (sku: string): number | null => {
    const price = controller.state.items.find((item) => item.sku === sku)?.price;
    return price && 'coins' in price ? price.coins : null;
  };

  let pointerWasLocked = false;
  const unsubscribe = [
    controller.on('state', (state) => void panel.render(state)),
    controller.on('opened', () => {
      pointerWasLocked = inputManager.isPointerLocked();
      if (pointerWasLocked) inputManager.exitPointerLock();
    }),
    controller.on('closed', () => {
      if (pointerWasLocked) inputManager.requestPointerLock({ unadjustedMovement: true });
      pointerWasLocked = false;
    }),
    controller.on('purchased', ({ sku, orderId }) => {
      console.info(`[Store] purchased ${sku} (order ${orderId ?? 'n/a'})`);
      toast.showPurchased(nameOf(sku), priceOf(sku));
    }),
    controller.on('claimed', ({ sku }) => {
      console.info(`[Store] claimed ${sku}`);
      toast.showClaimed(nameOf(sku));
    }),
    controller.on('consumed', ({ sku, remainingQuantity }) => {
      console.info(`[Store] consumed ${sku}, ${remainingQuantity} left`);
      toast.showConsumed(nameOf(sku), remainingQuantity);
    }),
    controller.on('needs-coins', ({ sku, shortfall }) =>
      console.info(`[Store] ${sku} needs ${shortfall ?? '?'} more Silicon`),
    ),
    controller.on('signed-in', ({ username }) => console.info(`[Store] signed in as ${username ?? 'player'}`)),
    controller.on('error', ({ code, message }) => console.warn(`[Store] ${code}: ${message}`)),
  ];

  // Coming back to the game tab re-checks who is signed in (a login or logout on sandbox.game)
  // and re-reads the balance (a Silicon top-up in the other tab, Q30; read from Xsolla at once
  // soon after Get Silicon). Focus covers a second window that never hid this one; both firing
  // together share one balance request.
  const onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    void controller.checkSession();
    void controller.returnedToGame();
  };
  const onFocus = (): void => void controller.returnedToGame();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);

  const hotkeys = new StoreHotkeyHandler(config.hotkey, controller);
  inputManager.addInputHandler(hotkeys);

  await controller.init();
  const { gameId, gameIdSource, gameIdMismatch } = controller.state;
  console.info(`[Store] v${STORE_VERSION}, game ${gameId ?? '(unlinked)'} via ${gameIdSource}`);
  if (gameIdMismatch) {
    console.warn(`[Store] store-config.ts gameId "${config.gameId}" differs from the running game "${gameId}"; using the running game.`);
  }

  return {
    controller,
    open: () => controller.open(),
    close: () => controller.close(),
    toggle: () => controller.toggle(),
    destroy: () => {
      for (const off of unsubscribe) off();
      inputManager.removeInputHandler(hotkeys);
      controller.destroy();
      panel.destroy();
      toast.destroy();
      hud?.destroy();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    },
  };
}
