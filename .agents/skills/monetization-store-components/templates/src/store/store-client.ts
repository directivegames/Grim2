/**
 * Typed client for the two services behind the store. Engine-free so it can be unit-tested.
 *
 * - tsb-core-api (core) owns the game's items and each player's inventory of
 *   them: list, buy or claim (core charges through the store), consume. Core
 *   knows the player only by their Studio login: the Keycloak access token,
 *   sent as `Authorization: Bearer`. Core requests carry no cookies.
 * - The Sandbox store API keeps the session, the Silicon balance and Test
 *   Silicon. It reads the platform session cookie (`credentials: "include"`)
 *   and the same token as X-Genesys-Token when there is one.
 *
 * Game code never handles the token itself; `genesysToken` reads it. Studio
 * never refreshes or clears that token, so the client treats an expired or
 * malformed one as absent and never sends it.
 */

/**
 * API currency SKUs. The display names are Silicon (coins) and Test Silicon
 * (test-coins); the SKUs predate the rename and stay (Q30). Silicon is bought
 * only on the Sandbox top-up page, never through this client.
 */
export type Currency = 'coins' | 'test-coins';

/** `currency: 'test-coins'` marks a draft's price: the owner buys drafts with Test Silicon, in the editor. */
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
  /** Core's item id. Game code names items by it; the editor's Store Manager shows it. */
  itemId: string;
  name: string;
  description: string;
  price: Price;
  consumable: boolean;
  imageUrl: string | null;
  /** Only ever true in the editor, for the game's owner; players never receive drafts. */
  draft: boolean;
}

export interface InventoryItem {
  itemId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  consumable: boolean;
  quantity: number;
}

export interface AcquireResult {
  itemId: string;
  method: 'free' | 'coins';
  currency: Currency | null;
  orderId: string | null;
  /** How many the player now holds; null while pending. */
  quantity: number | null;
  /** Charged, but the store named no order yet: the item arrives with core's daily check. */
  pending: boolean;
}

export type StoreService = 'store' | 'core';

export class StoreApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;
  /** Which API answered; null for errors raised by the store code itself. */
  public readonly service: StoreService | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> | null = null,
    service: StoreService | null = null,
  ) {
    super(message);
    this.name = 'StoreApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.service = service;
  }
}

/**
 * Core turned the page's Studio login down (401): expired, revoked, or from
 * another environment. The player signs in to Studio again.
 */
export function isCoreLoginRejected(error: unknown): boolean {
  return error instanceof StoreApiError && error.service === 'core' && error.status === 401;
}

/**
 * A core call that got no answer (timeout or network failure): it may have
 * reached core and gone through, so its outcome is unknown. For a purchase
 * that means "being processed", never "try again".
 */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof StoreApiError && error.service === 'core' && error.status === 0;
}

/** A token this close to its expiry counts as expired: it could lapse on the way. */
const TOKEN_EXPIRY_SKEW_MS = 30_000;

/**
 * The token when it is a JWT whose `exp` is more than 30 s after `nowMs`;
 * null when it is missing, expired, malformed, or carries no `exp`.
 */
export function usableToken(token: string | null | undefined, nowMs: number): string | null {
  const value = token?.trim();
  const payload = value?.split('.')[1];
  if (!value || !payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    const exp = isRecord(claims) ? claims.exp : undefined;
    return typeof exp === 'number' && exp * 1000 > nowMs + TOKEN_EXPIRY_SKEW_MS ? value : null;
  } catch {
    return null;
  }
}

export interface StoreClientOptions {
  /** Store API origin (session, balance, Test Silicon). */
  baseUrl: string;
  /** Core API origin (items, inventory, purchases). */
  coreBaseUrl: string;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Returns the player's Studio (Keycloak) access token when the page has one, as stored. */
  genesysToken?: () => string | null;
  /** Injected for tests; defaults to Date.now. Decides whether the token has expired. */
  now?: () => number;
  /**
   * Where the game runs. "editor" is sent as X-Store-Context: the game's owner
   * then sees drafts and buys them with Test Silicon, and real-Silicon purchases
   * are refused.
   */
  context?: () => 'editor' | 'game';
  /** Every request but a purchase. Default 10 s. */
  timeoutMs?: number;
  /** A purchase (acquire). Core waits up to 30 s for the store before it answers 202 pending; default 35 s. */
  acquireTimeoutMs?: number;
}

type Method = 'GET' | 'POST';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function currencyOf(value: unknown): Currency {
  return value === 'test-coins' ? 'test-coins' : 'coins';
}

function finiteOr(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Core prices items in whole Silicon, 0 for free; a draft is paid in Test Silicon. */
function gameItemOf(value: unknown): GameItem | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  const price = finiteOr(value.price, 0);
  const draft = value.draft === true;
  return {
    itemId: value.id,
    name: optionalString(value.name) ?? '',
    description: optionalString(value.description) ?? '',
    price: price > 0 ? { coins: price, currency: draft ? 'test-coins' : 'coins' } : { free: true },
    consumable: value.consumable === true,
    imageUrl: optionalString(value.imageUrl),
    draft,
  };
}

function balanceOf(data: Record<string, unknown>): Balance {
  const currency = currencyOf(data.currency);
  const items = Array.isArray(data.items) ? data.items : [];
  const entry = items.find((e) => isRecord(e) && e.sku === currency);
  return { currency, amount: isRecord(entry) ? finiteOr(entry.amount, 0) : 0 };
}

function paymentModeOf(value: unknown): 'sandbox' | 'production' | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}

/** "price: Number must be greater than 0; …" from a validation error's issues. */
function issuesText(issues: unknown): string | null {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues
    .filter(isRecord)
    .map((issue) => {
      const path = Array.isArray(issue.path) ? issue.path.join('.') : '';
      const message = optionalString(issue.message) ?? 'invalid';
      return path ? `${path}: ${message}` : message;
    })
    .join('; ');
}

export class StoreClient {
  /** Store API origin, without a trailing slash. */
  public readonly baseUrl: string;
  /** Core API origin, without a trailing slash. */
  public readonly coreBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly genesysToken: () => string | null;
  private readonly now: () => number;
  private readonly context: () => 'editor' | 'game';
  private readonly timeoutMs: number;
  private readonly acquireTimeoutMs: number;

  constructor(options: StoreClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.coreBaseUrl = options.coreBaseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.genesysToken = options.genesysToken ?? (() => null);
    this.now = options.now ?? (() => Date.now());
    this.context = options.context ?? (() => 'game');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? 35_000;
  }

  /** Whether the page has an unexpired Studio login. Core cannot tell who the player is without it. */
  public hasGenesysToken(): boolean {
    return this.token() !== null;
  }

  /** The Studio token, or null when there is none or it has expired. */
  private token(): string | null {
    return usableToken(this.genesysToken(), this.now());
  }

  // ---- store API: session, balance, Test Silicon -------------------------

  /** `gameId` lets the API report sandbox paymentMode for the game's owner in the editor. */
  public async getSession(gameId?: string | null): Promise<SessionInfo> {
    const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
    const data = await this.storeRequest('GET', `/api/session${query}`);
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
    return balanceOf(await this.storeRequest('GET', '/api/balance'));
  }

  /**
   * The balance read from Xsolla now (POST /api/balance/refresh), for the
   * moment the player comes back from the top-up page: a top-up shows at once
   * instead of when its webhook lands. An API without the route answers 404;
   * the plain read is used then.
   */
  public async getFreshBalance(): Promise<Balance> {
    try {
      return balanceOf(await this.storeRequest('POST', '/api/balance/refresh'));
    } catch (error) {
      if (error instanceof StoreApiError && error.status === 404) return this.getBalance();
      throw error;
    }
  }

  /** Editor only, game owner only: adds Test Silicon (fake money for drafts). Re-read the balance after ~1 s. */
  public async refillTestCoins(gameId: string): Promise<{ granted: number }> {
    const data = await this.storeRequest('POST', `/api/balance/test-coins/refill?gameId=${encodeURIComponent(gameId)}`);
    return { granted: finiteOr(data.granted, 0) };
  }

  // ---- core: items and inventory -----------------------------------------

  /**
   * What the store sells. Players get published items on sale. Core also hands
   * the game's owner drafts and items off sale; the store shows drafts only in
   * the editor, where the owner tests them, and never shows items off sale.
   */
  public async listItems(gameId: string): Promise<GameItem[]> {
    const data = await this.coreRequest('GET', `/v2/games/${encodeURIComponent(gameId)}/items`);
    const inEditor = this.context() === 'editor';
    return (Array.isArray(data.items) ? data.items : [])
      .filter((raw) => isRecord(raw) && raw.onSale !== false && (inEditor || raw.draft !== true))
      .map(gameItemOf)
      .filter((item): item is GameItem => item !== null);
  }

  /** Every item of this game the player holds, with quantities. */
  public async getInventory(gameId: string): Promise<InventoryItem[]> {
    const data = await this.coreRequest('GET', `/v2/games/${encodeURIComponent(gameId)}/inventory`);
    const entries = Array.isArray(data.items) ? data.items : [];
    const inventory: InventoryItem[] = [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const item = gameItemOf(entry.item);
      if (!item) continue;
      inventory.push({
        itemId: item.itemId,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        consumable: item.consumable,
        quantity: finiteOr(entry.quantity, 0),
      });
    }
    return inventory;
  }

  /**
   * One-click acquisition: free items are claimed, priced items bought with
   * Silicon (Test Silicon for a draft in the editor). Core adds the item to the
   * inventory before it answers, or answers 202 pending when the store took
   * longer than 30 s. Waits up to `acquireTimeoutMs`; a timeout or network
   * failure throws a core StoreApiError with status 0 (`isOutcomeUnknown`).
   */
  public async acquire(gameId: string, itemId: string): Promise<AcquireResult> {
    const headers: Record<string, string> = this.context() === 'editor' ? { 'X-Store-Context': 'editor' } : {};
    const data = await this.coreRequest(
      'POST',
      `/v2/games/${encodeURIComponent(gameId)}/items/${encodeURIComponent(itemId)}/acquire`,
      undefined,
      headers,
      this.acquireTimeoutMs,
    );
    const pending = data.pending === true;
    const currency = data.currency === null || data.currency === undefined ? null : currencyOf(data.currency);
    return {
      itemId: optionalString(data.itemId) ?? itemId,
      method: currency === null && !pending ? 'free' : 'coins',
      currency,
      orderId: data.orderId === null || data.orderId === undefined ? null : String(data.orderId),
      quantity: pending ? null : finiteOr(data.quantity, 1),
      pending,
    };
  }

  /** Spends units of a consumable. 409 NOT_CONSUMABLE for permanent items, INSUFFICIENT_QUANTITY past what is held. */
  public async consume(gameId: string, itemId: string, quantity = 1): Promise<{ remainingQuantity: number }> {
    const data = await this.coreRequest(
      'POST',
      `/v2/games/${encodeURIComponent(gameId)}/inventory/${encodeURIComponent(itemId)}/consume`,
      { quantity },
    );
    return { remainingQuantity: finiteOr(data.remaining, 0) };
  }

  // ---- transport ---------------------------------------------------------

  private storeRequest(method: Method, path: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {};
    const token = this.token();
    if (token) headers['X-Genesys-Token'] = token;
    if (this.context() === 'editor') headers['X-Store-Context'] = 'editor';
    return this.send(`${this.baseUrl}${path}`, method, headers, 'include', undefined, 'store', this.timeoutMs);
  }

  private coreRequest(
    method: Method,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    timeoutMs = this.timeoutMs,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { ...extraHeaders };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;
    // No cookies: core would prefer its own auth cookie, possibly another account's, over the token.
    return this.send(`${this.coreBaseUrl}${path}`, method, headers, 'omit', body, 'core', timeoutMs);
  }

  private async send(
    url: string,
    method: Method,
    headers: Record<string, string>,
    credentials: RequestCredentials,
    body: unknown,
    service: StoreService,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const allHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
    if (body !== undefined) allHeaders['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: allHeaders,
        credentials,
        signal: AbortSignal.timeout(timeoutMs),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const message = timedOut
        ? `No answer within ${Math.round(timeoutMs / 1000)} s`
        : error instanceof Error ? error.message : 'Network request failed';
      throw new StoreApiError(0, timedOut ? 'TIMEOUT' : 'NETWORK', message, null, service);
    }

    const payload: unknown = await response.json().catch(() => null);
    const data = isRecord(payload) ? payload : {};

    if (!response.ok) {
      const error = isRecord(data.error) ? data.error : {};
      throw new StoreApiError(
        response.status,
        optionalString(error.code) ?? `HTTP_${response.status}`,
        optionalString(error.message) ?? issuesText(error.issues) ?? `${service === 'core' ? 'Core' : 'Store'} request failed (${response.status})`,
        isRecord(error.details) ? error.details : null,
        service,
      );
    }
    return data;
  }
}
