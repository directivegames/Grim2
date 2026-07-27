# item-shop — Design Rationale

## Why escalating prices

A flat price creates no tension around when to buy. Escalating prices introduce a strategic layer: bulk buying is possible but costly, so players must decide whether to buy now or save currency for upgrades. The multiplier is small enough that early bulk buying is affordable but punishing at scale — the price curve naturally throttles how many materials a player can stockpile per session.

## Why discovery gating

Showing every possible material in the shop from the start creates overwhelming choice and spoils the discovery loop. Players who have not yet seen a material have no emotional connection to it; showing it would only clutter the UI. Discovery gating keeps the shop focused on materials the player already knows matter to them.

`unlockedByDefault` items bypass gating because they are the foundational materials every player needs immediately — gating them would punish new players who have not yet progressed far enough to discover them.

## Why re-inject default items on load

If a designer adds a new `unlockedByDefault` item in a patch, all existing players should see it immediately in the shop without needing to discover it first. The load path always ensures default items appear, making the feature forward-compatible with content additions.

## Combining with other skills

If using `item-shop` alongside `stat-upgrades` or `skill-upgrades`, they all share currency and inventory. Rather than three separate `localStorage` keys, merge all profile schemas into a single store. Each skill's `assets/` file defines the minimal fields it needs — combine `currency`, `inventory`, `statLevels`, `skillLevels`, `discoveredItems`, and `shopPurchaseCounts` into one profile object.
