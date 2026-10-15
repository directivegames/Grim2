/**
 * The store's single source of truth. Engine-free: UI components render
 * `state` and call the actions; game code listens to the events.
 */
import {
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
export type ItemAction = 'buy' | 'buy-again' | 'claim' | 'owned' | 'published';

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
  busySku: string | null;
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
  purchased: { sku: string; orderId: string | null };
  claimed: { sku: string };
  consumed: { sku: string; remainingQuantity: number };
  'balance-changed': { amount: number; currency: Currency };
  /** Editor only: Test Silicon was added to the owner's balance. */
  'test-coins-refilled': { granted: number };
  'needs-coins': { sku: string; shortfall: number | null };
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
/** Xsolla delivers a purchase a moment after the order; re-read the inventory up to 6 × 1 s. */
const DELIVERY_POLL_ATTEMPTS = 6;
const DELIVERY_POLL_INTERVAL_MS = 1000;
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
    busySku: null,
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
    this.emitState();

    try {
      const session = await this.deps.client.getSession(gameId);
      this.state.session = session;
      if (!session.authenticated) {
        this.rawItems = await this.deps.client.listItems(gameId);
        this.state.inventory = [];
        this.state.balance = null;
        this.state.currency = 'coins'; // a signed-out view never carries the editor's Test Silicon
        this.state.items = buildViews(this.rawItems, [], this.state.currency);
        this.state.phase = this.rawItems.length ? 'guest' : 'empty';
      } else {
        const [items, inventory, balance] = await Promise.all([
          this.deps.client.listItems(gameId),
          this.deps.client.getInventory(gameId),
          this.deps.client.getBalance(),
        ]);
        this.rawItems = items;
        this.state.inventory = inventory;
        this.applyBalance(balance);
        this.state.items = buildViews(items, inventory, this.state.currency);
        this.state.phase = items.length ? 'ready' : 'empty';
      }
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
    const changed =
      !current || current.authenticated !== session.authenticated || current.userId !== session.userId;
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

  /** One click: free items are claimed, priced items bought with Silicon. */
  public async acquire(sku: string): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId) return;
    if (!this.state.session?.authenticated) {
      await this.logIn();
      return;
    }
    this.state.busySku = sku;
    this.state.lastError = null;
    this.state.shortfall = null;
    this.emitState();
    const quantityBefore = this.quantityOf(sku);
    try {
      const result = await this.deps.client.acquire(gameId, sku);
      await this.refreshOwnership(gameId, { balance: true, delivered: { sku, quantityBefore } });
      if (result.method === 'free') this.emit('claimed', { sku });
      else this.emit('purchased', { sku, orderId: result.orderId });
    } catch (error) {
      // Short on real Silicon, the panel shows the shortfall next to Get Silicon. The tab is not
      // opened here: browsers only allow window.open from a click. Short on Test Silicon, the
      // panel shows the error and Refill (Q26).
      if (
        error instanceof StoreApiError &&
        error.code === 'INSUFFICIENT_FUNDS' &&
        error.details?.currency !== 'test-coins'
      ) {
        const shortfall = numberOrNull(error.details?.shortfall);
        this.state.shortfall = shortfall;
        this.emit('needs-coins', { sku, shortfall });
      } else {
        this.setError(error);
      }
    } finally {
      this.state.busySku = null;
      this.emitState();
    }
  }

  public async consume(sku: string, quantity = 1): Promise<void> {
    const gameId = this.state.gameId;
    if (!gameId || !this.state.session?.authenticated) return;
    this.state.busySku = sku;
    this.emitState();
    try {
      const result = await this.deps.client.consume(gameId, sku, quantity);
      await this.refreshOwnership(gameId, { balance: false });
      this.emit('consumed', { sku, remainingQuantity: result.remainingQuantity });
    } catch (error) {
      this.setError(error);
    } finally {
      this.state.busySku = null;
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
    this.state.items = buildViews(this.rawItems, this.state.inventory, this.state.currency);
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
          this.state.items = buildViews(this.rawItems, this.state.inventory, this.state.currency);
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
   * Signs the player in without leaving the game: the platform login page
   * opens in a popup and the store polls its session (2 s, up to 5 min or
   * `cancelLogIn()`) until the platform cookie is there, then refreshes in
   * place. Falls back to a full-page redirect when popups are blocked. The
   * action that triggered the sign-in is not replayed; the player clicks it
   * again once signed in.
   */
  public async logIn(): Promise<void> {
    const loginUrl = this.state.session?.loginUrl;
    if (!loginUrl || this.state.loginPending) return;

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

  public owns(sku: string): boolean {
    return this.state.inventory.some((entry) => entry.sku === sku && entry.quantity > 0);
  }

  public quantityOf(sku: string): number {
    return this.state.inventory.find((entry) => entry.sku === sku)?.quantity ?? 0;
  }

  // ---- internals --------------------------------------------------------

  /**
   * Reloads inventory (and balance). With `delivered`, re-reads the inventory
   * until the purchase of that sku is visible, since Xsolla's delivery can lag
   * the order by a moment; gives up after a few reads and keeps the last one.
   */
  private async refreshOwnership(
    gameId: string,
    options: { balance: boolean; delivered?: { sku: string; quantityBefore: number } },
  ): Promise<void> {
    const sleep = this.deps.sleep ?? defaultSleep;
    const attempts = options.delivered ? DELIVERY_POLL_ATTEMPTS : 1;
    let inventory: InventoryItem[] = this.state.inventory;
    let balance: Balance | null = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(DELIVERY_POLL_INTERVAL_MS);
      [inventory, balance] = await Promise.all([
        this.deps.client.getInventory(gameId),
        options.balance && attempt === 0 ? this.deps.client.getBalance() : Promise.resolve(balance),
      ]);
      const quantity = options.delivered
        ? (inventory.find((entry) => entry.sku === options.delivered?.sku)?.quantity ?? 0)
        : 0;
      if (!options.delivered || quantity > options.delivered.quantityBefore) break;
    }
    this.state.inventory = inventory;
    if (balance) this.applyBalance(balance);
    this.state.items = buildViews(this.rawItems, inventory, this.state.currency);
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

function buildViews(items: GameItem[], inventory: InventoryItem[], currency: Currency): ItemView[] {
  return items.map((item) => {
    const entry = inventory.find((owned) => owned.sku === item.sku);
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
    return { ...item, owned, quantity, action };
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
