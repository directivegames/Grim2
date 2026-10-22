/**
 * The store's single source of truth. Engine-free: UI components render
 * `state` and call the actions; game code listens to the events.
 */
import {
  isCoreLoginRejected,
  isOutcomeUnknown,
  StoreApiError,
  type Balance,
  type Currency,
  type GameItem,
  type InventoryItem,
  type SessionInfo,
  type StoreClient,
} from './store-client.js';
import { resolveGameId, type GameIdSource } from './store-config.js';

export type StorePhase = 'unlinked' | 'loading' | 'guest' | 'ready' | 'empty' | 'error';
export type StoreTab = 'shop' | 'inventory';
export type ItemAction = 'buy' | 'buy-again' | 'claim' | 'owned' | 'published' | 'processing';

export interface ItemView extends GameItem {
  owned: boolean;
  quantity: number;
  action: ItemAction;
}

export interface StoreError {
  code: string;
  message: string;
}

export interface StoreState {
  phase: StorePhase;
  isOpen: boolean;
  activeTab: StoreTab;
  gameId: string | null;
  gameIdSource: GameIdSource;
  gameIdMismatch: boolean;
  session: SessionInfo | null;
  balance: number | null;
  /** coins (Silicon) for players, test-coins (Test Silicon) in the editor: fake money for drafts. */
  currency: Currency;
  items: ItemView[];
  inventory: InventoryItem[];
  busyItemId: string | null;
  /**
   * Purchases still being processed: core answered 202 pending, or gave no answer
   * in time. Their cards show Processing… instead of Buy; each settles when the
   * inventory shows the item.
   */
  pendingItemIds: string[];
  /**
   * The store knows the player (platform cookie) but core does not: the page has no
   * unexpired Studio login, or core turned it down (401). The store stays in guest
   * mode until they sign in to Studio.
   */
  needsStudioLogin: boolean;
  /** A sign-in popup is open and the store is waiting for the session. */
  loginPending: boolean;
  /** Get Silicon opened the top-up page; the store polls the balance while it is open (Q30). */
  awaitingTopUp: boolean;
  /** A Test Silicon refill is running; the Refill button stays disabled. */
  refillPending: boolean;
  /** Silicon missing for the last purchase; the panel offers Get Silicon. Cleared once the balance changes. */
  shortfall: number | null;
  lastError: StoreError | null;
}

export type StoreEvents = {
  state: StoreState;
  ready: { items: ItemView[]; inventory: InventoryItem[]; balance: number | null };
  /** The item is in the inventory. `orderId` is null when it arrived after a pending purchase. */
  purchased: { itemId: string; orderId: string | null };
  claimed: { itemId: string };
  /**
   * The purchase is being processed: core answered 202 (charged, the item arrives with
   * core's daily check) or no answer came in time (`no-answer`; it may still go through).
   * Do not grant the item yet: `purchased` or `claimed` follows once the inventory shows it.
   */
  'purchase-pending': { itemId: string; reason: 'pending' | 'no-answer' };
  consumed: { itemId: string; remainingQuantity: number };
  'balance-changed': { amount: number; currency: Currency };
  /** Editor only: Test Silicon was added to the owner's balance. */
  'test-coins-refilled': { granted: number };
  'needs-coins': { itemId: string; shortfall: number | null };
  /** The player signed in through the popup; the catalog has been refreshed. */
  'signed-in': { userId: string | null; username: string | null };
  opened: undefined;
  closed: undefined;
  error: StoreError;
};

export interface StoreControllerDeps {
  client: StoreClient;
  /** From store-config.ts (the project's game id). */
  configuredGameId: string;
  /** From the running game: world.netWorld.gameId ("editor" in the editor). */
  runtimeGameId: string | null | undefined;
  /** The Sandbox top-up page per environment (Q30). Games never sell Silicon themselves. */
  topUpUrls: TopUpUrls;
  /** Opens the top-up page in a new tab from the Get Silicon click. Returns false when the browser blocked it. */
  openTopUpWindow: (url: string) => boolean;
  /**
   * The Studio sign-in page that returns to this page (core-api.ts), or null when
   * the game does not run on a Studio host. Without a Studio login core cannot
   * tell who the player is, so Sign in goes there first.
   */
  studioSignInUrl?: () => string | null;
  /**
   * Opens the platform login page in a popup so the game keeps running.
   * Return null when the popup was blocked; the store then falls back to
   * `navigate` (full-page redirect that returns to `currentUrl`).
   */
  openLoginWindow?: (url: string) => LoginWindow | null;
  navigate: (url: string) => void;
  currentUrl: () => string;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Handle to the sign-in popup. Deliberately no "is it still open" query:
 * www.sandbox.game sends Cross-Origin-Opener-Policy, which severs the link
 * and makes `window.closed` report true while the login form is on screen.
 * The only reliable signal is the session itself (polled).
 */
export interface LoginWindow {
  close: () => void;
}

export interface TopUpUrls {
  production: string;
  dev: string;
}

const BALANCE_POLL_ATTEMPTS = 8;
const BALANCE_POLL_INTERVAL_MS = 1500;
/** After Get Silicon: 120 × 5 s, ten minutes to pay in the other tab. Focus re-reads cover the rest. */
const TOP_UP_POLL_ATTEMPTS = 120;
const TOP_UP_POLL_INTERVAL_MS = 5000;
/** Coming back to the game this soon after Get Silicon reads the balance from Xsolla now. */
const TOP_UP_FRESH_READ_MS = TOP_UP_POLL_ATTEMPTS * TOP_UP_POLL_INTERVAL_MS;
/** 150 × 2 s: five minutes to finish the login in the popup. */
const LOGIN_POLL_ATTEMPTS = 150;
const LOGIN_POLL_INTERVAL_MS = 2000;
/** Served by the store API: closes the popup once the platform cookie is set. */
const LOGIN_COMPLETE_PATH = '/api/session/login-complete';

type Handler<T> = (payload: T) => void;

export class StoreController {
  public readonly state: StoreState = {
    phase: 'loading',
    isOpen: false,
    activeTab: 'shop',
    gameId: null,
    gameIdSource: 'none',
    gameIdMismatch: false,
    session: null,
    balance: null,
    currency: 'coins',
    items: [],
    inventory: [],
    busyItemId: null,
    pendingItemIds: [],
    needsStudioLogin: false,
    loginPending: false,
    awaitingTopUp: false,
    refillPending: false,
    shortfall: null,
    lastError: null,
  };

  private readonly deps: StoreControllerDeps;
  private readonly listeners = new Map<keyof StoreEvents, Set<Handler<unknown>>>();
  private rawItems: GameItem[] = [];
  private destroyed = false;
  private loginWindow: LoginWindow | null = null;
  /** Bumped by every Get Silicon click and by close(); a poll loop stops once it is stale. */
  private topUpWatch = 0;
  /** When Get Silicon last opened the top-up page (ms), until the balance changed. */
  private topUpOpenedAt: number | null = null;
  private balanceRead: Promise<void> | null = null;
  /** The last refresh loaded the signed-in view (inventory and balance). */
  private loadedSignedIn = false;
  /** Purchases being processed: item id -> quantity held when the purchase started. */
  private readonly pendingPurchases = new Map<string, number>();

  constructor(deps: StoreControllerDeps) {
    this.deps = deps;
  }

  // ---- events -----------------------------------------------------------

  public on<K extends keyof StoreEvents>(event: K, handler: Handler<StoreEvents[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as Handler<unknown>);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler as Handler<unknown>);
    };
  }

  private emit<K extends keyof StoreEvents>(event: K, payload: StoreEvents[K]): void {
    if (this.destroyed) return;
    // A listener that throws (a UI bug) must never turn a completed purchase
    // into an error or stop the other listeners from running.
    for (const handler of [...(this.listeners.get(event) ?? [])]) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[Store] listener for "${event}" failed`, error);
      }
    }
  }

  private emitState(): void {
    this.emit('state', { ...this.state, items: [...this.state.items], inventory: [...this.state.inventory] });
  }

  // ---- lifecycle --------------------------------------------------------

  public async init(): Promise<void> {
    const resolved = resolveGameId(this.deps.runtimeGameId, this.deps.configuredGameId);
    this.state.gameId = resolved.gameId;
    this.state.gameIdSource = resolved.source;
    this.state.gameIdMismatch = resolved.mismatch;
    if (!resolved.gameId) {
      this.state.phase = 'unlinked';
      this.emitState();
      return;
    }
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId) return;
    this.state.phase = 'loading';
    this.state.lastError = null;
    this.loadedSignedIn = false;
    this.emitState();

    try {
      const previousUserId = this.state.session?.userId ?? null;
      const session = await this.deps.client.getSession(gameId);
      this.state.session = session;
      if (session.userId !== previousUserId) {
        // Purchases in progress belong to the previous player.
        this.pendingPurchases.clear();
        this.state.pendingItemIds = [];
      }
      // Core identifies the player by the Studio login alone; without it they can only browse.
      const hasStudioLogin = this.deps.client.hasGenesysToken();
      this.state.needsStudioLogin = session.authenticated && !hasStudioLogin;
      let signedIn = session.authenticated && hasStudioLogin;
      if (signedIn) {
        try {
          const [items, inventory, balance] = await Promise.all([
            this.deps.client.listItems(gameId),
            this.deps.client.getInventory(gameId),
            this.deps.client.getBalance(),
          ]);
          this.rawItems = items;
          this.state.inventory = inventory;
          this.applyBalance(balance);
          this.state.items = this.buildViews();
          this.state.phase = items.length ? 'ready' : 'empty';
          this.settlePending();
        } catch (error) {
          if (!isCoreLoginRejected(error)) throw error;
          // Core turned the Studio login down (expired or revoked): browse until they sign in again.
          this.state.needsStudioLogin = true;
          signedIn = false;
        }
      }
      if (!signedIn) {
        this.rawItems = await this.deps.client.listItems(gameId);
        this.showAsGuest();
      }
      this.loadedSignedIn = signedIn;
      this.emit('ready', { items: this.state.items, inventory: this.state.inventory, balance: this.state.balance });
    } catch (error) {
      this.setError(error);
    }
    this.emitState();
  }

  public destroy(): void {
    this.destroyed = true;
    this.stopTopUpWatch();
    if (this.loginWindow) this.finishLogIn(this.loginWindow);
    this.listeners.clear();
  }

  // ---- panel ------------------------------------------------------------

  public open(): void {
    if (this.state.isOpen) return;
    this.state.isOpen = true;
    this.emit('opened', undefined);
    this.emitState();
    // The player may have logged in or out in another tab since the last look.
    void this.checkSession();
    // A purchase still being processed may have landed since.
    if (this.pendingPurchases.size > 0) void this.recheckPending();
  }

  /**
   * Re-reads the session and reloads the catalog only if the identity changed
   * (login or logout elsewhere). Cheap: one request when nothing changed.
   */
  public async checkSession(): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId || this.state.phase === 'loading' || this.state.loginPending) return;
    const current = this.state.session;
    const session = await this.pollSession();
    if (!session) return;
    // A Studio login that expired since the last load counts as a change too.
    const lostStudioLogin = this.loadedSignedIn && !this.isSignedIn();
    const changed =
      !current ||
      current.authenticated !== session.authenticated ||
      current.userId !== session.userId ||
      lostStudioLogin;
    if (changed) await this.refresh();
    else this.state.session = session;
  }

  public close(): void {
    if (!this.state.isOpen) return;
    this.state.isOpen = false;
    this.state.shortfall = null;
    this.stopTopUpWatch();
    this.emit('closed', undefined);
    this.emitState();
  }

  public toggle(): void {
    if (this.state.isOpen) this.close();
    else this.open();
  }

  public setTab(tab: StoreTab): void {
    if (this.state.activeTab === tab) return;
    this.state.activeTab = tab;
    this.emitState();
  }

  // ---- purchases --------------------------------------------------------

  /**
   * One click: free items are claimed, priced items bought with Silicon. A
   * purchase core reports as pending (202), or that gets no answer in time,
   * is shown as being processed and never invites a second click.
   */
  public async acquire(itemId: string): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId || this.pendingPurchases.has(itemId) || this.state.busyItemId === itemId) return;
    if (!this.isSignedIn()) {
      await this.logIn();
      return;
    }
    this.state.busyItemId = itemId;
    this.state.lastError = null;
    this.state.shortfall = null;
    this.emitState();
    const quantityBefore = this.quantityOf(itemId);
    try {
      const result = await this.deps.client.acquire(gameId, itemId);
      if (result.pending) {
        this.markPending(itemId, quantityBefore, 'pending');
        await this.recheckPending(); // the balance shows the charge at once
      } else {
        await this.refreshOwnership(gameId, { balance: true });
        if (result.method === 'free') this.emit('claimed', { itemId });
        else this.emit('purchased', { itemId, orderId: result.orderId });
      }
    } catch (error) {
      // Short on real Silicon, the panel shows the shortfall next to Get Silicon. The tab is not
      // opened here: browsers only allow window.open from a click. Short on Test Silicon, the
      // panel shows the error and Refill (Q26).
      if (isOutcomeUnknown(error)) {
        // No answer: the purchase may have gone through. Never invite a second click.
        this.markPending(itemId, quantityBefore, 'no-answer');
      } else if (isCoreLoginRejected(error)) {
        this.rejectStudioLogin();
      } else if (
        error instanceof StoreApiError &&
        error.code === 'INSUFFICIENT_FUNDS' &&
        error.details?.currency !== 'test-coins'
      ) {
        const shortfall = numberOrNull(error.details?.shortfall);
        this.state.shortfall = shortfall;
        this.emit('needs-coins', { itemId, shortfall });
      } else {
        this.setError(error);
      }
    } finally {
      this.state.busyItemId = null;
      this.emitState();
    }
  }

  public async consume(itemId: string, quantity = 1): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId || !this.isSignedIn()) return;
    this.state.busyItemId = itemId;
    this.emitState();
    try {
      const result = await this.deps.client.consume(gameId, itemId, quantity);
      await this.refreshOwnership(gameId, { balance: false });
      this.emit('consumed', { itemId, remainingQuantity: result.remainingQuantity });
    } catch (error) {
      if (isCoreLoginRejected(error)) this.rejectStudioLogin();
      else this.setError(error);
    } finally {
      this.state.busyItemId = null;
      this.emitState();
    }
  }

  // ---- silicon ----------------------------------------------------------

  /**
   * Get Silicon (Q30): opens the Sandbox top-up page in a new tab; Silicon is
   * never sold inside a game. Call it from the click itself, or the browser
   * blocks the tab. While the store stays open the balance is polled every 5 s
   * for up to ten minutes; coming back to the game tab re-reads it as well
   * (refreshBalance). A guest gets the page too; it handles sign-in.
   */
  public async getSilicon(): Promise<void> {
    if (this.state.currency === 'test-coins') return; // the editor never spends real Silicon (Q26)
    const environment = this.state.session?.environment === 'dev' ? 'dev' : 'production';
    const url = this.deps.topUpUrls[environment];
    if (!url) {
      this.setError(new StoreApiError(0, 'TOP_UP_NOT_CONFIGURED', 'The Silicon top-up page is not configured yet'));
      this.emitState();
      return;
    }
    if (!this.deps.openTopUpWindow(url)) {
      this.setError(new StoreApiError(0, 'POPUP_BLOCKED', 'Allow pop-ups for this page to open the Silicon top-up'));
      this.emitState();
      return;
    }
    this.state.lastError = null;
    if (!this.state.session?.authenticated) {
      this.emitState();
      return;
    }

    const watch = ++this.topUpWatch;
    const before = this.state.balance;
    this.topUpOpenedAt = Date.now();
    this.state.awaitingTopUp = true;
    this.emitState();
    const sleep = this.deps.sleep ?? defaultSleep;
    try {
      for (let attempt = 0; attempt < TOP_UP_POLL_ATTEMPTS; attempt++) {
        await sleep(TOP_UP_POLL_INTERVAL_MS);
        if (this.destroyed || watch !== this.topUpWatch || !this.state.isOpen) return;
        await this.refreshBalance();
        if (this.state.balance !== before) return;
      }
    } finally {
      if (watch === this.topUpWatch) {
        this.state.awaitingTopUp = false;
        this.emitState();
      }
    }
  }

  /**
   * Re-reads the balance; on a change applies it, clears the shortfall and
   * emits balance-changed. Concurrent calls share one request; a failed read
   * is ignored. `fresh` asks the API to read Xsolla now (after a top-up).
   */
  public refreshBalance(options: { fresh?: boolean } = {}): Promise<void> {
    if (!this.state.session?.authenticated) return Promise.resolve();
    this.balanceRead ??= this.readBalance(options.fresh === true).finally(() => {
      this.balanceRead = null;
    });
    return this.balanceRead;
  }

  /**
   * install-store calls it when the game tab is visible or focused again, so
   * a top-up made in another tab shows up. Within ten minutes of Get Silicon
   * the balance is read from Xsolla now (POST /api/balance/refresh); otherwise
   * the usual read.
   */
  public returnedToGame(): Promise<void> {
    const fresh =
      this.topUpOpenedAt !== null && Date.now() - this.topUpOpenedAt < TOP_UP_FRESH_READ_MS;
    return this.refreshBalance({ fresh });
  }

  private async readBalance(fresh: boolean): Promise<void> {
    let balance: Balance;
    try {
      balance = fresh ? await this.deps.client.getFreshBalance() : await this.deps.client.getBalance();
    } catch {
      return; // transient; the next focus or poll tries again
    }
    if (balance.amount !== this.state.balance) this.topUpOpenedAt = null;
    if (this.destroyed || (balance.amount === this.state.balance && balance.currency === this.state.currency)) return;
    this.applyBalance(balance);
    this.state.shortfall = null;
    this.state.items = this.buildViews();
    this.emit('balance-changed', { amount: balance.amount, currency: balance.currency });
    this.emitState();
  }

  private stopTopUpWatch(): void {
    this.topUpWatch++;
    this.state.awaitingTopUp = false;
  }

  /** Editor only: adds Test Silicon, then polls the balance until it grows (Xsolla credits ~1 s later). */
  public async refillTestCoins(): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId || !this.state.session?.authenticated || this.state.refillPending) return;
    const before = this.state.balance ?? 0;
    this.state.refillPending = true;
    this.emitState();
    try {
      const { granted } = await this.deps.client.refillTestCoins(gameId);
      const sleep = this.deps.sleep ?? defaultSleep;
      for (let attempt = 0; attempt < BALANCE_POLL_ATTEMPTS; attempt++) {
        const balance = await this.deps.client.getBalance();
        if (balance.amount > before) {
          this.applyBalance(balance);
          this.state.items = this.buildViews();
          this.emit('balance-changed', { amount: balance.amount, currency: balance.currency });
          break;
        }
        await sleep(BALANCE_POLL_INTERVAL_MS);
      }
      this.emit('test-coins-refilled', { granted });
    } catch (error) {
      this.setError(error);
    } finally {
      this.state.refillPending = false;
    }
    this.emitState();
  }

  // ---- session ----------------------------------------------------------

  /**
   * Signs the player in. Core needs a Studio login, so on a Studio host a
   * player without one goes to the Studio sign-in page, which brings them back
   * to the game. Otherwise the platform login page opens in a popup so the
   * game keeps running, and the store polls its session (2 s, up to 5 min or
   * `cancelLogIn()`) until the platform cookie is there, then refreshes in
   * place; it falls back to a full-page redirect when popups are blocked. The
   * action that triggered the sign-in is not replayed; the player clicks it
   * again once signed in.
   */
  public async logIn(): Promise<void> {
    if (this.state.loginPending) return;
    const needsStudio = this.state.needsStudioLogin || !this.deps.client.hasGenesysToken();
    const studioSignIn = needsStudio ? (this.deps.studioSignInUrl?.() ?? null) : null;
    if (studioSignIn) {
      this.deps.navigate(studioSignIn);
      return;
    }
    if (this.state.needsStudioLogin) {
      // Signed in on the platform already, and this page cannot open Studio's sign-in.
      this.setError(new StoreApiError(0, 'STUDIO_LOGIN_REQUIRED', 'Buying needs a Sandbox Studio login, which this page cannot open'));
      this.emitState();
      return;
    }
    const loginUrl = this.state.session?.loginUrl;
    if (!loginUrl) return;

    const popup = this.deps.openLoginWindow?.(
      `${loginUrl}?redirectTo=${encodeURIComponent(`${this.deps.client.baseUrl}${LOGIN_COMPLETE_PATH}`)}`,
    );
    if (!popup) {
      this.deps.navigate(`${loginUrl}?redirectTo=${encodeURIComponent(this.deps.currentUrl())}`);
      return;
    }

    this.loginWindow = popup;
    this.state.loginPending = true;
    this.emitState();
    const sleep = this.deps.sleep ?? defaultSleep;
    try {
      for (let attempt = 0; attempt < LOGIN_POLL_ATTEMPTS; attempt++) {
        if (this.destroyed || this.loginWindow !== popup) return;
        const session = await this.pollSession();
        if (session?.authenticated) {
          this.finishLogIn(popup);
          await this.refresh();
          this.emit('signed-in', { userId: session.userId, username: session.username });
          return;
        }
        await sleep(LOGIN_POLL_INTERVAL_MS);
      }
    } finally {
      if (this.loginWindow === popup) this.finishLogIn(popup);
      this.emitState();
    }
  }

  /** Closes the sign-in popup and stops waiting for it. */
  public cancelLogIn(): void {
    const popup = this.loginWindow;
    if (!popup) return;
    this.finishLogIn(popup);
    this.emitState();
  }

  private finishLogIn(popup: LoginWindow): void {
    if (this.loginWindow !== popup) return;
    this.loginWindow = null;
    this.state.loginPending = false;
    try {
      popup.close(); // a no-op once COOP has disowned the handle; login-complete closes itself
    } catch {
      /* ignore */
    }
  }

  private async pollSession(): Promise<SessionInfo | null> {
    const gameId = this.state.gameId;
    if (!gameId) return null;
    try {
      return await this.deps.client.getSession(gameId);
    } catch {
      return null; // transient; try again on the next tick
    }
  }

  // ---- gameplay helpers -------------------------------------------------

  /** Whether the player holds the item (its id from the editor's Store Manager). */
  public owns(itemId: string): boolean {
    return this.state.inventory.some((entry) => entry.itemId === itemId && entry.quantity > 0);
  }

  public quantityOf(itemId: string): number {
    return this.state.inventory.find((entry) => entry.itemId === itemId)?.quantity ?? 0;
  }

  // ---- internals --------------------------------------------------------

  /** Signed in for buying: the store knows the player and the page has a Studio login core accepts. */
  private isSignedIn(): boolean {
    return (
      this.state.session?.authenticated === true &&
      !this.state.needsStudioLogin &&
      this.deps.client.hasGenesysToken()
    );
  }

  /** The browsing view: catalog only, no inventory, balance or purchases in progress. */
  private showAsGuest(): void {
    this.state.inventory = [];
    this.state.balance = null;
    this.state.currency = 'coins'; // a signed-out view never carries the editor's Test Silicon
    this.pendingPurchases.clear();
    this.state.pendingItemIds = [];
    this.state.items = this.buildViews();
    this.state.phase = this.rawItems.length ? 'guest' : 'empty';
  }

  /** Records a purchase whose outcome is not in the inventory yet. */
  private markPending(itemId: string, quantityBefore: number, reason: 'pending' | 'no-answer'): void {
    this.pendingPurchases.set(itemId, quantityBefore);
    this.state.pendingItemIds = [...this.pendingPurchases.keys()];
    this.state.items = this.buildViews();
    this.emit('purchase-pending', { itemId, reason });
  }

  /** Settles every pending purchase whose item the inventory now shows: emits purchased or claimed. */
  private settlePending(): void {
    for (const [itemId, quantityBefore] of [...this.pendingPurchases]) {
      if (this.quantityOf(itemId) <= quantityBefore) continue;
      this.pendingPurchases.delete(itemId);
      const item = this.rawItems.find((entry) => entry.itemId === itemId);
      if (item && 'free' in item.price) this.emit('claimed', { itemId });
      else this.emit('purchased', { itemId, orderId: null });
    }
    this.state.pendingItemIds = [...this.pendingPurchases.keys()];
    this.state.items = this.buildViews();
  }

  /** Re-reads inventory and balance for purchases in progress. Best effort: a failed read waits for the next one. */
  private async recheckPending(): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId || !this.isSignedIn()) return;
    try {
      await this.refreshOwnership(gameId, { balance: true });
    } catch {
      return;
    }
    this.emitState();
  }

  private buildViews(): ItemView[] {
    return buildViews(this.rawItems, this.state.inventory, this.state.currency, this.pendingPurchases);
  }

  /** Core answered 401 to an action: the Studio login is gone, so the store becomes a guest that offers Studio's sign-in. */
  private rejectStudioLogin(): void {
    this.state.needsStudioLogin = true;
    this.loadedSignedIn = false;
    this.state.shortfall = null;
    this.showAsGuest();
  }

  /** Reloads the inventory (and balance). Core grants an item before it answers, so one read sees it. */
  private async refreshOwnership(gameId: string, options: { balance: boolean }): Promise<void> {
    const [inventory, balance] = await Promise.all([
      this.deps.client.getInventory(gameId),
      options.balance ? this.deps.client.getBalance() : Promise.resolve(null),
    ]);
    this.state.inventory = inventory;
    if (balance) this.applyBalance(balance);
    this.state.items = this.buildViews();
    this.settlePending();
  }

  private applyBalance(balance: Balance): void {
    this.state.balance = balance.amount;
    this.state.currency = balance.currency;
  }

  private setError(error: unknown): void {
    const storeError: StoreError =
      error instanceof StoreApiError
        ? { code: error.code, message: error.message }
        : { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Something went wrong' };
    this.state.lastError = storeError;
    if (this.state.phase === 'loading') this.state.phase = 'error';
    this.emit('error', storeError);
  }
}

function buildViews(
  items: GameItem[],
  inventory: InventoryItem[],
  currency: Currency,
  pending: ReadonlyMap<string, number>,
): ItemView[] {
  return items.map((item) => {
    const entry = inventory.find((owned) => owned.itemId === item.itemId);
    const quantity = entry?.quantity ?? 0;
    const owned = quantity > 0;
    let action: ItemAction;
    if (owned && !item.consumable) action = 'owned';
    else if ('free' in item.price && item.price.free) action = 'claim';
    else action = owned ? 'buy-again' : 'buy';
    // The editor spends only Test Silicon; a published item costs real Silicon (Q26).
    if (currency === 'test-coins' && 'currency' in item.price && item.price.currency === 'coins' && action !== 'owned') {
      action = 'published';
    }
    if (pending.has(item.itemId) && action !== 'owned') action = 'processing';
    return { ...item, owned, quantity, action };
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
