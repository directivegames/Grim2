---
name: memory-profiling
description: Profile and optimize memory use in Genesys games, for users with no profiling experience. Covers two pools. JavaScript heap - records Chrome heap captures (automated over the DevTools Protocol, or guided DevTools steps) and analyzes them (.heaptimeline allocation timelines and .heapsnapshot files) to show who retains and who allocated live memory, with a DevTools-equivalent dominator tree and minified-name mapping. GPU memory (VRAM) - tracks every WebGPU texture and buffer with its size, format and creation site, samples the driver's real GPU memory, and cross-checks the engine's perf.snapshot. Use when the user asks about memory usage, heap size, VRAM, GPU memory, textures, leaks, "what is using memory", or shares a heap capture or .gpumem.json.
metadata:
  tokens: 2648
---

# Memory profiling and optimization

Find where a Genesys game spends memory, decide what is game cost versus capture
artifact, and fix the owners. This skill is built in steps; each step has its
own reference file.

| Step | Status | Reference |
| --- | --- | --- |
| 1. Record a heap capture | Available | [recording-captures.md](references/recording-captures.md) |
| 2. Analyze a heap capture | Available | [heap-capture-analysis.md](references/heap-capture-analysis.md) |
| 3. Leak review across lifecycle transitions (repeated captures) | Available | [compare-captures.md](references/compare-captures.md) |
| 4. Optimize and verify (before/after comparison) | Available | [compare-captures.md](references/compare-captures.md) |
| 5. GPU memory (VRAM): record, analyze, compare | Available | [gpu-memory.md](references/gpu-memory.md) |

Steps 1-4 are the JavaScript heap. Step 5 is a separate pool; see
**JavaScript heap or GPU memory?** below. Follow the reference for that step.

## JavaScript heap or GPU memory?

They are different memory. A heap capture cannot see textures, meshes or render
targets on the graphics card, and a GPU capture cannot see JavaScript objects.

| User says | Do |
| --- | --- |
| "VRAM", "GPU memory", "textures too big", GPU crash or stutter on weak GPUs | GPU capture ([gpu-memory.md](references/gpu-memory.md)) |
| "JS heap", "leak", "garbage", tab memory grows | Heap capture (steps 1-4) |
| "memory is high" with no detail | Both. The GPU capture is cheap and does not slow the game; record it first, then the heap capture |
| A capture file | `.heapsnapshot` / `.heaptimeline` -> heap analyzer. `.gpumem.json` -> GPU analyzer |

Never report heap totals as GPU usage or the reverse. When both are recorded,
report them side by side and call out any resource held in both places (for
example a texture whose source pixels stay in the heap after upload).

## Frame time is a different capture

Insights reports and Trace files in `.editor/profiles` measure which code makes
a frame slow. This skill measures memory. A heap total is not frame time, and a
GPU capture is not a Trace.

| Question | Use |
| --- | --- |
| Which scope makes a frame slow, or where a hitch sits | [genesys-profiler](../genesys-profiler/SKILL.md): Insights report or Trace manifest |
| What the game is still holding in JavaScript, or whether that grew | This skill, then `compare-heap-captures.mjs` |
| Which textures and render targets own VRAM, or whether that grew | This skill, then `compare-gpu-captures.mjs` |

Do not record a heap timeline and a GPU capture at the same time: heap
allocation tracking slows the game and distorts the GPU numbers.

## Two heap capture kinds (same analyzer)

Both `.heaptimeline` and `.heapsnapshot` run through `analyze-heap-retained.mjs`.
After analysis, read `.summary.json`: `allocationStacks` is `true` only for a
timeline.

| Kind | Extension | Answers | Does not answer |
| --- | --- | --- | --- |
| **Allocation timeline** | `.heaptimeline` | Who **retains** live memory (sections 6–8) **and** who **allocated** it (sections 1–5, 9) | — |
| **Heap snapshot** | `.heapsnapshot` | Who **retains** live memory (sections 0, 6–8) | Allocation call stacks |

**Agent routing**

- User shares a capture or you analyze one: detect kind from the file extension
  or `summary.json` → `captureKind` / `allocationStacks`.
- User asks for allocation stacks, "who created this", "call tree", or section 1
  is empty: if `allocationStacks` is `false`, say plainly that a plain snapshot
  cannot include stacks. Point them to [recording-captures.md](references/recording-captures.md)
  — **Allocation instrumentation on timeline** in DevTools, or
  `capture-heap.mjs` with default `--mode=timeline` (not `--mode=snapshot`).
  Offer to guide recording; do not imply the existing `.heapsnapshot` can be
  upgraded in place.
- Retainer-only questions ("what holds 16 MB?", dominator tree) are fine on
  either kind.

## Assume the user is new to profiling

- Offer to do the work. **Before recording, ask whether they want to record the
  capture themselves**; some prefer to. If they do, write out the steps for them
  ([recording-captures.md](references/recording-captures.md), Path C). If not,
  record with `scripts/capture-heap.mjs` so they only have to play their game.
  Either way, you run the analyzer, read the report, and verify findings in
  source.
- Prefer the **`.summary.json`** sidecar for totals and top owners; use
  `.retained.txt` for dominator trees and probes. Run
  `compare-heap-captures.mjs` for before/after work.
- When you cannot automate a step, give numbered instructions one step at a
  time and wait for confirmation. Never ask the user to interpret DevTools
  output.
- Use plain words in answers: "memory the game is holding right now" instead of
  "retained size", and "the code that created it" instead of "allocation stack".
  Define a term the first time you use it.
- Keep up-front questions to two: what looks wrong (high after load, grows
  while playing, or just curious), and who records the capture. Default the rest.

## When to use

- The user says memory is high, the game crashes or slows down over time, or
  asks what is using memory.
- The user shares a `.heaptimeline` or `.heapsnapshot` file (skip step 1; see
  **Two heap capture kinds** above if they need allocation stacks).
- The user asks about VRAM / GPU memory or shares a `.gpumem.json` (step 5).
- A report needs live-memory numbers rather than total allocation churn.

## Quick start

From the project root (the skill is installed at `.agents/skills/memory-profiling/`):

```bash
# 0. User builds the project with the SDK (not `pnpm build`, which only builds code).

# 1. User starts the dev server in their own terminal (agents must not run it):
#      pnpm dev
#    and tells you the URL Vite prints, for example https://localhost:3000/.
#    Then record in a clean Chrome:
node .agents/skills/memory-profiling/scripts/capture-heap.mjs --url=<dev server url> --warmup=15

# 2. Analyze the file it prints (writes .retained.txt and .summary.json)
node --max-old-space-size=20000 .agents/skills/memory-profiling/scripts/analyze-heap-retained.mjs <capture> --wide

# 3. Optional: compare two captures
node .agents/skills/memory-profiling/scripts/compare-heap-captures.mjs <before> <after>

# GPU memory instead of the JS heap (see references/gpu-memory.md)
node .agents/skills/memory-profiling/scripts/capture-gpu.mjs --url=<dev server url> --warmup=15 --duration=60
node .agents/skills/memory-profiling/scripts/analyze-gpu-memory.mjs <capture>.gpumem.json [--perf-snapshot=<perf.json>]
node .agents/skills/memory-profiling/scripts/compare-gpu-captures.mjs <before>.gpumem.json <after>.gpumem.json
```

Ask who records first (see above). The dev server is the default environment
whether the agent or the user records. Follow
[recording-captures.md](references/recording-captures.md) for the full procedure,
how to choose between the dev server, the Studio play window and manual
DevTools, and the stop-file flow while the user plays. Then
[heap-capture-analysis.md](references/heap-capture-analysis.md) to read the
report. Section **0** combines skill-wide hints
[known-heap-patterns.md](references/known-heap-patterns.md) with **project**
rules from `.genesys/heap-patterns.json` in the game repo
([project-heap-patterns.md](references/project-heap-patterns.md)). Still
verify in source before ranking findings as game cost.

## Scripts

| Script | Role |
| --- | --- |
| `capture-heap.mjs` | Record `.heapsnapshot` / `.heaptimeline` + `.meta.json` |
| `analyze-heap-retained.mjs` | `.retained.txt` report + `.summary.json` |
| `compare-heap-captures.mjs` | Delta report between two captures |
| `heap-pattern-scan.mjs` | Skill-wide pattern heuristics (used by analyzer; not run alone) |
| `load-project-heap-patterns.mjs` | Loads `.genesys/heap-patterns.json` from the game project |
| `capture-gpu.mjs` | Record GPU memory: in-page WebGPU tracker + OS counters + time series -> `.gpumem.json` |
| `analyze-gpu-memory.mjs` | `.gpu.txt` report + `.gpu.summary.json`; optional `--perf-snapshot` cross-check |
| `compare-gpu-captures.mjs` | Delta report between two GPU captures |
| `gpu-hook.js` | Tracker injected into the page and workers by `capture-gpu.mjs` (not run alone) |
| `gpu-os-sampler.mjs` | OS GPU-memory counters (used by `capture-gpu.mjs`) |
| `cdp-common.mjs` | Shared Chrome DevTools Protocol helpers for both capture scripts |
| `*.test.mjs` | Script tests: `node scripts/heap-pattern-scan.test.mjs`, `node scripts/gpu-memory.test.mjs` |

## Ground rules

- Keep captures under **`<project>/.genesys/captures/`** (gitignored by the SDK
  template). Both capture scripts default there when run from the project root;
  analyzers write reports next to the capture unless you pass `--out`.
- Only live objects count. Freed allocations never appear in the report.
- A single capture is one lifecycle state and never proves a leak.
- Verify every finding against source (file and line) before reporting it.
- Separate capture artifacts (dev source text, extensions, DevTools) from game
  cost before ranking anything. Trust section **0** as hints, not proof.
- Recording slows the game and uses a lot of memory. Say so before starting
  (a heap timeline does; a GPU capture adds almost no overhead).
- GPU captures track WebGPU only. A WebGL game gets OS counters and the engine
  snapshot, and the report says so. State the tracking mode (complete or
  attached late) and the source of every GPU number you quote.
