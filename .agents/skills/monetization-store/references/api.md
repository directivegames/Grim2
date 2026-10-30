# Store APIs

Two services sit behind the store. `src/store/store-client.ts` wraps every
endpoint the store uses; game code does not call either API directly.

- Core (tsb-core-api) owns the game's items and each player's inventory of
  them: list, buy or claim, consume. It charges purchases through the store
  API and adds the item to the inventory before it answers.
- The store API (`https://api-store.sandbox.game`, docs at `/api/docs`) keeps
  the session, the Silicon balance and Test Silicon.

## Core

One deployment per platform environment. `src/store/core-api.ts` picks it
from the host the game runs on (platform-owned; `localStorage['store.coreApiUrl']`
overrides it for testing):

- dev, `https://api-v2-dev.sandbox.game`: genesys-preprod, its CDN bucket,
  demo.sandbox.game, `localhost`.
- staging, `https://api-v2-staging.sandbox.game`: genesys-staging and its CDN bucket.
- production, `https://api-v2.sandbox.game`: every other host (studio,
  sandbox.game).

Identity: the Studio login only. The client sends the Keycloak access token
the Studio web app keeps on the page (`localStorage.keycloak_access_token`)
as `Authorization: Bearer <token>`, and no cookies. Studio never refreshes
or clears that token, so the client drops it when it is malformed or
expires within 30 s, and treats a core 401 as signed out of Studio. Core
cannot identify a player who has only the Sandbox platform cookie; for core
they are a guest. Reads of the item list work without a token.

GET /v2/games/{gameId}/items (public)
: `{ items: GameItem[] }`, `GameItem = { id, gameId, name, description, imageUrl, price, consumable, draft, onSale, storeSku, createdAt, updatedAt }`.
  `price` is whole Silicon, `0` for a free item. Players get published items
  on sale; the game's owner also gets drafts and items off sale. The client
  turns each into `{ itemId, name, description, price: { coins, currency } | { free: true }, consumable, imageUrl, draft }`
  (a draft's price is Test Silicon), drops items off sale, and drops drafts
  outside the editor. 404 `GAME_NOT_FOUND` when core does not know the game.

GET /v2/games/{gameId}/inventory (signed in)
: `{ items: [{ item: GameItem, quantity }] }`: every item of this game the
  player holds, deleted items included. The client returns
  `{ itemId, name, description, imageUrl, consumable, quantity }[]`.

POST /v2/games/{gameId}/items/{itemId}/acquire (signed in, no body)
: Free items are claimed, priced items paid in Silicon at once. Send
  `X-Store-Context: editor` from the editor: the game's owner then buys
  drafts with Test Silicon, and published items answer 409
  `REAL_COINS_DISABLED_IN_EDITOR`. Only the owner can buy drafts.
  `200 { itemId, orderId, currency: "coins" | "test-coins" | null, quantity }`
  (`currency` is `null` for a free claim; `quantity` is what the player now
  holds). `202 { itemId, pending: true }`: the store took longer than 30 s
  or named no order yet; the item arrives with core's daily check. The
  client waits up to 35 s and treats a 202, a timeout or a network failure
  alike: the purchase is being processed, never retried automatically.
  Errors: 401 `UNAUTHENTICATED`, 404 `GAME_NOT_FOUND` / `ITEM_NOT_FOUND`
  (also a draft or an item off sale the caller may not see), 409
  `ALREADY_OWNED` (permanent, already held), 409 `INSUFFICIENT_FUNDS` with
  `details: { balance, price, shortfall, currency }`, 409
  `REAL_COINS_DISABLED_IN_EDITOR`, 409 `NOT_PURCHASABLE`, 502 `STORE_ERROR`
  (the store refused or failed; nothing was granted).

POST /v2/games/{gameId}/inventory/{itemId}/consume (signed in) body `{ quantity }` (default 1)
: `{ itemId, consumed, remaining }`; at 0 the item leaves the inventory.
  Errors: 404 `NOT_OWNED`, 409 `NOT_CONSUMABLE`, 409 `INSUFFICIENT_QUANTITY`
  (`error.available` says how many are held).

Errors share `{ error: { code, message, details? } }`; an invalid body is
400 `{ error: { code: "VALIDATION", issues } }`. Core answers from its own
database: a purchase, claim or consume shows in the next read.

## Store API

### Environment and identity

The store API resolves the environment from the request `Origin`: the studio
and sandbox.game hosts are production; the internal development hosts and
`localhost` are development. Each environment validates its own platform
cookie and accepts its own Studio tokens. The environment never decides money:
every Pay Station payment is real, on dev and staging too (orders there are
recorded DEV and stay out of the reports). Only editor play uses Test Silicon.

Identity, in order:

1. `X-Genesys-Token`: the Studio token, the same one core receives. With
   `X-Store-Context: editor` (core forwards it only for the game's owner), the
   balance is Test Silicon and the session reports `paymentMode: "sandbox"`,
   display only. There is no Get Silicon in the editor.
2. The platform cookie, sent by browsers with `credentials: "include"` from
   any `*.sandbox.game` page. A page on plain `localhost` has neither and is
   a guest.

Sign-in: a player without the Studio login on a Studio host is sent to
Studio's sign-in page (`<origin>/auth/signin?redirect=<page>`), which brings
them back to the game. Elsewhere the client opens
`loginUrl?redirectTo=<api>/api/session/login-complete` in a popup and polls
`GET /api/session` every 2 s (up to 5 min, or until the player cancels),
then refreshes in place. The popup's `closed` flag is not used: the login
page's Cross-Origin-Opener-Policy makes it report closed while the form is
on screen.

Payment mode: sandbox on development; on production, sandbox only for the
verified owner in the editor, real for everyone else. Orders are priced in
USD; VAT and payment methods follow the player's country.

Currencies: real `coins` and fake `test-coins` (Test Silicon). With
`X-Store-Context: editor` the balance is Test Silicon and the editor never
spends real Silicon. Drafts are priced in Test Silicon, published items in
Silicon; publishing or taking down switches the currency, same amount.

### Endpoints

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

POST /v2/games/{gameId}/test-silicon/refill (core, Studio token, game owner)
: Grants 10,000 Test Silicon for free. `{ granted }`. The balance updates
  about 1 s later; re-read it. 403 `NOT_GAME_OWNER` for anyone but the game's
  owner, 404 `GAME_NOT_FOUND`. The store's own refill route is core-only; games
  never call it.

The store is in the editor unless the page set
`window._genesys_is_published_game_ = true` (the published play page does, before
the game starts). Editor context sends `X-Store-Context: editor`: Test Silicon,
drafts visible. Core answers a non-owner's editor purchase with 409
`REAL_COINS_DISABLED_IN_EDITOR`.

The store API also has `POST /api/games/{gameId}/items/{sku}/acquire` and
`/claim`. Core calls them on the player's behalf; games never do.

Silicon packages (`/api/payment/packages*`) are for the Sandbox top-up page
only. Games must not call them: Get Silicon opens that page in a new tab and
the store re-reads the balance when the game tab regains focus
(`POST /api/balance/refresh` within ten minutes of the click).

Any store route can answer 503 `STORE_UNAVAILABLE` while the store's
database is unavailable; retry shortly. Errors share
`{ error: { code, message, details? } }`. The client throws
`StoreApiError { status, code, message, details, service: "store" | "core" }` for both services;
network failures have `code: "NETWORK"`, `status: 0`.

## Item authoring (creators)

Items are created and edited in core by the game's owner, with the Studio
token. The editor's Store Manager and its MCP store tools are the normal way;
they reach core through the editor's own `/api/games/{gameId}/items` routes.

POST /v2/games/{gameId}/items
: Body `{ name, description?, imageUrl?, price, consumable?, draft?, onSale? }`:
  `name` 1 to 100 characters, `description` up to 500, `imageUrl` https,
  `price` whole Silicon from 0 (free) to 1,000,000, `consumable` (default
  false, fixed at creation), `draft` (default true), `onSale` (default
  true). `201 GameItem`. A new item is a draft priced in Test Silicon.

PATCH /v2/games/{gameId}/items/{itemId}
: Any of `name`, `description`, `imageUrl` (https, or `null` to remove),
  `price`, `draft` (`false` publishes, `true` takes down), `onSale`.
  `consumable` must equal the current value (400 `CONSUMABLE_IMMUTABLE`).
  `200 GameItem`. Publishing switches the price to Silicon and taking down
  back to Test Silicon, same amount.

DELETE /v2/games/{gameId}/items/{itemId}
: Takes the item off the store and out of the game. Players who hold it keep
  it. `200 { success: true }`.

Errors: 401 `UNAUTHENTICATED`, 403 `NOT_GAME_OWNER`, 404 `GAME_NOT_FOUND`
(core learns of games from the editor's game webhook), 404
`ITEM_NOT_FOUND`, 502 when the store refused the change (nothing changed).

Core mirrors each item into the store's catalog (`storeSku`) and keeps the
two in step; games and creators never use the SKU.
