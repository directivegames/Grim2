# Step 5: GPU memory (VRAM)

GPU memory is a different pool from the JavaScript heap. A heap capture
([heap-capture-analysis.md](heap-capture-analysis.md)) shows what JavaScript
holds: arrays, parsed files, CPU copies of images. It cannot show the textures,
meshes and render targets that live on the graphics card. Use this step when the
user says "VRAM", "GPU memory", "graphics memory", the game stutters or crashes
on weaker GPUs, or the browser's GPU process is large.

If the user only says "memory is high", **take both**: the GPU capture is cheap
(no slowdown) and often explains a total the heap cannot.

## What each tool can see

| Question | Tool |
| --- | --- |
| What JavaScript objects hold memory? | `capture-heap.mjs` + `analyze-heap-retained.mjs` |
| Which textures and buffers exist on the GPU, how big, who created them? | `capture-gpu.mjs` (in-page tracker) + `analyze-gpu-memory.mjs` |
| What did the driver really allocate for the browser? | OS counters, sampled by `capture-gpu.mjs` |
| What does the engine think it uploaded, by asset name? | `perf.snapshot` console command, passed with `--perf-snapshot` |

`capture-gpu.mjs` combines the first three into one `.gpumem.json`.

### The three sources, and how far to trust each

1. **In-page tracker** (`scripts/gpu-hook.js`). Wraps WebGPU `createTexture`,
   `createBuffer` and `destroy`, in the page and in its workers. It knows the
   exact format, size, mip count, usage, label and **creation stack** of every
   live resource. It computes bytes from the descriptor, so driver padding is not
   included. It holds no references to GPU objects, so it does not change what
   the game keeps alive. WebGL contexts are **not** tracked.
2. **OS counters.** On Windows, the "GPU Process Memory" performance counters for
   the browser's GPU process (dedicated and shared) and the whole-system "GPU
   Adapter Memory". Elsewhere `nvidia-smi` when present; macOS has no equivalent
   without root. This is ground truth for what is resident, but it includes the
   compositor, swap chains, compiled pipelines and driver overhead, and it is not
   split by resource.
3. **Engine snapshot** (`perf.snapshot`). The engine's own `renderer.info.memory`
   totals and a list of its largest textures with asset names and owners
   ("`rock_albedo.png` referenced by `RockActor (map)`"). Good for naming assets;
   its sizes are estimates, and it does not see render targets or compute
   buffers it did not create.

Resources that are created but never written or bound can be missing from the OS
number (drivers commit them lazily), so tracker > OS is normal for such cases.
On integrated GPUs, "shared" memory is system RAM and competes with the
JavaScript heap.

## Workflow

```
- [ ] 1. Ask what looks wrong and who records (same two questions as the heap flow)
- [ ] 2. Record with capture-gpu.mjs (or the manual fallback below)
- [ ] 3. Optional: get an engine snapshot (perf.snapshot) from the same scenario
- [ ] 4. Run analyze-gpu-memory.mjs and read the report
- [ ] 5. Map creation sites to source, verify, then report
- [ ] 6. After a fix, record again and run compare-gpu-captures.mjs
```

### 1. Record

Same environment rules as [recording-captures.md](recording-captures.md): same
scenario each time, let the game load and idle first, captures under
**`<project>/.genesys/captures/`**, the **user builds and starts the dev server**, the agent never
runs `pnpm dev`. Ask whether the user wants to record or wants the agent to.

**Path A: dev server (default).** From the project root, with the dev server
running:

```bash
node .agents/skills/memory-profiling/scripts/capture-gpu.mjs --url=<dev server url> --warmup=15 --duration=60
```

It launches a clean Chrome on a blank page, installs the tracker, then opens the
game, so every allocation from the first frame is seen. Samples go out every
`--interval` seconds (default 5). Stop early with Enter or the stop file it
prints, exactly like `capture-heap.mjs`. Run it in the background while the
user plays, then run the analyzer.

**Path B: Studio play window** (started with `--remote-debugging-port=<port>`,
see Path B in [recording-captures.md](recording-captures.md)):

```bash
node .agents/skills/memory-profiling/scripts/capture-gpu.mjs --attach=<port> --reload
```

`--reload` restarts the page with the tracker installed. Without it, only
allocations made after attaching are counted and the report says so.

**Path C: the user records by hand** (no scripts). Give them these steps, then ask
for the numbers:

1. Open the game, let it load, and idle for 15 seconds.
2. In Chrome press **Shift+Esc** (Task Manager), right-click the header, enable
   **GPU memory**, and note the figure for the **GPU Process** row and for the
   game tab.
3. In the game press the backquote key to open the console, run `perf.snapshot`,
   and send the downloaded JSON file path.
4. Optional: Windows Task Manager, Performance, GPU, note **Dedicated GPU memory**.

That gives totals and named textures but no per-resource stacks. Tell the user
that, and offer the script for a deeper look.

Useful capture flags: `--min-stack-kb=<kb>` (record creation stacks for
resources at least this big; default 64), `--top=<n>`, `--gpu-pid=<pid>` when
the GPU process is not found, `--no-os`, `--wait-for-expression=<js>`,
`--keep-chrome`, `--headless` (usually breaks WebGPU games). `--help` lists all.

### 2. Get the engine snapshot (optional, recommended)

The engine writes the file when you run the console command `perf.snapshot`
(optional argument: seconds to collect first). Open the game console with the
backquote key. The file downloads to the browser's Downloads folder. Move it
next to the capture (for example into `.genesys/captures/`) and pass it to the
analyzer. It adds
section 7 with the engine's totals and its largest textures by asset name.

### 3. Analyze

```bash
node .agents/skills/memory-profiling/scripts/analyze-gpu-memory.mjs <capture>.gpumem.json [--perf-snapshot=<file>] [--project=<regex>]
```

Writes `<capture>.gpu.txt` and `<capture>.gpu.summary.json` next to the capture.
Prefer the summary JSON for totals and the text report for tables. Run it from
the project root; no large RAM is needed.

| Section | Use it for |
| --- | --- |
| 0. Summary | Tracked live bytes, lifetime counts, OS dedicated/shared, and the gap between them |
| 1. By kind | `texture:sampled`, `texture:renderTarget`, `texture:depth`, `buffer:vertex`, `buffer:index`, `buffer:uniform`, `buffer:storage`, `buffer:staging` |
| 2. Textures by format | Where uncompressed `rgba8unorm` or float formats dominate |
| 3. Largest resources | Identical resources are grouped ("28 x 4 MB"); each has its creation site |
| 4. By creation site | Nearest project frame, i.e. the code that asked for the memory |
| 5. Over time | Growth, churn (created / destroyed / freed only by GC), JS heap alongside |
| 6. Hints | Rule-based findings with evidence (below) |
| 7. Engine cross-check | Engine totals vs tracker, plus the engine's named textures |

### 4. Read the hints (and verify them)

| Hint | Meaning | Typical fix |
| --- | --- | --- |
| `uncompressed-textures` | 8-bit color textures >= 1 MB stored raw | KTX2 with BC7 (desktop) or ASTC (mobile): about 4x smaller |
| `no-mip-chain` | Large sampled textures without mips | Correct for UI, lightmaps, data. Otherwise add mips (+33%) for quality |
| `float-targets` | Large rgba16f/rgba32f textures | Lower precision, e.g. `rg11b10ufloat` for HDR color |
| `render-target-share` | Render targets and depth are a big share | Resolution scale, pooling transient targets, dropping unused post effects |
| `duplicate-textures` | Same label, size and format more than once | Share one texture; stop cloning per instance |
| `staging-buffers` | Mappable buffers kept alive | Destroy right after the copy |
| `relies-on-gc` | Resources were never destroyed, only garbage collected | Call `dispose()` / `destroy()` when unused |
| `growth` | Tracked bytes grew steadily during the recording | Suspected leak; the by-site table names who allocates |
| `untracked-gap` | Driver total far above tracked | Compositor, swap chain, pipelines, other tabs; check canvas size and WebGL |
| `late-tracking` | Tracker attached after load | Re-record with `--reload` or `--url` |

Hints are heuristics. Open the creation site in source, confirm the resource is
really avoidable (a lightmap is meant to be large), then report with file, line
and size. The creation stack in a dev server shows project files; in a minified
production bundle it shows `game.js:<line>`, so use method names as described in
[heap-capture-analysis.md](heap-capture-analysis.md) section 4. Label GPU
resources in source (`label:` in descriptors, `texture.name` in the engine) to
make later reports readable.

### 5. Verify an optimization

Record the same scenario before and after, then:

```bash
node .agents/skills/memory-profiling/scripts/compare-gpu-captures.mjs <before>.gpumem.json <after>.gpumem.json
```

It prints deltas for tracked total, OS dedicated/shared, kind, format, creation
site, and which hints appeared or went away. Both captures must use the same
tracking mode (the script warns otherwise).

## Link to the JavaScript heap

If a GPU texture's source pixels are still in the JavaScript heap after upload
(`DataArrayTexture.source` holding an `ArrayBuffer`, see
[known-heap-patterns.md](known-heap-patterns.md)), the same image costs memory
twice. Compare section 3 here with the heap's section 8 to catch it, and release
the CPU copy once the upload is done.

## Limits to state in the report

- WebGL contexts are not tracked; only the OS counters and the engine snapshot
  describe a WebGL game.
- Swap-chain textures and driver padding are not in the tracker's numbers.
- A worker that ends before the final snapshot contributes only its last sampled
  totals.
- OS counters: Windows performance counters, or `nvidia-smi`. Without them the
  report is tracker-only.
- Sizes are for one run on one GPU. Compare captures from the same machine.
