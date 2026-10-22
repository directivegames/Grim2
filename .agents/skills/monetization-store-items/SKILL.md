---
name: monetization-store-items
description: Use when a creator wants to add, price, edit, publish, take down, or delete an item in their game's store, give an item a gameplay effect, or test buying without spending money — item SKUs, drafts, free items, consumables, Silicon prices, item images. Start from `monetization-store` for what the store is.
metadata:
  tokens: 1886
---

# Monetization Store Items

Items belong to one game. Each has an immutable SKU (`gi-<uuid>`), a name, a
description, a price in Silicon or Free, a type (permanent: bought once and
kept; consumable: used up and bought again, stacks in the inventory), and an
optional https image. The type cannot change after creation.

## Before creating anything

Items shape the game's economy and take real money from players, so confirm
the intent before the first call. Ask, in one short message, only what the
request left open:

- What each item does in the game (the effect drives the type: an effect that
  is used up is a consumable, a lasting one is permanent).
- Permanent or consumable, when the effect leaves it ambiguous.
- Price in Silicon or free, and whether the creator wants a rough tier
  (small, medium, large) or exact numbers. Never invent prices silently.
- An image per item, or placeholder art for now.
- Publish right away, or keep as drafts to test in the editor with Test
  Silicon first (the default is draft).

Skip the questions when the creator already answered them; do not ask about
things the templates decide.

## Creating and managing items

Store Manager, in the editor's main menu, is where the creator can review
and edit the store themselves: it lists the items with their Draft or Live state and SKU (copy button),
and offers New Item, Edit, Publish, Take Down and Delete. The image is an
https URL or a file uploaded to the game's assets. Every new item starts as
a draft.

Agents create and edit items through the editor's MCP tools, which run in
the editor with the creator's Studio login; no token is ever needed or
handled. The tools are hidden from the compact surface: call them through
`run_script` (`genesys.queryStore`, `genesys.actionStore`) or
`batch_execute`, after the readiness probe in the `genesys-mcp-orchestrator`
skill. A project must be open in the editor.

`genesys.queryStore({ operation })`:

- `getState` — game id (`null` until linked), whether `src/store` is installed, the store session (who the API recognises, environment, payment mode).
- `listItems` — every item including drafts: `sku`, `name`, `description`, `price`, `consumable`, `imageUrl`, `draft`.

`genesys.actionStore({ action, ... })`:

- `linkGame` — no arguments, no approval. Registers the project as a game and writes `gameId` into `<project>.genesys-project`, as opening Store Manager does; returns `gameId` and `gameCreated` (false when it was already linked).

The item actions return the item's `sku`. When the project is not linked yet they link it first and add `gameCreated: true`; mention the new game id to the creator.

- `createItem` — `name`, `description` (defaults to the name), `coins` or `free: true`, `consumable` (default false), optional https `imageUrl`. New items are drafts.
- `updateItem` — `sku` plus any of `name`, `description`, `coins` / `free`, `imageUrl` (`null` removes the image).
- `publish` / `takeDown` — `sku`.
- `deleteItem` — `sku`; destructive.
- `setImage` — `sku` and `filePath`: a PNG, JPEG or WebP anywhere on the computer (a file the creator dropped into the chat, or `@project/assets/...`), uploaded to the game's assets.

```js
// run_script(apply)
const created = await genesys.actionStore({ action: 'createItem', name: 'Storm Cloak', description: 'Walk through rain.', coins: 750, consumable: false });
await genesys.actionStore({ action: 'setImage', sku: created.sku, filePath: '/Users/me/Downloads/cloak.png' });
await genesys.actionStore({ action: 'publish', sku: created.sku });
```

When MCP is off, the agent cannot reach the editor: ask the creator to open
Store Manager (it links the game on open), create the item there and copy
its SKU (each row shows it); do not ask for a token and do not propose
pasting scripts into the browser.

## After creating

Report every item with its SKU, price, type and state. Say that new items
are drafts: only the creator sees them, in the editor, until they are
published, and that each can be changed or published later in the editor's
Store Manager or by asking here (publish, take down, change the price, set
an image, delete).

SKUs of published items are readable by anyone:
`GET /api/games/<gameId>/items` (no token). Drafts are listed only with the
owner's session.

Drafts: visible and buyable only for the game's owner playing in the editor,
where they show a Draft chip, a dashed frame and a watermark, and cost Test
Silicon. A published game never lists or sells a draft. Publish with Take Down
reversed: a taken down item disappears from the store; players who bought it
keep it.

Delete removes the item from the catalog for everyone; owners keep it in
their inventory. A deleted SKU never comes back; create a new item instead.

## Giving an item an effect

The store delivers items and keeps the inventory; the game decides what an
item does. Keep SKUs in one file:

```ts
// src/store-items.ts
export const STORE_ITEMS = {
  lantern: 'gi-…',
  healingHerb: 'gi-…',
} as const;
```

Permanent items: apply the effect when the store is ready and after each
purchase or claim.

```ts
store.controller.on('ready', () => {
  if (store.controller.owns(STORE_ITEMS.lantern)) enableLantern();
});
store.controller.on('purchased', ({ sku }) => { if (sku === STORE_ITEMS.lantern) enableLantern(); });
store.controller.on('claimed', ({ sku }) => { if (sku === STORE_ITEMS.lantern) enableLantern(); });
```

Consumables: the player uses one from the Inventory tab, or the game consumes
one itself.

```ts
store.controller.on('consumed', ({ sku, remainingQuantity }) => {
  if (sku === STORE_ITEMS.healingHerb) heal(50);
});
// from gameplay, e.g. a hotkey:
if (store.controller.quantityOf(STORE_ITEMS.healingHerb) > 0) void store.controller.consume(STORE_ITEMS.healingHerb);
```

`owns(sku)` and `quantityOf(sku)` read the loaded inventory; they are
synchronous and cheap.

## Testing an item

- In the editor the game's owner sees drafts and the store runs on Test
  Silicon: fake money tagged TEST, refilled with "Refill Test Silicon" (10,000
  each time). A draft is priced in Test Silicon; publishing switches its
  price to real Silicon, same amount, and taking it down switches it back.
- Published items cost real Silicon, so the editor shows them with a
  disabled "Published" button. To test one again, take it down to draft.
- Test purchases never count in sales statistics (recorded with currency
  test-coins). A permanent item bought as a draft stays owned.
- Permanent items can be bought once per account; test repeated purchases
  with a consumable.
- To test what players see, publish the game as a draft and open it on
  studio outside the editor, signed in on sandbox.game: drafts are absent,
  live items are buyable with real Silicon.
- The panel footer shows `test silicon` when the balance is Test Silicon,
  `drafts visible` when drafts are listed, and `sandbox payments` when the
  API reports a sandbox payment mode. That last one is informational: games
  never sell Silicon (Get Silicon opens the Sandbox top-up page), and there
  is no top-up in the editor.

## Images

An https URL, or a file uploaded through the Store Manager into the game's
assets (`games/<gameId>/store/` on the CDN). Square images look best; the
tile crops to a square. Without an image the tile shows placeholder art by
kind.
