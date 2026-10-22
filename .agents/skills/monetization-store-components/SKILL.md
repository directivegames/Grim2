---
name: monetization-store-components
description: Use when installing, updating, wiring, re-skinning, or replacing the in-game store's code — the `src/store/` controller and client, the `assets/ui/store/` UI components (HUD chip, Shop and Inventory panel, item tiles, Get Silicon, purchase toast) — or when the store's options, events, or state are needed. Start from `monetization-store` for what the store is.
metadata:
  tokens: 1736
---

# Monetization Store Components

`templates/` holds the store's source, copied into a game by
`scripts/install-store.mjs`:

- `src/store/store-config.ts` — `STORE_VERSION`, `StoreConfig`, `resolveGameId`.
- `src/store/store-client.ts` — typed wrapper of core and the store API, engine-free.
- `src/store/core-api.ts` — the core URL per host and Studio's sign-in page; platform-owned.
- `src/store/store-controller.ts` — state machine and events, engine-free.
- `src/store/install-store.ts` — `installStore(world, overrides?)`.
- `src/store/ui/*.ts` — components built on `ENGINE.BaseUIComponent`.
- `assets/ui/store/*.html`, `*.css` — templates and styles of the components.

## Install and update

`node .agents/skills/monetization-store-components/scripts/install-store.mjs`
from the project root:

- First run: copies both folders, writes `gameId` from
  `<project>.genesys-project` into `src/store/store-config.ts`, checks the
  engine (`.engine/src/ui/components`) has the widgets the store composes
  (`Button`, `Keystroke`, `Achievement`, `BaseUIComponent`), and prints the
  game-mode wiring.
- Later runs: compares `STORE_VERSION` in the project with the shipped one and
  overwrites every file except `store-config.ts` when the shipped version is
  newer. Nothing else in the project is touched.
- `--dry-run` lists what would be written. `--force` rewrites even when the
  versions match.

Wiring (once, by hand; the script prints it with the detected file):

```ts
import { installStore, type InstalledStore } from './store/index.js';

@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  private store: InstalledStore | null = null;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const world = this.getWorld();
    if (world?.gameContainer) {
      void installStore(world)
        .then((store) => {
          this.store = store;
          store.controller.on('purchased', ({ itemId }) => { /* grant the effect */ });
          store.controller.on('claimed', ({ itemId }) => { /* same as purchased for free items */ });
          store.controller.on('consumed', ({ itemId }) => { /* apply the consumable */ });
        })
        .catch((error: unknown) => console.error('[Store] install failed', error));
    }
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    this.store?.destroy();
    this.store = null;
    return true;
  }
}
```

`installStore` returns `InstalledStore { controller, open, close, toggle, destroy }`.
The `overrides` argument is a `Partial<StoreConfig>`.

## Where things happen

- Items and inventory: core, at the URL `core-api.ts` picks for the host
  (dev on genesys-preprod and `localhost`, staging on genesys-staging,
  production elsewhere). Core calls carry the Studio token as
  `Authorization: Bearer` and no cookies; `acquire` adds
  `X-Store-Context: editor` in the editor. `core-api.ts` is platform-owned
  and overwritten by updates; leave it alone.
- Identity, environment, payment mode: decided by the APIs from the request.
  Store API calls send `credentials: "include"`, the Studio token as
  `X-Genesys-Token`, and in the editor `X-Store-Context: editor`. Core needs
  the Studio login: a player with only the platform cookie, an expired
  token, or a token core answers 401 to browses as a guest
  (`state.needsStudioLogin`), and Sign in sends them to Studio's sign-in on
  Studio hosts. The client never sends a token that expires within 30 s.
- Currency: `state.currency` follows the balance the API returns. In the
  editor it is `test-coins`: the panel shows a TEST tag, "Refill Test Silicon"
  (`controller.refillTestCoins()`) replaces Get Silicon, and published items
  get the `published` action (a disabled button). `balance-changed` carries
  `{ amount, currency }`; `test-coins-refilled` carries `{ granted }`.
- Game id: `world.netWorld.gameId` when it is a real id (published game);
  otherwise `store-config.ts` (editor, local dev); otherwise the store is
  unlinked and makes no calls.
- Pointer lock: exited when the panel opens, restored when it closes.
- Session: re-read when the panel opens and when the tab becomes visible;
  the catalog reloads only if the identity changed.
- Silicon top-up: Get Silicon (`controller.getSilicon()`) opens the URL from
  `src/store/top-up.ts` for the session's environment in a new tab; games
  never sell Silicon. The balance is re-read when the game tab is visible or
  focused again (`controller.returnedToGame()`: within ten minutes of the
  click it asks the API to read Xsolla now, `POST /api/balance/refresh`), and
  polled every 5 s for up to ten minutes after the click while the panel is
  open. `top-up.ts` is
  platform-owned and overwritten by updates; leave it alone.
- Store version: `STORE_VERSION` is the first item of the footer line and of
  the `[Store] v…` start-up log.
- Closing: a tap on the dimmed area around the centred panel closes it
  (press and release both on the dimmed area); taps inside never do.
- Updating from before v1.0.0: the install script deletes the old Get Silicon
  modal (`ui/get-coins-modal.ts`, `package-value.ts` and its assets). Game
  code that called `openGetCoins()` or `buyCoins()` switches to
  `getSilicon()`.
- Updating from before v2.0.0: items live in core and are named by item id.
  Events carry `{ itemId }` instead of `{ sku }`; `owns`, `quantityOf`,
  `acquire` and `consume` take the item id; `state.busySku` is
  `state.busyItemId`. Replace the SKUs in `src/store-items.ts` with the item
  ids from the Store Manager. The install script prints this when it updates.

## Phones

The store switches to a phone layout when the game view is at most 600 px
wide or 480 px tall (CSS container queries on the store backdrops, so a small
editor play panel on a desktop gets it too). The panel fills the view; one
compact header row (title, balance, round gold + button, close); two-column
tiles without descriptions in portrait, more per row in landscape. On touch
screens tiles do not lift on hover
and the HUD chip hides its key hint. Desktop and tablet keep the regular
layout. Safe-area padding (`env(safe-area-inset-*)`) only takes effect when
the page's viewport meta has `viewport-fit=cover`. Restyling for phones:
`references/customization.md`.

## References

- `references/components.md` — every component, its options, the controller's state and events.
- `references/customization.md` — config levers, copy, styles, opening from the world, replacing a component.
