# Components

Logic (`store-config.ts`, `store-client.ts`, `store-controller.ts`) is
engine-free. Components extend `ENGINE.BaseUIComponent`, load their template
and stylesheet from `@project/assets/ui/store/`, and compose UI kit widgets
with `mountChild`.

## installStore(world, overrides?) — `install-store.ts`

Builds the client and controller, mounts the HUD chip, panel and toast on
`world.uiManager`, registers the hotkey handler on `world.inputManager`,
wires pointer lock, the visibility re-check and the balance re-read on
`visibilitychange` and window `focus` (a Silicon top-up in another tab),
opens Get Silicon tabs with `window.open` (opener cleared), logs
`[Store] …` lines for events and errors (the start-up line names the core
origin), and calls `controller.init()` with `world.netWorld.gameId`. Sends
`X-Store-Context: editor` unless the page set `window._genesys_is_published_game_ = true`
(the published play page does; editor play, local folder play and `pnpm dev` do
not), so only the page, never the runtime game id, decides editor or player. Picks the
core origin with `resolveCoreApiUrl(location.hostname)`; reads
`localStorage['store.apiBaseUrl']` and `localStorage['store.coreApiUrl']`
once as origin overrides for testing.

## StoreController — `store-controller.ts`

`state: StoreState`:

- `phase`: `unlinked | loading | guest | ready | empty | error`
- `isOpen`, `activeTab` (`shop | inventory`)
- `gameId`, `gameIdSource` (`runtime | config | none`), `gameIdMismatch`
- `session`, `balance`, `currency` (`coins`, or `test-coins` in the editor), `items: ItemView[]` (each with `owned`, `quantity`, `action`, `draft`), `inventory`
- `busyItemId`, `pendingItemIds` (purchases being processed: core answered 202 pending or gave no answer in time; each settles when the inventory shows the item), `needsStudioLogin` (the store knows the player by the platform cookie but core does not: the page has no unexpired Studio login, or core answered 401; the store stays a guest), `loginPending`, `awaitingTopUp` (Get Silicon opened the top-up tab and the balance is being polled), `refillPending`, `shortfall` (Silicon missing for the last purchase; cleared when the balance changes), `lastError`

`ItemAction`: `buy | buy-again | claim | owned | published | processing`.
`published` marks a real-Silicon item while the balance is Test Silicon
(editor): not buyable there. `processing` marks an item whose purchase is
being processed: not buyable again until it settles.

Actions:

- `init()`, `refresh()`, `checkSession()` (reloads only if the identity changed)
- `open()`, `close()`, `toggle()`, `setTab(tab)`
- `acquire(itemId)`: one click; free items are claimed, priced items bought;
  guests start the sign-in instead; core adds the item before it answers, so
  one inventory read follows; `INSUFFICIENT_FUNDS` sets `shortfall` and emits
  `needs-coins` (the panel shows it next to Get Silicon), except for Test
  Silicon (the error shows next to Refill). A 202 pending answer, or no
  answer within 35 s (timeout or network failure: the purchase may still go
  through), adds the item to `pendingItemIds` and emits `purchase-pending`
  instead of an error; ignored while the item is pending. `open()` and every
  refresh re-read inventory and balance, and `purchased` or `claimed` fires
  once the item shows up
- `consume(itemId, quantity = 1)`
- `getSilicon()`: opens the Sandbox top-up page (`top-up.ts`, by environment)
  in a new tab and polls the balance every 5 s for up to ten minutes while
  the panel is open; call it from the click itself or the browser blocks the
  tab. Errors `POPUP_BLOCKED`, `TOP_UP_NOT_CONFIGURED`. No-op while the
  balance is Test Silicon. Guests get the page too; it handles sign-in.
- `refreshBalance({ fresh? })`: re-reads the balance, emits `balance-changed`
  on a change; concurrent calls share one request, failures are ignored.
  `fresh: true` asks the API to read Xsolla now (`POST /api/balance/refresh`)
- `returnedToGame()`: install-store calls it when the game tab is visible or
  focused again; within ten minutes of Get Silicon it reads the balance
  fresh, otherwise as usual
- `refillTestCoins()`: editor, game owner only; calls core
  `POST /v2/games/{gameId}/test-silicon/refill`; adds 10,000 Test Silicon and
  re-reads the balance once it lands
- `logIn()`: without a Studio login core accepts, on a Studio host, a
  full-page visit to Studio's sign-in, which returns to the game; with
  `needsStudioLogin` off Studio hosts, the error `STUDIO_LOGIN_REQUIRED`;
  otherwise the platform login in a popup with session polling (full-page
  redirect when popups are blocked). `cancelLogIn()`
- A core 401 while loading, in `acquire` or in `consume` sets
  `needsStudioLogin` and shows the guest view instead of an error;
  `checkSession()` reloads as a guest once the token expires
- `owns(itemId)`, `quantityOf(itemId)`
- `on(event, handler)` returns an unsubscribe function; `destroy()`

Events:

- `ready` `{ items, inventory, balance }`
- `purchased` `{ itemId, orderId }`: the item is in the inventory (`orderId` is null after a pending purchase)
- `purchase-pending` `{ itemId, reason: 'pending' | 'no-answer' }`: being processed; do not grant the item until `purchased` or `claimed`
- `claimed` `{ itemId }`
- `consumed` `{ itemId, remainingQuantity }`
- `balance-changed` `{ amount, currency }`
- `test-coins-refilled` `{ granted }` (editor only)
- `needs-coins` `{ itemId, shortfall }`
- `signed-in` `{ userId, username }`
- `opened`, `closed`
- `error` `{ code, message }`
- `state` (full snapshot on every change; the UI subscribes to this)

## StoreClient — `store-client.ts`

Store API: `getSession(gameId?)`, `getBalance()` (returns
`{ currency, amount }`), `getFreshBalance()`, `refillTestCoins(gameId)`.
Core: `listItems(gameId)` (`GameItem { itemId, name, description, price, consumable, imageUrl, draft }`,
`price` is `{ coins, currency }` or `{ free: true }`; items off sale are
dropped, and drafts outside the editor), `getInventory(gameId)`,
`acquire(gameId, itemId)` (result carries `currency`, `quantity`, `pending`; waits up to `acquireTimeoutMs`),
`consume(gameId, itemId, quantity)`. `hasGenesysToken()` says whether the
page has a Studio token that is well formed and lives more than 30 s
(`usableToken(token, nowMs)`); an expired one is never sent.
`isCoreLoginRejected(error)` is true for a core 401. No package or Pay Station methods: Silicon is
sold on the Sandbox top-up page only. Options: `baseUrl` (store API),
`coreBaseUrl`, `fetchImpl`, `genesysToken`, `context`, `now`, `timeoutMs`
(10 s, every request but a purchase), `acquireTimeoutMs` (35 s: core waits
up to 30 s for the store). A request with no answer throws status 0 with
`TIMEOUT` or `NETWORK`; `isOutcomeUnknown(error)` is true for those on core.
Throws `StoreApiError` for both services, with `service: 'store' | 'core'`. `baseUrl` and `coreBaseUrl` are public.

## StoreHudButton — `ui/store-hud-button.ts`

Options `position`, `hotkey`, `accent`, `onOpen`. Composes `ENGINE.Button`
("Shop") and `ENGINE.Keystroke`. Sizes to its content and hugs the configured
corner.

## StorePanel — `ui/store-panel.ts`

Options `accent`, `showSessionInfo`, `onClose`, `onGetSilicon`, `onRefill`,
`onTab`, `onRetry`, `onLogin`, `onCancelLogin`, `onAction(itemId, action)`.
Header with the balance chip, Get Silicon (`ENGINE.Button`, gold; its slot
keeps the old name `data-store-get-coins-slot`) and a bare
close icon; in the editor the balance is Test Silicon with a TEST tag and the
button reads "Refill Test Silicon"; text tabs Shop and Inventory with counts;
guest bar with one Sign in button that turns into Cancel sign-in while the
popup is open (with `needsStudioLogin` its line says buying needs the
Sandbox Studio login); a gold top-up bar ("You need N more Silicon for this item."
or, while `awaitingTopUp`, "Finish your top-up in the Silicon tab…") with its
own Get Silicon button, never in the editor; grid of `StoreItemCard`;
loading, empty, error and unlinked views; footer line
`store v<version> · <username | Not signed in> · <environment> [· editor play (test money)] [· test silicon] · game <id> [· drafts visible]`.
`render(state)` is serialized; the latest state wins.

## StoreItemCard — `ui/store-item-card.ts`

One tile: art (the item image, or placeholder art per kind: potion for
consumables, crest for permanents, gift for free items), type chip, owned
count, Draft chip with a dashed frame and watermark for drafts, name,
two-line description, price row (a TEST tag on a Test Silicon price), one
`ENGINE.Button`.
`buttonSpecFor(view, mode, guest)` decides the label: Shop tab — Buy, Buy
another, Claim, Claimed, Owned, or Sign in to buy / Sign in to claim for
guests, a disabled Published (tooltip: take it down to draft to test it
with Test Silicon) for `published`, or a disabled Processing… for
`processing`; Inventory tab — Use or Owned.

## PurchaseToast — `ui/purchase-toast.ts`

Wraps `ENGINE.Achievement`: `showPurchased(name, coins)`, `showClaimed(name)`,
`showProcessing(name)`, `showConsumed(name, remaining)`.

## top-up.ts

`SILICON_TOP_UP_URLS { production, dev }`: the Sandbox top-up page per
environment. Platform-owned; the install script overwrites it.

## core-api.ts

`CORE_API_URLS { production, staging, dev }`, `coreEnvironmentFor(hostname)`,
`resolveCoreApiUrl(hostname)` (dev on genesys-preprod, its CDN bucket,
demo.sandbox.game and `localhost`; staging on genesys-staging and its CDN
bucket; production elsewhere), `studioSignInUrl(location)` (Studio's
sign-in page returning to this page, or `null` off Studio hosts).
Platform-owned; the install script overwrites it.

## store-icons.ts

Developer-authored SVGs (icons and placeholder art), `formatCoins`,
`safeImageHtml(url, alt)` (https only, escaped attributes),
`accentButtonStyles(accent)`.
