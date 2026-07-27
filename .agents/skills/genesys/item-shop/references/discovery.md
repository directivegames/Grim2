# Item Discovery

Items are hidden in the shop until the player first encounters one. This keeps the shop UI clean early in the game and rewards exploration.

## How to trigger discovery

Call `shop.discoverItem(itemId)` when a player first picks up a new item type:

```ts
// In your drop / loot system:
const dropped = rollLootDrop();    // returns an itemId
shop.addItem(dropped, qty);        // adds to inventory
shop.discoverItem(dropped);        // unlocks it in the shop
```

The second call is idempotent — calling `discoverItem` on an already-discovered item is a no-op.

## unlockedByDefault

Items marked `unlockedByDefault: true` are always listed without requiring discovery:

```ts
{ itemId: 'health_potion', baseCurrencyPrice: 25, priceMultiplier: 1.12, unlockedByDefault: true }
```

Use this for the most common materials players need immediately and would otherwise be confused not to find in the shop.

## Save safety

On every load, `unlockedByDefault` items are re-injected into `discoveredItems` even if they were missing from a legacy or corrupted save. This prevents a player from permanently losing access to default items.

## Checking discovery

```ts
shop.isDiscovered('rare_crystal');   // true if found at least once, or unlockedByDefault
```

Use this to decide whether to show a "???" placeholder row in the shop UI or hide the slot entirely.
