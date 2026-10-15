/**
 * Typed client for the Sandbox store API. Engine-free so it can be unit-tested.
 *
 * Authentication is the platform session cookie: every request is sent with
 * `credentials: "include"`. Game code never handles a player token. The optional
 * Genesys token (creator actions only) is read through `genesysToken`.
 */

/**
 * API currency SKUs. The display names are Silicon (coins) and Test Silicon
 * (test-coins); the SKUs predate the rename and stay (Q30). Silicon is bought
 * only on the Sandbox top-up page, never through this client.
 */
export type Currency = 'coins' | 'test-coins';

/** `currency: 'test-coins'` marks a draft's fake-money price (editor only). */
export type Price = { coins: number; currency: Currency } | { free: true };

export interface Balance {
  currency: Currency;
  amount: number;
}

export interface SessionInfo {
  authenticated: boolean;
  userId: string | null;
  username: string | null;
  /** null when the API predates environment reporting. */
  environment: 'dev' | 'production' | null;
  /** Environment-specific login page; append ?redirectTo=<url>. */
  loginUrl: string;
  /** Payment mode purchases would use; null when the API predates it. */
  paymentMode: 'sandbox' | 'production' | null;
}

export interface GameItem {
  sku: string;
  name: string;
  description: string;
  price: Price;
  consumable: boolean;
  imageUrl: string | null;
  creatorId: string | null;
  gameId: string | null;
  /** Only ever true for the game's owner testing in the editor; players never receive drafts. */
  draft: boolean;
}

export interface InventoryItem {
  sku: string;
  name: string;
  description: string;
  imageUrl: string | null;
  consumable: boolean;
  quantity: number;
  remainingUses: number | null;
}

export interface AcquireResult {
  sku: string;
  method: 'free' | 'coins';
  currency: Currency | null;
  orderId: string | null;
}

export class StoreApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'StoreApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface StoreClientOptions {
  baseUrl: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Returns the creator's Genesys access token when available (creator actions only). */
  genesysToken?: () => string | null;
  /**
   * Where the game runs. "editor" is sent as X-Store-Context: the API then serves
   * Test Silicon and drafts to the game's owner and refuses real-Silicon purchases.
   */
  context?: () => 'editor' | 'game';
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function currencyOf(value: unknown): Currency {
  return value === 'test-coins' ? 'test-coins' : 'coins';
}

function normalizePrice(value: unknown): Price {
  if (isRecord(value) && value.free === true) return { free: true };
  const amount = isRecord(value) ? Number(value.coins) : 0;
  return { coins: Number.isFinite(amount) ? amount : 0, currency: currencyOf(isRecord(value) ? value.currency : null) };
}

function balanceOf(data: Record<string, unknown>): Balance {
  const currency = currencyOf(data.currency);
  const items = Array.isArray(data.items) ? data.items : [];
  const entry = items.find((e) => isRecord(e) && e.sku === currency);
  const amount = isRecord(entry) ? Number(entry.amount) : 0;
  return { currency, amount: Number.isFinite(amount) ? amount : 0 };
}

function paymentModeOf(value: unknown): 'sandbox' | 'production' | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}

export class StoreClient {
  /** API origin, without a trailing slash. */
  public readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly genesysToken: () => string | null;
  private readonly context: () => 'editor' | 'game';
  private readonly timeoutMs: number;

  constructor(options: StoreClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.genesysToken = options.genesysToken ?? (() => null);
    this.context = options.context ?? (() => 'game');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** `gameId` lets the API report sandbox paymentMode for the game's owner in the editor. */
  public async getSession(gameId?: string | null): Promise<SessionInfo> {
    const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
    const data = await this.request('GET', `/api/session${query}`);
    return {
      authenticated: data.authenticated === true,
      userId: optionalString(data.userId),
      username: optionalString(data.username),
      environment:
        data.environment === 'production' || data.environment === 'dev' ? data.environment : null,
      loginUrl: optionalString(data.loginUrl) ?? '',
      paymentMode: paymentModeOf(data.paymentMode),
    };
  }

  /** Balance in the currency of this context: Silicon for players, Test Silicon in the editor. */
  public async getBalance(): Promise<Balance> {
    return balanceOf(await this.request('GET', '/api/balance'));
  }

  /**
   * The balance read from Xsolla now (POST /api/balance/refresh), for the
   * moment the player comes back from the top-up page: a top-up shows at once
   * instead of when its webhook lands. An API without the route answers 404;
   * the plain read is used then.
   */
  public async getFreshBalance(): Promise<Balance> {
    try {
      return balanceOf(await this.request('POST', '/api/balance/refresh'));
    } catch (error) {
      if (error instanceof StoreApiError && error.status === 404) return this.getBalance();
      throw error;
    }
  }

  public async listItems(gameId: string): Promise<GameItem[]> {
    const data = await this.request('GET', `/api/games/${encodeURIComponent(gameId)}/items`);
    const items = (Array.isArray(data.items) ? data.items : []) as GameItem[];
    return items.map((item) => ({ ...item, price: normalizePrice(item.price), draft: item.draft === true }));
  }

  public async getInventory(gameId: string): Promise<InventoryItem[]> {
    const data = await this.request('GET', `/api/games/${encodeURIComponent(gameId)}/inventory`);
    return (Array.isArray(data.items) ? data.items : []) as InventoryItem[];
  }

  /** One-click acquisition: free items are claimed, priced items are bought with Silicon. */
  public async acquire(gameId: string, sku: string): Promise<AcquireResult> {
    const data = await this.request(
      'POST',
      `/api/games/${encodeURIComponent(gameId)}/items/${encodeURIComponent(sku)}/acquire`,
    );
    return {
      sku: optionalString(data.sku) ?? sku,
      method: data.method === 'free' ? 'free' : 'coins',
      currency: data.currency === null || data.currency === undefined ? null : currencyOf(data.currency),
      orderId: data.orderId === null || data.orderId === undefined ? null : String(data.orderId),
    };
  }

  public async consume(gameId: string, sku: string, quantity = 1): Promise<{ remainingQuantity: number }> {
    const data = await this.request(
      'POST',
      `/api/games/${encodeURIComponent(gameId)}/inventory/${encodeURIComponent(sku)}/consume`,
      { quantity },
    );
    const remaining = Number(data.remainingQuantity);
    return { remainingQuantity: Number.isFinite(remaining) ? remaining : 0 };
  }

  /** Editor only, game owner only: adds Test Silicon (fake money for drafts). Re-read the balance after ~1 s. */
  public async refillTestCoins(gameId: string): Promise<{ granted: number }> {
    const data = await this.request('POST', `/api/balance/test-coins/refill?gameId=${encodeURIComponent(gameId)}`);
    const granted = Number(data.granted);
    return { granted: Number.isFinite(granted) ? granted : 0 };
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = this.genesysToken();
    if (token) headers['X-Genesys-Token'] = token;
    if (this.context() === 'editor') headers['X-Store-Context'] = 'editor';
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: 'include',
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network request failed';
      throw new StoreApiError(0, 'NETWORK', message);
    }

    const payload: unknown = await response.json().catch(() => null);
    const data = isRecord(payload) ? payload : {};

    if (!response.ok) {
      const error = isRecord(data.error) ? data.error : {};
      throw new StoreApiError(
        response.status,
        optionalString(error.code) ?? `HTTP_${response.status}`,
        optionalString(error.message) ?? `Store request failed (${response.status})`,
        isRecord(error.details) ? error.details : null,
      );
    }
    return data;
  }
}
