# stat-upgrades — Design Rationale

## Why infinite levels

Capping stat upgrades creates a hard finish line that removes long-term player motivation. Infinite levels with an exponential cost curve instead make every level meaningful: the first few are quick wins, while later levels are genuine long-term investments. The cost curve means a player who grinds twice as long does not have twice as many upgrades.

## Why exponential cost

Linear cost distributes progress evenly. Exponential cost `baseCurrencyCost × multiplier^level` means each level costs approximately as much as all previous levels combined (at multiplier = 2). This produces a natural "content frontier" — players always have something to work towards but cannot trivially out-level the game.

## Why item ladders

Early levels costing currency only let players feel immediate progress without material gating. Later levels adding item requirements introduce a secondary grind that ties upgrade progression to gameplay loops (enemies drop materials). The ladder pattern — free early, escalating late — is the most common balancing tool in live-service and roguelite games for exactly this reason.

## Why diminishing returns

The hyperbola `cap × raw / (raw + k)` guarantees no stat reaches the cap regardless of investment, without requiring a hard level cap. It is preferable to a hard limit because:
- It never punishes players for buying more levels (gains are small but always positive).
- It never creates an "I've maxed this stat, now what?" moment.
- Two constants (`cap`, `k`) with clear geometric meaning are easy for a designer to tune.

## Combining with other skills

`stat-upgrades`, `skill-upgrades`, and `item-shop` all use currency and inventory. If you use more than one, merge their profile schemas into a single shared `localStorage` key rather than three separate keys. Each skill's `assets/` file defines the minimal profile it needs; combine the fields.
