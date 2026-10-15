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
`[Store] …` lines for events and errors, and calls `controller.init()` with
`world.netWorld.gameId`. Sends `X-Store-Context: editor` when the runtime id
is a placeholder. Reads `localStorage['store.apiBaseUrl']` once as an API
origin override for testing.

## StoreController — `store-controller.ts`

`state: StoreState`:

- `phase`: `unlinked | loading | guest | ready | empty | error`
- `isOpen`, `activeTab` (`shop | inventory`)
- `gameId`, `gameIdSource` (`runtime | config | none`), `gameIdMismatch`
- `session`, `balance`, `currency` (`coins`, or `test-coins` in the editor), `items: ItemView[]` (each with `owned`, `quantity`, `action`, `draft`), `inventory`
- `busySku`, `loginPending`, `awaitingTopUp` (Get Silicon opened the top-up tab and the balance is being polled), `refillPending`, `shortfall` (Silicon missing for the last purchase; cleared when the balance changes), `lastError`

`ItemAction`: `buy | buy-again | claim | owned | published`. `published`
marks a real-Silicon item while the balance is Test Silicon (editor): not
buyable there.

Actions:

- `init()`, `refresh()`, `checkSession()` (reloads only if the identity changed)
- `open()`, `close()`, `toggle()`, `setTab(tab)`
- `acquire(sku)`: one click; free items are claimed, priced items bought;
  guests start the sign-in instead; after a purchase the inventory is re-read
  until the delivery shows (up to 6 s); `INSUFFICIENT_FUNDS` sets `shortfall`
  and emits `needs-coins` (the panel shows it next to Get Silicon), except for
  Test Silicon (the error shows next to Refill)
- `consume(sku, quantity = 1)`
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
- `refillTestCoins()`: editor, game owner only; adds 10,000 Test Silicon and
  re-reads the balance once it lands
- `logIn()` (popup and session polling; full-page redirect when popups are
  blocked), `cancelLogIn()`
- `owns(sku)`, `quantityOf(sku)`
- `on(event, handler)` returns an unsubscribe function; `destroy()`

Events:

- `ready` `{ items, inventory, balance }`
- `purchased` `{ sku, orderId }`
- `claimed` `{ sku }`
- `consumed` `{ sku, remainingQuantity }`
- `balance-changed` `{ amount, currency }`
- `test-coins-refilled` `{ granted }` (editor only)
- `needs-coins` `{ sku, shortfall }`
- `signed-in` `{ userId, username }`
- `opened`, `closed`
- `error` `{ code, message }`
- `state` (full snapshot on every change; the UI subscribes to this)

## StoreClient — `store-client.ts`

`getSession(gameId?)`, `getBalance()` (returns `{ currency, amount }`),
`listItems(gameId)` (`price` is `{ coins, currency }` or `{ free: true }`),
`getInventory(gameId)`, `acquire(gameId, sku)` (result carries `currency`),
`consume(gameId, sku, quantity)`, `refillTestCoins(gameId)`. No package or
Pay Station methods: Silicon is sold on the Sandbox top-up page only. Options: `baseUrl`,
`fetchImpl`, `genesysToken`, `context`, `timeoutMs`. Throws `StoreApiError`.
`baseUrl` is public for the sign-in return URL.

## StoreHudButton — `ui/store-hud-button.ts`

Options `position`, `hotkey`, `accent`, `onOpen`. Composes `ENGINE.Button`
("Shop") and `ENGINE.Keystroke`. Sizes to its content and hugs the configured
corner.

## StorePanel — `ui/store-panel.ts`

Options `accent`, `showSessionInfo`, `onClose`, `onGetSilicon`, `onRefill`,
`onTab`, `onRetry`, `onLogin`, `onCancelLogin`, `onAction(sku, action)`.
Header with the balance chip, Get Silicon (`ENGINE.Button`, gold; its slot
keeps the old name `data-store-get-coins-slot`) and a bare
close icon; in the editor the balance is Test Silicon with a TEST tag and the
button reads "Refill Test Silicon"; text tabs Shop and Inventory with counts;
guest bar with one Sign in button that turns into Cancel sign-in while the
popup is open; a gold top-up bar ("You need N more Silicon for this item."
or, while `awaitingTopUp`, "Finish your top-up in the Silicon tab…") with its
own Get Silicon button, never in the editor; grid of `StoreItemCard`;
loading, empty, error and unlinked views; footer line
`store v<version> · <username | Not signed in> · <environment> [· sandbox payments] [· test silicon] · game <id> [· drafts visible]`.
`render(state)` is serialized; the latest state wins.

## StoreItemCard — `ui/store-item-card.ts`

One tile: art (the item image, or placeholder art per kind: potion for
consumables, crest for permanents, gift for free items), type chip, owned
count, Draft chip with a dashed frame and watermark for drafts, name,
two-line description, price row (a TEST tag on a Test Silicon price), one
`ENGINE.Button`.
`buttonSpecFor(view, mode, guest)` decides the label: Shop tab — Buy, Buy
another, Claim, Claimed, Owned, or Sign in to buy / Sign in to claim for
guests, or a disabled Published (tooltip: take it down to draft to test it
with Test Silicon) for `published`; Inventory tab — Use or Owned.

## PurchaseToast — `ui/purchase-toast.ts`

Wraps `ENGINE.Achievement`: `showPurchased(name, coins)`, `showClaimed(name)`,
`showConsumed(name, remaining)`.

## top-up.ts

`SILICON_TOP_UP_URLS { production, dev }`: the Sandbox top-up page per
environment. Platform-owned; the install script overwrites it.

## store-icons.ts

Developer-authored SVGs (icons and placeholder art), `formatCoins`,
`safeImageHtml(url, alt)` (https only, escaped attributes),
`accentButtonStyles(accent)`.
