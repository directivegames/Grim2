# Compare heap captures (before / after)

Use this when the user fixed something, changed a level flow, or wants to know
whether memory **grew** between two sessions. One snapshot never proves a leak;
two comparable captures plus a diff do.

This file is for JavaScript heap captures. For GPU captures use
`compare-gpu-captures.mjs` ([gpu-memory.md](gpu-memory.md), "Verify an
optimization"); the comparability rules below apply to both.

## Make captures comparable

Same rules as [recording-captures.md](recording-captures.md):

- Same environment (both dev server, or both production build).
- Same scenario (scene, spawn, actions, duration).
- Same warmup and readiness (`--warmup`, `--wait-for-expression` if the game exposes a ready flag).
- Same capture **kind** when you care about allocation attribution (both
  `.heaptimeline` or both `.heapsnapshot`). Retained-size deltas work across
  kinds; stack-based sections exist only on timelines.
- Captures use the same folder as recording (default `<project>/.genesys/captures/`).

Label captures when recording (`--name=before-load-fix`) so diffs are obvious.

## Run the diff

Each capture gets a `.summary.json` when analyzed. The compare script reuses
existing summaries or runs the analyzer with `--json-only`.

```bash
node .agents/skills/memory-profiling/scripts/compare-heap-captures.mjs \
  .genesys/captures/Heap-before.heapsnapshot \
  .genesys/captures/Heap-after.heapsnapshot
```

The report lists:

- Live heap total delta
- Largest constructor retained-size changes
- Largest named retainer changes
- Pattern hits that are new or grew by at least 2 MB in the **after** capture

## Leak review across lifecycle (step 3)

For “memory not freed after leaving a mode”, take **one capture per state**:

1. After load / idle at the starting state
2. After entering a mode, level, or scene
3. After leaving back to the starting state (same actions every time)

Compare (1) vs (3) to see what stayed behind. Compare (2) vs (1) for mode cost.
Do not compare idle-at-load vs active play — different lifecycle states.

## Optimize and verify (step 4)

1. Capture **before** the change (`--name=baseline-…`).
2. Apply the fix.
3. Capture **after** with the same flags and scenario.
4. Run `compare-heap-captures.mjs` and confirm the expected constructor or
   retainer shrank. Report the delta in plain language for the user.

If the diff is noisy in dev, repeat on a **production SDK build** before calling
the work done.
