# Step 2: Analyze Chrome heap captures

Start with [recording-captures.md](recording-captures.md) if the user does not
have a capture yet.

This analyzes the **JavaScript heap** only. Textures, meshes and render targets
live in GPU memory and are not in a heap capture (only their CPU-side source
data is). For VRAM questions use [gpu-memory.md](gpu-memory.md).

## Two capture kinds

The same command analyzes both. The file extension (and `.summary.json` field
`allocationStacks`) tells you what the report can include.

| Input | Chrome Memory panel choice | Allocation stacks in report? |
| --- | --- | --- |
| `.heaptimeline` | **Allocation instrumentation on timeline** | Yes — sections **1–5** and **9** |
| `.heapsnapshot` | **Heap snapshot** (Take snapshot) | **No** — sections **1–5** and **9** are omitted |

**If the user needs allocation call stacks** ("who created this?", "which function
allocated it?") and they only have a `.heapsnapshot`, stop after the retainer
sections and direct them to record an **allocation timeline**:
[recording-captures.md](recording-captures.md) Path C step 4, or
`capture-heap.mjs` without `--mode=snapshot` (timeline is the default). A
snapshot cannot be post-processed into stacks; they must record again.

**If retainer paths are enough** (named owners, dominator tree, constructors),
a snapshot is valid and faster to record.

Chrome DevTools cannot load an 800 MB timeline comfortably, and its trees do
not credit native buffers to their owners. The bundled script answers up to two
questions from the final snapshot only; freed allocations never appear:

- **Who retains it** (both kinds): dominator tree over strong edges. Weak edges
  are skipped and shortcut edges count only from the root, as in DevTools.
- **Who allocated it** (timeline only): live bytes per allocation stack.
  `ArrayBuffer` backing stores and external strings have no stack of their own,
  so each is credited to its nearest dominator that has one.

## Workflow

```
- [ ] 1. Locate the capture (default: `<project>/.genesys/captures/`)
- [ ] 2. Run the analyzer
- [ ] 3. Read the report in order: summary, 0, 6, then **1, 7, 8, 9** if
  `allocationStacks` is true; for a snapshot use **0, 6, 7, 8** only (or
  `.summary.json` for agents)
- [ ] 4. Name the minified owners
- [ ] 5. Drill down with probes
- [ ] 6. Verify each finding against source before reporting
- [ ] 7. Report: retainer table, allocation table, prioritized findings
```

### 1. Locate the capture

Use the path printed by `capture-heap.mjs`, or ask the user where the capture
is. Default capture location is `<project>/.genesys/captures/`. Do not copy
captures into `src/` or `assets/`.

Accepted inputs:

- `.heaptimeline` (Memory panel, "Allocation instrumentation on timeline"):
  has allocation stacks, so every section is available.
- `.heapsnapshot` (plain heap snapshot): no allocation stacks, so sections
  1-5 and 9 are skipped.

### 2. Run the analyzer

From the project root:

```bash
node --max-old-space-size=20000 .agents/skills/memory-profiling/scripts/analyze-heap-retained.mjs <capture> --wide
```

An 800 MB capture takes about 15 s and several GB of RAM. The report is written
next to the capture as `<capture>.retained.txt`; a machine-readable
`<capture>.summary.json` is written at the same time (skip with `--no-json`).
Override paths with `--out=` and `--json-out=`. For before/after work see
[compare-captures.md](compare-captures.md).

### 3. Read the report

| Section | Use it for |
| --- | --- |
| Summary | Live total; how much is payload credited to a traced owner |
| 0. Pattern hints | Skill hints ([known-heap-patterns.md](known-heap-patterns.md)) plus project rules (`.genesys/heap-patterns.json`, [project-heap-patterns.md](project-heap-patterns.md)) |
| 6. Dominator tree | **Main retainer answer.** Rows are exclusive and add up. `--wide` lists 45 top-level owners |
| 1. Top-down call tree | **Main allocation answer**, with the constructors each site produced |
| 2. By nearest project frame | Grouped by the nearest frame whose script matches `--project` (default: `/src/`, `/packs/`, `.dist/`, `@fs/`) |
| 3. By function, inclusive | Total per subsystem entry point, e.g. `setupAnimations` |
| 4. By leaf allocation site | The four innermost frames of each stack |
| 5. Not owned by a traced object | Live memory that predates the recording |
| 7. By constructor | DevTools-style retained size per class (outermost instances only) |
| 8. Named retainers | Largest objects with a shortest GC root path; the path's edge names show the owning variable or field |
| 9. By allocation time | Startup, load, steady state, late growth |

Section 2 is empty when the game bundle is evaluated without a script URL; use
sections 1 and 3 instead.

### 4. Name the minified owners

The game bundle (typically `.dist/game.js`) is minified, so frames and classes
show up as `ha`, `D4` or `vI`. Identify them from what survives minification:

- **Method names** keep their names: search `src/` for frames such as
  `loadBaseClips` or `precompileAll`.
- **Field names** on edges keep theirs: `.originalClips`, `.buffers`,
  `.cached`, `.cachedModels`. Search `src/` and `.engine/src/` for them.
- **Prototype names**: `(closure ha).prototype -> AnimationStateMachineNode`
  means `ha` extends that class. Search `src/` for `extends` of it.
- **Bundler helpers**: read the first ~600 characters of the bundle to decode
  names such as `S` (`__toESM`) and `CO` (`__copyProps`).
- **Engine frames** keep real names and `deps/@gnsx_genesys__js.js:<line>`.
  Read `.engine/src` for their source.

### 5. Drill down

Add these to the same command; every run re-parses the capture.

| Flag | Answers |
| --- | --- |
| `--probe=<@id,...> --depth=2` | What an object retains, field by field, plus its GC root path |
| `--class=<Name,...>` | How many instances exist, their sizes, and where each is held |
| `--holders=<Name>` | Which objects hold thousands of edges to a class, e.g. `system / AccessorPair` for getter tables |
| `--late-from=<seconds>` | What is still alive from late in the session, by stack |
| `--project=<regex>` | Which script URLs count as project code for section 2 |
| `--out=<file>` | Report path |
| `--json-only` | Summary JSON only (faster when diffing many captures) |
| `--no-json` | Text report only |
| `--project-root=<dir>` | Game project root when cwd / capture meta is wrong |
| `--patterns=<file>` | Override path to project rules JSON |
| `--no-project-patterns` | Skill section 0 only |

The `.summary.json` fields `captureKind`, `allocationStacks`,
`allocationStacksHint`, `liveTotal`, `patterns`, `projectPatternsFile`,
`constructors`, `namedRetainers`, and `dominators` are enough for most agent
summaries. When `allocationStacks` is `false`, repeat `allocationStacksHint` to
the user if they asked for creation sites.

Take `@id`s from sections 6 and 8. The same ids work in the DevTools snapshot
search.

### 6. Verify before reporting

- Read the owning source for every finding and cite file and line.
- Allocation stacks for natively created buffers (decompression, fetch, WASM)
  can be wrong. Trust the dominator path, not the stack, for those.
- A single snapshot is one lifecycle state and never proves a leak. Compare
  two captures of the same moment with [compare-captures.md](compare-captures.md)
  before calling retained growth a leak.
- Separate capture artifacts from game cost before ranking. See
  [known-heap-patterns.md](known-heap-patterns.md).

### 7. Report

Lead with the live total and the few owners that dominate it. Then give:

1. **Who retains**: exclusive owners from section 6, with capture artifacts
   (dev source text, extensions) marked as such.
2. **Who allocated**: top call-tree entries from section 1.
3. **Findings**: state, owner file, size, and a fix direction for each. Label
   each as project-owned, engine patch, or SDK/build issue.
4. **Caveats**: build type (dev or production), extensions, and that this is
   one snapshot.

Explain it for a non-expert. Short glossary to reuse:

| Term | Plain meaning |
| --- | --- |
| Live | Still in memory at the end of the capture (freed objects are ignored) |
| Retained size | Memory that would be freed if this one object were released |
| Retainer / owner | The object or variable that keeps something alive |
| Allocation stack | The chain of functions that created the object |
| GC root path | The chain from the browser's roots to the object, which shows why it is not freed |

When asked to document findings, write a dated markdown file in the project's
`docs/` folder (for example `docs/heap-timeline-<date>.md`).
