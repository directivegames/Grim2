# Capturing: Insights, traces, startup and GPU detail

The short version is in [SKILL.md → Measure](../SKILL.md#measure). This file holds the full MCP surface, the two tools, what to read, every capture call, startup capture and GPU detail.

## MCP surface

**Version gate.** `query_profiler` and `action_profiler` exist only in Sandbox Studio 18.1+. If `search_tools` does not find them, the app is older: say so in one line and use the Profiler panel by hand (`genesys-editor-manual`). Do not substitute timing code in the game.

`query_profiler` and `action_profiler` are compact-hidden. Call them with `run_script` (`genesys.queryProfiler` / `genesys.actionProfiler`) or `batch_execute`. A missing tool descriptor on the compact surface is expected.

## Two independent tools

- **Insights** keeps a rolling window of recent frames during Play (120 by default, about two seconds at 60 fps) only while its switch is on. It starts off and keeps collecting until stopped. Advanced settings change the window length (30–1800 frames) or turn on Fill window and freeze, which stops after one full window and keeps that capture for the report. `action_profiler(action="setInsights", enabled=true)` turns collection on for the running session and for the next Play, using those saved settings. `enabled=false` stops collection and leaves any saved report on disk. `action_profiler(action="generateReport")` writes `{project}/.editor/profiles/gnsx-report-*.json` and returns `path`, `issues`, and a timing summary. Open that JSON when the summary is not enough. `query_profiler(operation="readReport")` is for a later session and rejects files over 5 MB.
- **Trace** is an explicit detailed recording. `startTrace` and `armTraceForGameStart` stream `{project}/.editor/profiles/gnsx-trace-*.json` and write a sibling `.meta.json` manifest when the recording stops. Both calls accept `maxDurationMs`, `maxBytes`, `maxFrames`, and `thresholdMs`.

Use Insights first for optimization guidance. Record a Trace when frame-by-frame ordering or a hitch timeline is required.

Scripted recipes (Insights report, trace from the first frame, trace while playing): `genesys-mcp-orchestrator` → `references/workflows.md` (*Profile a play session*). A trace only covers the time between start and stop: let Play run for the window you want (a `sleep` past `maxDurationMs`, or until the limit stops it) before `stopTrace`. `stopTrace` straight after `enterPlayMode` returns a trace of about 0 s.

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

`startTrace` without `maxDurationMs` or `maxBytes` uses the editor panel's defaults, 15 minutes and 2048 MB; pass `null` to drop that limit. `armTraceForGameStart` keeps the stored limits when you omit them (the panel's, 15 minutes and 2048 MB, until changed). Pass a short `maxDurationMs` in automated runs so the trace covers only the window you want. A limit stop writes the manifest by itself (`stopReason` is `maxDuration`, `maxBytes`, or `maxFrames`). `thresholdMs` drops spans shorter than that duration. `null` on arm clears a stored limit.

Arming persists for the project. When the user wanted a single capture, disarm afterwards with `armTraceForGameStart` and `armed: false`.

Leaving play without Stop can close the file without a manifest. The Trace Viewer can still open the `.json`; `readTraceManifest` then reports that metadata was not written.

## Startup until gameplay

There is no signal for "gameplay has started." `armTraceForGameStart` then `action_editor(enterPlayMode)` records scene startup (`beginPlay`, resource waits, local player). The scene file load just before that is not in the trace, and the file keeps recording into normal frames until Stop or a safety limit.

Do not leave that capture running. If the user did not say how to end it, ask which they prefer before you start:

1. **Marker.** They add one unique line at the gameplay-ready point: `console.error('GENESYS_GAMEPLAY_READY')`. Poll `query_diagnostics(operation="getConsole")` until that exact string is in `errors`, then `action_profiler(action="stopTrace")`.
2. **Short window.** Arm with `maxDurationMs` of 5000–10000, or stop a few seconds after `status.live.trace.recording` becomes true.

`generateReport` while Insights is off still writes a world and memory snapshot, with a `profiler_disabled` issue and no timing scopes. Start Insights and wait for samples first.

## GPU detail

When a WebGPU renderer is collecting, the report includes `timing.gpuScopes` and `generateReport` returns the first 10 as `timing.topGpuScopes` plus a compact `memory` summary (`jsHeapUsedMB`, `gpuTotalBytes`, and the first five textures). The report viewer shows the full tables. A finished trace manifest includes the same GPU totals as `topGpuScopes`, next to the CPU `topScopes`. `action_profiler(action="setGpuDetail", gpuDetail="pass"|"stage"|"draw")` saves Passes, Stages, or Draws for the next Play (the Profiler panel and the play console command `profiler.gpuDetail` set it too). A session that is already running keeps its current detail until Play starts again.

## Traps

- **Trace runs on for minutes in an automated run.** The default cap is 15 minutes. Pass a short `maxDurationMs`, or call `stopTrace` after the window.
- **Trace JSON pasted into the conversation.** Files run to hundreds of MB. Read the manifest.
- **Report says `profiler_disabled`.** Insights was off. Turn it on and wait for `samples > 0`.
- **Arm left on after a single capture.** Arming persists. Disarm with `armed: false`.
- **Trace of about 0 s.** `stopTrace` was called straight after `enterPlayMode`. Wait for the window, or let `maxDurationMs` stop it.
- **`search_tools` finds no `action_profiler`.** The app is older than 18.1. Use the Profiler panel (*MCP surface*).
