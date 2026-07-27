# Cell Size Tuning

## How queries scale with cell size

A radius query checks all cells within `ceil(radius / cellSize)` steps of the centre cell. The total cells examined is `(2 × range + 1)²`:

| radius | cellSize | range | cells checked |
|--------|----------|-------|---------------|
| 1      | 4        | 1     | 9             |
| 4      | 4        | 1     | 9             |
| 5      | 4        | 2     | 25            |
| 8      | 10       | 1     | 9             |
| 14     | 4        | 4     | 81            |
| 14     | 10       | 2     | 25            |

Increasing `cellSize` reduces cells checked but increases actors per cell. The sweet spot is `cellSize ≈ 4 × typical_radius`.

## Grim values

Grim uses `cellSize = 4` with a separation radius of ~0.88 units, a melee hit radius of ~1.0 unit, and a boomerang hit radius of ~0.8 units. The largest query radius in Grim is the Fist of Annoyance target search at 14 units, which checks 81 cells — still cheap at ~50 actors spread across hundreds of cells.

## When to increase cell size

Increase `cellSize` when your typical query radius is large (AoE spells, aggro ranges of 20+ units). A cell size of 10–12 keeps the ring at 9–25 cells for those cases.

## When to decrease cell size

Decrease `cellSize` when you have very dense packing (hundreds of actors in a small area) and small radii. Smaller cells reduce per-cell iteration but increase ring size.

## Multiple hashes for different radii

If you have both melee (radius 1) and long-range (radius 20) queries against the same actor set, use two hashes with different cell sizes and keep them both updated. This is usually not worth the complexity unless profiling shows it matters.

## Profiling signal

The hash is fast when most cells are empty. If you notice query time growing with actor count, check the average actors-per-cell with:

```ts
let total = 0;
let count = 0;
for (const [, cell] of hash['_grid']) {
  total += cell.size;
  count++;
}
console.log('avg actors/cell:', total / count);
```

If the average exceeds ~20, your `cellSize` is too large for the density.
