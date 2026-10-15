# Troubleshooting

"This project is not linked to a game yet"
: `store-config.ts` has an empty `gameId` and the runtime id is a placeholder
  (`"editor"`, `"dev-game"`). Run `genesys.actionStore({ action: 'linkGame' })`
  (it writes `gameId` into `<project>.genesys-project`) and rerun the install
  script, or copy `gameId` from `<project>.genesys-project` into
  `store-config.ts`.

Guest state in the editor
: The creator is not signed into Studio, or the game runs on plain
  `localhost` (`pnpm dev`), where no platform cookie exists. Sign into Studio
  and play in the editor. Do not forward a token for players.

"Not signed in" in a published game although signed into Studio
: Players are identified by the platform cookie from sandbox.game; the Studio
  login never reaches the store API. Sign in through the store's Sign in
  button: the login opens in a popup and the store updates within 2 s. The
  popup may stay open afterwards; the player closes it.

Console warning "store-config.ts gameId differs from the running game"
: The published game passed a different id than the config. The running game
  wins; set `store-config.ts` to the same id so the editor tests the same
  game.

Empty store although items exist
: The items belong to another game id, or they are drafts and the store is
  not running as the owner in the editor. Check
  `GET /api/games/<gameId>/items` in the Network tab.

Draft items visible to a player
: They are not; the public listing excludes the `draft` group and `acquire`
  answers 404 for it. In the editor the owner sees drafts with a Draft chip,
  a dashed frame and a watermark.

`OPERATION_IN_PROGRESS` (409)
: Two requests for the same item at once (a double click, or a consume fired
  twice in a frame). The first one goes through; the second is refused
  without touching the player's items. Wait for the first (the panel's busy
  state does) and try again.

`STORE_UNAVAILABLE` (503)
: The store API's database is briefly unavailable. Nothing was bought or
  consumed; retry after a few seconds.

A top-up does not show after coming back to the game
: The store reads the balance from Xsolla when the game tab is visible again
  within ten minutes of Get Silicon (`POST /api/balance/refresh`), and polls
  every 5 s while the panel stays open. If it still does not show, the
  payment has not finished on the top-up page.

`INSUFFICIENT_FUNDS`
: Handled: the panel shows "You need N more Silicon" with a Get Silicon
  button. If it does not show, `install-store.ts` no longer subscribes the
  panel to `state`. In the editor (Test Silicon) there is no Get Silicon: the
  panel shows the error and the header button reads "Refill Test Silicon"
  (10,000 per refill; the balance updates about a second later).

`REAL_COINS_DISABLED_IN_EDITOR`
: The item is published, so it costs real Silicon, and the editor spends only
  Test Silicon (its card shows a disabled "Published" button). Take it down to
  draft in the Store Manager to test it with Test Silicon.

`PRICE_CHANGED`
: The item was just published or taken down, so its currency switched
  between the read and the purchase. Reopen the store (or
  `store.controller.refresh()`) and buy again.

`ITEM_ALREADY_OWNED` on a permanent item
: The card should already show Owned. If it shows Buy, the inventory is
  stale: `store.controller.refresh()`.

Bought item not in the inventory right after the purchase
: The store re-reads the inventory for up to 6 s after a purchase; Xsolla
  delivers with a short delay.

CORS error or `Origin` rejected
: The game is served from a host the API does not allow. Allowed: the studio
  and sandbox.game hosts, the internal development hosts, `localhost`. A new
  host is an API change.

Get Silicon does nothing, or says pop-ups are blocked (`POPUP_BLOCKED`)
: The browser blocked the new tab. The player allows pop-ups for the game's
  page and clicks Get Silicon again. The tab only opens from the click
  itself; code that calls `controller.getSilicon()` after an `await` or a
  timer gets blocked.

`TOP_UP_NOT_CONFIGURED`
: `src/store/top-up.ts` has no URL for this environment. It is filled by
  the platform, not the creator: update the store templates (install script)
  to get the current URLs.

The balance did not change after a top-up in the other tab
: The store re-reads it when the game tab is visible or focused again, and
  every 5 s for ten minutes after Get Silicon while the store is open.
  Xsolla credits a moment after the payment; switching back to the game tab
  re-reads it. `store.controller.refreshBalance()` forces a read.

A card is declined or priced in an unexpected currency on the top-up page
: Not a store problem: the top-up page owns the checkout. Orders are priced
  in USD; VAT and payment methods follow the player's country.

Hotkey does nothing
: Another input handler consumed the key, or focus is in a text field (the
  store ignores keys while typing). Change `hotkey` in `store-config.ts`, or
  open via the HUD chip or `store.open()`.

Pointer lock stays off after closing
: Pointer lock needs a user gesture; if the panel was closed by code, the
  next click re-locks. Escape or the close button restores it.

Items created but the store shows old data
: The API caches the catalog briefly. Wait a minute or call
  `store.controller.refresh()`.

Store templates behind the shipped ones
: The footer shows `store v<version>`; the shipped version is
  `STORE_VERSION` in `monetization-store-components/templates/src/store/store-config.ts`.
  Rerun the install script; it updates every file except `store-config.ts`.
