---
name: monetization-store
description: Use when a Genesys game should sell items to players — an in-game store, shop, Silicon (formerly Coins), buying, top-up, Get Silicon, inventory of bought items, permanent or consumable items — or when an existing store shows guest, unlinked, insufficient Silicon, or top-up problems. Games never sell Silicon themselves; Get Silicon opens the Sandbox top-up page. Entry point; `monetization-store-components` holds the code, `monetization-store-items` covers creating and testing items.
metadata:
  tokens: 1472
---

# Monetization Store

An in-game store for Sandbox games. Players buy the creator's items with
Silicon in one click, top up Silicon on the Sandbox top-up page (Get Silicon
opens it in a new tab), and see what they own. The UI is built from the engine's UI kit widgets, so it matches
the rest of the game and can be re-skinned.

## How it works

- One API, `https://api-store.sandbox.game`, decides everything from where the
  game runs: the platform environment, who the player is, and which money is
  spent (real Silicon in a published game, Test Silicon for the game's owner
  playing in the editor). The game never handles tokens, environments, or
  payment modes.
- Players are identified by the Sandbox platform cookie. A player who is not
  signed in can browse; buying opens the platform login in a popup and the
  store updates itself without reloading the game.
- Silicon is one shared balance across all Sandbox games. It is the premium
  currency formerly called Coins; the API still names it `coins` (SKU, price
  and balance fields), only the display name changed.
- A game never sells Silicon. Get Silicon opens the Sandbox top-up page in a
  new tab; the store re-reads the balance when the player comes back to the
  game tab, and polls it every 5 s for ten minutes after the click while the
  store is open.
- Items belong to one game and carry their creator; the API derives both,
  the game only knows SKUs.
- New items are drafts: visible and buyable only for the game's owner in the
  editor until published. Players never see drafts.
- In the editor the store runs on Test Silicon: fake money, tagged TEST, with
  a "Refill Test Silicon" button in place of Get Silicon (10,000 per refill).
  Drafts are priced in Test Silicon; published items cost real Silicon, so the
  editor shows them with a disabled "Published" button.

## Adding the store to a game

1. Link the project to a game: run
   `genesys.actionStore({ action: 'linkGame' })` through the editor's MCP
   (`monetization-store-items`). It registers the game under the creator's
   Studio login and writes `gameId` into `<project>.genesys-project`, as
   opening Store Manager does; when the project is already linked it returns
   the existing id. No approval is needed. When the result has
   `gameCreated: true`, tell the creator the game was registered and give
   the id. Errors name the fix (`store_not_signed_in`, `no_project_open`,
   `store_disabled`, `store_link_failed`); pass it on and retry.
2. Run the install script from the project root:
   `node .agents/skills/monetization-store-components/scripts/install-store.mjs`.
   It copies `src/store/` and `assets/ui/store/` from
   `monetization-store-components/templates`, writes the `gameId` into
   `src/store/store-config.ts`, and checks the engine has the widgets the
   store uses. Rerun it later to update the templates; it keeps
   `store-config.ts`.
3. In the game mode (`src/game.ts`, the class extending `ENGINE.GameMode`),
   install in `beginPlay` and destroy in `endPlay` — snippet in
   `monetization-store-components/references/components.md`.
4. Create the items through the editor's MCP store tools
   (`monetization-store-items`). The creator can review and edit them later
   in the editor's Store Manager (main menu).
5. React to purchases where the gameplay effect belongs:
   `store.controller.on('purchased' | 'claimed' | 'consumed', ({ sku }) => …)`
   and `store.controller.owns(sku)` when a level loads. SKUs come from the
   Store Manager; keep them in one `src/store-items.ts` as named constants.
6. `pnpm build` and `pnpm lint`, then play in the editor: the `B` key or the
   HUD chip opens the store, running on Test Silicon.

Ask the creator only what the templates cannot decide, before writing code:
what the store should sell and what each item does in the game, the hotkey
(default `B`) and an accent color (default: the kit's blue). One short
message with the open points; everything else has a working default. Item
details (type, price, image, draft or publish) follow the questions in
`monetization-store-items`.

## Rules

- Do not modify `src/store/` on install. Customize afterwards through
  `store-config.ts` and `monetization-store-components/references/customization.md`.
- Never add token or cookie handling for players, never read the game id from
  the URL, never hard-code environment URLs: the API returns `loginUrl`, and
  the top-up page URLs live in `src/store/top-up.ts` (platform-owned).
- Never sell Silicon inside a game: no Silicon packs, no Pay Station, no calls
  to `/api/payment/packages`. Those routes belong to the Sandbox top-up page.
  If a creator asks for an in-game top-up, explain that Get Silicon already
  sends players to the Sandbox page, and do not build one.
- Purchases are one click, without a confirmation dialog. Insufficient
  Silicon shows "You need N more Silicon" with a Get Silicon button (in the
  editor, the error and Refill Test Silicon instead); do not add an error
  popup, and do not open the top-up tab automatically (browsers block tabs
  that a click did not open).
- Dynamic text goes through widget setters or `textContent`. `imageHtml`
  only receives markup from `safeImageHtml` or developer-authored SVG.
- Gameplay reacts to controller events and `owns(sku)`; it never calls the
  API directly.

## References

- `references/api.md` — endpoints, shapes, error codes.
- `references/troubleshooting.md` — symptoms and causes.
- `monetization-store-components` — the code, options, events, customization.
- `monetization-store-items` — creating, pricing, publishing and testing items.
