---
name: genesys-profiler
description: Diagnose a Genesys play session through bounded Insights reports or desktop-streamed traces, and add profiler scopes in game code. Use when asked to optimize, profile, capture a trace, find hitches, profile startup, inspect profiler output, or instrument user code.
metadata:
  tokens: 2575
---

# Genesys profiler

Naming: Genesys in skills/docs/code = Sandbox Studio in the product UI (same app / MCP).

Use this when measuring a play session or adding scopes in game code. Editor UI how-tos stay in [genesys-editor-manual](../genesys-editor-manual/SKILL.md). MCP dispatch stays in [genesys-mcp-orchestrator](../genesys-mcp-orchestrator/SKILL.md).

`query_profiler` and `action_profiler` are compact-hidden. Call them with `run_script` (`genesys.queryProfiler` / `genesys.actionProfiler`) or `batch_execute`. A missing tool descriptor on the compact surface is expected.

## Two independent tools

- **Insights** keeps a rolling window of recent frames during Play (120 frames by default, about two seconds at 60 fps). It starts off and keeps collecting until you stop it. Advanced settings on the Insights section can change the window length (30–1800 frames) or turn on Fill window and freeze, which stops after one full window and keeps that capture for the report. `action_profiler(action="setInsights", enabled=true)` turns collection on for the running session and for the next Play, using those saved settings. `enabled=false` stops collection and leaves any saved report on disk. `action_profiler(action="generateReport")` writes `{project}/.editor/profiles/gnsx-report-*.json` and returns `path`, `issues`, and a timing summary. Open that JSON when the summary is not enough. `query_profiler(operation="readReport")` is for a later session and rejects files over 5 MB.
- **Trace** is an explicit detailed recording. `startTrace` and `armTraceForGameStart` stream `{project}/.editor/profiles/gnsx-trace-*.json` and write a sibling `.meta.json` manifest when the recording stops. Both calls accept `maxDurationMs`, `maxBytes`, `maxFrames`, and `thresholdMs`.

Use Insights first for optimization guidance. Record a Trace when frame-by-frame ordering or a hitch timeline is required.

## Frame cost or memory

Insights and Trace measure frame time. They do not show who retains the JavaScript heap or which texture owns VRAM. Heap and VRAM captures: [memory-profiling](../memory-profiling/SKILL.md).

| Question | Use |
| --- | --- |
| Which scope makes a frame slow, or where a hitch sits | Insights report or Trace manifest in `{project}/.editor/profiles` |
| What the game is still holding in JavaScript, or whether that grew | `compare-heap-captures.mjs` on `.genesys/captures` |
| Which textures and render targets own VRAM, or whether that grew | `compare-gpu-captures.mjs` on `.genesys/captures` |

## Instrument game code

Scopes added below are no-ops until Insights or a Trace turns the profiler on. Leave `enable`, `disable`, `setProfile`, `reset`, `beginTraceCapture`, and `setGpuDetail` to the editor. `enable`, `disable`, and `reset` clear the session the panel is recording.

```typescript
import * as THREE from 'three';
```

Game projects compile with `experimentalDecorators`, so `@THREE.profile()` and `@THREE.profileClass` work on that import. The label is the stats key. Keep it stable so samples aggregate into one Insights row and one `topScopes` entry.

### One method

`@THREE.profile()` labels the scope `ClassName.methodName`. Pass a string to set the label. An async method records the promise on the async trace row.

```typescript
export class EnemyAI {
  @THREE.profile()
  public updateAI(deltaTime: number): void {
    this.sense(deltaTime);
  }

  @THREE.profile('EnemyAI.sense')
  public async sense(deltaTime: number): Promise<void> {
    await this.scan(deltaTime);
  }
}
```

### Every own prototype method

`@THREE.profileClass` labels each own prototype method `ClassName.methodName`. It skips the constructor, getters, setters, and methods inherited from a base class.

```typescript
@THREE.profileClass
export class EnemyAI {
  public updateAI(deltaTime: number): void {
    this.sense(deltaTime);
  }

  public sense(deltaTime: number): void {
    this.scan(deltaTime);
  }
}
```

### A block inside a method

Use `profileBlock` for synchronous work. Nested blocks subtract from the parent's self time. A recursive call with the same label counts only the outermost sample as inclusive time.

```typescript
public updateAI(deltaTime: number): void {
  THREE.profileBlock('EnemyAI.sense', () => {
    this.sense(deltaTime);
  });
}
```

For a per-call trace slice name (stats key stays stable), use `begin` / `end` and build `traceName` only when `THREE.ProfilerService.isTracing()` is true — see Play `recordProfilerFrame` for frame scopes that stay open across ticks.

### Work that outlives its caller

Use a span when the work finishes after the caller returns, or when two calls with the same label can be in flight together. Pass `{ asyncTimeline: true }` to both `beginSpan` and `endSpan`.

```typescript
const span = THREE.ProfilerService.beginSpan('Level.load', { asyncTimeline: true });
try {
  await this.load();
} finally {
  THREE.ProfilerService.endSpan(span, { asyncTimeline: true });
}
```

A scope that ends outside the scopes it opened inside is recorded as `label (out of order)` on the async row, with a one-time console warning.

### GPU work the game submits

Engine render passes are already GPU-timed. Use `profileGpuBlock` around GPU work the game submits on a renderer it holds. Pass, stage, and draw detail stays the Profiler panel or the play console command `profiler.gpuDetail`.

```typescript
THREE.profileGpuBlock('CustomPass', renderer, () => this.submit(renderer));
```

Or with `beginGpu` / `endGpu` when you need the handle (for example to set `traceName` while the span is open):

```typescript
const gpuSpan = THREE.ProfilerService.beginGpu('CustomPass', renderer);
try {
  this.submit(renderer);
} finally {
  THREE.ProfilerService.endGpu(gpuSpan);
}
```

Wrap a hot path the report shows as one wide engine scope (`World.tick`, AI, a custom system). One scope per system or method. Nest only to split a scope the report already flags. Capture again afterwards. The new label appears in the report timing scopes and in the trace manifest `topScopes`.

## What to read

`generateReport` already returns the path and the issues. Do not call `readReport` in the same turn.

`startTrace` returns `trace.path` while the file is still streaming. `stopTrace` returns `tracePath` and `manifest` (`topScopes`, `topGpuScopes`, `slowestFrames`, `stopReason`, duration, frame count). `query_profiler(operation="readTraceManifest")` returns the same manifest later. Process the manifest. Do not read, grep, or paste the `.json` trace into the conversation. A capture can be tens or hundreds of megabytes. The Trace Viewer opens that file when recording stops. **Enable live trace** under Advanced opens it when recording starts instead. Use the manifest unless the user is looking at the viewer.

`status` returns `playActive`, live `insights` and `trace` state, `armed` (including `insightsOnPlay`), `latestReport`, `latestTrace`, and `captureError` when Play did not answer.

## How to capture

| Goal | Call |
| --- | --- |
| Turn Insights on or off | `action_profiler(action="setInsights", enabled=true\|false)`. |
| Save optimization guidance | Wait until `status.live.insights.samples > 0`, then `action_profiler(action="generateReport")`. Use `path` and `issues`. |
| Record the next play session from the first frame | `action_profiler(action="armTraceForGameStart", maxDurationMs, maxBytes)`, then follow `nextStep`. Arming does not start the file. |
| Record while play is already running | `action_profiler(action="startTrace", maxDurationMs, maxBytes)`. Fails with `play_not_active` when play is stopped. |
| Finish and inspect | `action_profiler(action="stopTrace")`, or read `status.latestTrace` / `readTraceManifest` after a limit stop. |
| See if a capture is still writing | `query_profiler(operation="status")`. |
| List saved reports and traces | `query_profiler(operation="listArtifacts")`. Bodies are not returned. |
| Save GPU timing detail for the next Play | `action_profiler(action="setGpuDetail", gpuDetail="pass"\|"stage"\|"draw")`. |

Automated runs must pass `maxDurationMs` and/or `maxBytes`. Omitting a limit means that axis never stops the recording. The editor panel defaults to 15 minutes and 2048 MB and treats 0 as unlimited. A limit stop writes the manifest by itself (`stopReason` is `maxDuration`, `maxBytes`, or `maxFrames`). `thresholdMs` drops spans shorter than that duration. `null` on arm clears a stored limit.

Arming persists for the project. When the user wanted a single capture, disarm afterwards with `armTraceForGameStart` and `armed: false`.

Leaving play without Stop can close the file without a manifest. The Trace Viewer can still open the `.json`; `readTraceManifest` then reports that metadata was not written.

## Startup until gameplay

There is no signal for "gameplay has started." `armTraceForGameStart` then `action_editor(enterPlayMode)` records scene startup (`beginPlay`, resource waits, local player). The scene file load just before that is not in the trace, and the file keeps recording into normal frames until Stop or a safety limit.

Do not leave that capture running. If the user did not say how to end it, ask which they prefer before you start:

1. **Marker.** They add one unique line at the gameplay-ready point: `console.error('GENESYS_GAMEPLAY_READY')`. Poll `query_diagnostics(operation="getConsole")` until that exact string is in `errors`, then `action_profiler(action="stopTrace")`.
2. **Short window.** Arm with `maxDurationMs` of 5000–10000, or stop a few seconds after `status.live.trace.recording` becomes true.

`generateReport` while Insights is off still writes a world and memory snapshot, with a `profiler_disabled` issue and no timing scopes. Start Insights and wait for samples first.

When a WebGPU renderer is collecting, the report includes `timing.gpuScopes` and `generateReport` returns the first 10 as `timing.topGpuScopes` plus a compact `memory` summary (`jsHeapUsedMB`, `gpuTotalBytes`, and the first five textures). The report viewer shows the full tables. A finished trace manifest includes the same GPU totals as `topGpuScopes`, next to the CPU `topScopes`. `action_profiler(action="setGpuDetail", gpuDetail="pass"|"stage"|"draw")` saves Passes, Stages, or Draws for the next Play. A session that is already running keeps its current detail until Play starts again. `query_profiler(operation="listArtifacts")` lists report and trace files in `.editor/profiles` without returning their bodies.

Recipes: [workflows.md](../genesys-mcp-orchestrator/references/workflows.md#profile-a-play-session).
