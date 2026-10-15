# Store API

Base URL `https://api-store.sandbox.game`; interactive docs at `/api/docs`.
`src/store/store-client.ts` wraps every endpoint the store uses. Game code
does not call the API directly.

## Environment and identity

The API resolves the environment from the request `Origin`: the studio and
sandbox.game hosts are production (real payments); the internal development
hosts and `localhost` are development (sandbox payments). Each environment
validates its own platform cookie and accepts its own Studio tokens.

Identity, in order:

1. `X-Genesys-Token`: the creator's Studio token, present only inside the
   Genesys editor (`localStorage.keycloak_access_token`). With
   `X-Store-Context: editor` and a game the token's user owns, the API lists
   drafts, allows item authoring and runs the store on Test Silicon. There is
   no Get Silicon in the editor.
2. The platform cookie, sent by browsers with `credentials: "include"` from
   any `*.sandbox.game` page. This is how players are identified in a
   published game. A page on plain `localhost` has neither and is a guest.

Sign-in without leaving the game: the client opens
`loginUrl?redirectTo=<api>/api/session/login-complete` in a popup and polls
`GET /api/session` every 2 s (up to 5 min, or until the player cancels),
then refreshes in place. The popup's `closed` flag is not used: the login
page's Cross-Origin-Opener-Policy makes it report closed while the form is
on screen. The game cannot close the popup; the landing page closes itself
when the browser allows.

Payment mode: sandbox on development; on production, sandbox only for the
verified owner in the editor, real for everyone else. Orders are priced in
USD; VAT and payment methods follow the player's country.

Currencies: real `coins` and fake `test-coins` (Test Silicon). With
`X-Store-Context: editor` the balance is Test Silicon and the editor never
spends real Silicon. Drafts are priced in Test Silicon, published items in
Silicon; publishing or taking down switches the currency, same amount.
`price.coins` is always the amount charged, whatever the currency.

## Endpoints

GET /api/session?gameId= (public)
: `{ authenticated, userId, username, email, environment: "dev" | "production", loginUrl, paymentMode: "sandbox" | "production" }`.

GET /api/session/login-complete (public, HTML)
: Landing page for the sign-in popup; closes itself.

GET /api/balance (session)
: `{ currency: "coins" | "test-coins", items: [{ sku, amount }] }`. `currency`
  is `"test-coins"` in the editor (only the Test Silicon entry is returned),
  `"coins"` everywhere else. The client returns `{ currency, amount }`.

POST /api/balance/refresh (session, no body)
: Same answer as `GET /api/balance`, read from Xsolla now: for the moment the
  player comes back from the top-up page, so a new top-up shows at once. The
  store calls it when the game tab is visible again within ten minutes of Get
  Silicon (`controller.returnedToGame()`). A read made in the last 10 s is
  reused. An older API answers 404; the client then uses `GET /api/balance`.

POST /api/balance/test-coins/refill?gameId= (session, editor context, game owner)
: Grants 10,000 Test Silicon for free.
  `{ currency: "test-coins", granted: 10000, orderId }`. The balance updates
  about 1 s later; re-read it. 403 `EDITOR_OWNER_REQUIRED` outside the editor
  or for anyone but the game's owner.

GET /api/games/{gameId}/items (public)
: `{ items: GameItem[] }`, `GameItem = { sku, name, description, price: { coins, currency: "coins" | "test-coins" } | { free: true }, consumable, imageUrl, creatorId, gameId, draft }`.
  Drafts are included only for the verified owner in the editor.

GET /api/games/{gameId}/inventory (session)
: `{ items: [{ sku, name, description, imageUrl, consumable, quantity, remainingUses }] }`, this game's items only.

POST /api/games/{gameId}/items/{sku}/acquire (session, no body)
: Free items are claimed, priced items bought in the item's own currency.
  `{ sku, acquired: true, method: "free" | "coins", currency: "coins" | "test-coins" | null, orderId }`.
  `method` stays `"coins"` for a Test Silicon purchase; read `currency`
  (`null` for a free claim).
  Errors: 404 `ITEM_NOT_FOUND` (also for a draft the caller may not see),
  409 `ITEM_ALREADY_OWNED` (permanent, already owned), 409 `ITEM_UNAVAILABLE`,
  409 `INSUFFICIENT_FUNDS` with `details: { balance, price, shortfall, currency }`,
  409 `PURCHASE_LIMIT_EXCEEDED`, 409 `REAL_COINS_DISABLED_IN_EDITOR` (a
  published item bought from the editor), 409 `PRICE_CHANGED` (the item was
  published or taken down between the read and the purchase; reload),
  409 `OPERATION_IN_PROGRESS` (another request for the same item is still
  running, e.g. a double click; try again in a moment).

POST /api/games/{gameId}/inventory/{sku}/consume (session) body `{ quantity }`
: `{ sku, quantityConsumed, remainingQuantity }`.
  Errors: 404 `ITEM_NOT_OWNED`, 409 `ITEM_NOT_CONSUMABLE`, 409 `INSUFFICIENT_QUANTITY`,
  409 `OPERATION_IN_PROGRESS` (the same item is being consumed or bought by
  another request; try again in a moment).

Silicon packages (`/api/payment/packages*`) are for the Sandbox top-up page
only. Games must not call them: Get Silicon opens that page in a new tab and
the store re-reads the balance when the game tab regains focus
(`POST /api/balance/refresh` within ten minutes of the click).

Reads (items, inventory, balance) come from the store API's own copy of
Xsolla, kept current by the API: a purchase, claim or consume shows in the
next read, and a top-up within seconds of its payment. Nothing in the game
changes for it.

Any route can answer 503 `STORE_UNAVAILABLE` while the store's database is
unavailable; retry shortly.

Errors share `{ error: { code, message, details? } }`. The client throws
`StoreApiError { status, code, message, details }`; network failures have
`code: "NETWORK"`, `status: 0`.

## Item authoring (creators, editor only)

Headers: `X-Genesys-Token` (the Studio token) and `X-Store-Context: editor`.
The Store Manager in the editor is the normal way; these calls are what it
uses.

POST /api/games/{gameId}/items
: Body `{ name: { en }, description: { en }, price: { coins } | { isFree: true }, consumable, imageUrl? }`.
  `201 { sku: "gi-<uuid>", gameId, created: true, draft: true }`. `consumable`
  is fixed at creation. A new item is a draft priced in Test Silicon.

PATCH /api/games/{gameId}/items/{sku}
: Any of `name`, `description`, `price`, `draft` (`false` publishes, `true`
  takes down), `imageUrl` (https, or `null` to remove).
  `200 { sku, gameId, updated: true }`. Clients send `price: { coins }`
  without a currency: a draft stays in Test Silicon, a published item in Silicon.
  Publishing switches the price to Silicon and taking down back to Test Silicon,
  same amount.

DELETE /api/games/{gameId}/items/{sku}
: Removes the item from the catalog. Players who own it keep it.
  `200 { sku, gameId, deleted: true }`.

Errors: 400 `GENESYS_TOKEN_REQUIRED`, 403 `NOT_GAME_OWNER`, 404 `GAME_NOT_FOUND`, 404 `ITEM_NOT_FOUND`.

## Catalog conventions

Every item carries the groups `game-item`, `game-<gameId>` and
`creator-<userId>`; drafts also carry `draft`. The API sets them; clients
never send groups. SKUs are `gi-<uuid>` and immutable.
