# Troubleshooting

"This project is not linked to a game yet"
: `store-config.ts` has an empty `gameId` and the runtime id is a placeholder
  (`"editor"`, `"dev-game"`, `"local"`). Run `genesys.actionStore({ action: 'linkGame' })`
  (it writes `gameId` into `<project>.genesys-project`) and rerun the install
  script, or copy `gameId` from `<project>.genesys-project` into
  `store-config.ts`.

Test Silicon or drafts show on a published game, or real Silicon in the editor
: The store reads `window._genesys_is_published_game_` from the page: `true` is
  a player store, anything else is the editor. Only the published play page
  `/play/<gameId>` sets it. If a custom host serves a published game, set the flag
  before the game starts.

Guest state in the editor
: The creator is not signed into Studio, or the game runs on plain
  `localhost` (`pnpm dev`), where the page has no Studio login. Sign into
  Studio and play in the editor. Do not add token handling to the game.

Guest in a published game although signed in on sandbox.game
: Core knows players only by their Studio login; the sandbox.game platform
  cookie is not enough to buy, claim or see the inventory. The guest bar
  says buying needs a current Sandbox Studio login; on a Studio host its
  Sign in button opens Studio's sign-in and comes back to the game. On other
  hosts there is no Studio login yet: the store stays a guest and Sign in
  answers `STUDIO_LOGIN_REQUIRED`.

Guest again after playing a while, or after a 401 `UNAUTHENTICATED` from core
: Handled: the Studio login on the page expired (Studio never refreshes the
  token games read) or core turned it down. The store ignores a token that
  expires within 30 s, and a core 401 while loading, buying or consuming
  turns the panel into the guest view with Studio's Sign in rather than an
  error. Signing in to Studio again brings the purchases back. If the panel
  shows an error with Retry instead, the store templates predate v2.0.1:
  rerun the install script.

404 `GAME_NOT_FOUND` from core
: Core learns of a game from the editor's game webhook when the game is
  created. A game created on a local editor (local database) never reaches
  core: link the project to a game created on the deployed editor.

Console warning "store-config.ts gameId differs from the running game"
: The published game passed a different id than the config. The running game
  wins; set `store-config.ts` to the same id so the editor tests the same
  game.

Empty store although items exist
: The items belong to another game id, they are drafts and the store is not
  running in the editor, or they are off sale. Check
  `GET <core>/v2/games/<gameId>/items` in the Network tab (the core origin
  is in the `[Store] v…` start-up log).

Draft items visible to a player
: They are not; core lists drafts only to the game's owner, the store shows
  them only in the editor, and `acquire` answers 404 for anyone else. In the
  editor the owner sees drafts with a Draft chip, a dashed frame and a
  watermark.

`STORE_ERROR` (502)
: Core could not complete the purchase in the store (a double click while
  the first purchase runs, the item's price switching as it is published or
  taken down, or the store briefly down). Nothing was granted; reopen the
  store (or `store.controller.refresh()`) and try again.

`STORE_UNAVAILABLE` (503)
: The store API's database is briefly unavailable (balance, session). Retry
  after a few seconds.

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

`ALREADY_OWNED` on a permanent item
: The card should already show Owned. If it shows Buy, the inventory is
  stale: `store.controller.refresh()`.

Bought item not in the inventory right after the purchase
: Core adds the item before it answers, so the next read shows it. When the
  store is slow (core waits up to 30 s, then answers 202 pending) or no
  answer reaches the game within 35 s, the card shows Processing… and the
  panel says the purchase is being processed: handled, nothing to retry.
  Opening the store or a refresh re-reads inventory and balance; once the
  item arrives (at the latest with core's daily check) `purchased` fires.
  A card that stays Processing… until the game reloads means the purchase
  never went through; the balance shows whether anything was charged.

CORS error or `Origin` rejected
: The game is served from a host an API does not allow. Core allows the
  `*.sandbox.game` hosts (and its configured extra origins); the store API
  the studio and sandbox.game hosts, the internal development hosts and
  `localhost`. A new host is an API change.

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
: Core answers from its database, so a change shows at the next read: reopen
  the store or call `store.controller.refresh()`.

Store templates behind the shipped ones
: The footer shows `store v<version>`; the shipped version is
  `STORE_VERSION` in `monetization-store-components/templates/src/store/store-config.ts`.
  Rerun the install script; it updates every file except `store-config.ts`.
