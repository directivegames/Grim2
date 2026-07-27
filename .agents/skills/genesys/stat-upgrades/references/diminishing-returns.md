# Diminishing Returns

Without a cap, infinite stat upgrades can produce invulnerable characters. The hyperbola formula provides a smooth soft-cap.

## Formula

```
effective = cap × raw / (raw + k)
```

- `cap` — the maximum value the stat can ever reach (approached but never touched)
- `k` — the "half-cap" point: at `raw = k`, effective = `cap / 2`
- `raw` — the total value before guard rails (base + all level bonuses)

## Worked example

At `cap = 0.75`, `k = 0.35`:

| raw   | effective |
|-------|-----------|
| 0.00  | 0.000     |
| 0.35  | 0.375     |
| 0.70  | 0.500     |
| 1.40  | 0.600     |
| 3.50  | 0.682     |
| 35.0  | 0.741     |

The stat never reaches 0.75 no matter how many levels are purchased.

## Tuning

Raise `k` to allow near-linear gains longer before the curve kicks in. Lower `k` to apply heavy diminishing returns from the first few levels.

For percentage stats that start at 0 (defence, resistances), apply the formula to the raw total:

```ts
out.defence = this._diminish(Math.max(0, out.defence), 0.75, 0.35);
```

For stats with a meaningful base value (e.g. life leech = 0.8 base), apply the curve only to the bonus portion so the base remains linear:

```ts
const base     = BASE_STATS.lifeLeech;          // e.g. 0.8
const bonusRaw = Math.max(0, out.lifeLeech - base);
const bonusEff = this._diminish(bonusRaw, 1.8, 0.9);
out.lifeLeech  = base + bonusEff;
```

## Implementation

The `_diminish` helper is already in `StatUpgrades.ts`:

```ts
private _diminish(raw: number, cap: number, k: number): number {
  if (raw <= 0 || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(cap, cap * (raw / (raw + k))));
}
```

Call it from `_applyGuardRails` for any stat that needs a ceiling.
