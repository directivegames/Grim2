---
name: genesys-profiler
description: "Performance: never pay per spawn (no lights on spawned things, shared geometry and materials, warm-up), Insights reports, traces, hitches, startup, draw calls, render scale, phone pass. Use for slow, laggy, hitching, stutter when firing or spawning, low FPS, optimize, profile, too many draw calls, phone performance. Not for instanced dressing (use `genesys-level-authoring`), compressing files (use `genesys-asset-compiler`), shadow and post settings (use `genesys-lighting`), or heap and VRAM growth (use `memory-profiling`)."
metadata:
  tokens: 2787
---

# Genesys profiler

Naming: Genesys = Sandbox Studio in the product UI.

This skill owns cheap spawns, measuring a play session, and deciding what to change. The rules: **never pay per spawn**, and **measure, change one knob, measure again.** The engine has no device-tier governor; never invent Low / Medium / High or device preset tables.

## Use another skill when
- Editor UI how-tos (where the Profiler panel lives) → `genesys-editor-manual`
- MCP dispatch, `run_script` / `batch_execute`, approvals → `genesys-mcp-orchestrator`
- Shadow cascades, `castShadow`, bloom, grade, or other post passes after a profile blames them → `genesys-lighting`
- Particle pools, instance counts that wrap, looping effects that never stop → `genesys-vfx`
- A per-frame audio decode or clip loading → `genesys-audio`
- Compressing textures, meshes, or audio for the build → `genesys-asset-compiler`
- Size budgets for meshes, images and audio before they land → `genesys-assets` (QA table)
- Proving Play runs the changed code → `genesys-game-boot`
- Hundreds of separate dressing nodes (draw calls), instancing, colliders on scatter → `genesys-level-authoring` (*Instancing*)
- Shared node materials and their warm-up → `webgpu-tsl-node-material-assets`
- Who retains the JavaScript heap, which textures own VRAM, or whether either grew → `memory-profiling` (Insights and Trace measure frame time only)

## Never pay per spawn

These rules apply to every game, before any profile. Each one prevents a hitch the player feels on the most common action: firing, hitting, killing, picking up.

| Never | Why | Instead |
|---|---|---|
| A `PointLightNode` / `SpotLightNode` on anything spawned or short-lived (projectiles, pickups, impacts, muzzle flashes, dying enemies) | In three.js, each lit material's shader is compiled for a fixed light count. Adding or removing a light recompiles every shader in view: one hitch on spawn, another on destroy | Emissive material plus bloom for glow. For moving light, a small fixed pool of lights created at boot, moved and dimmed (intensity 0 when idle), never added or removed |
| New geometry, material or texture per spawn (`new THREE.SphereGeometry()` in a projectile's constructor or options) | Each new material compiles a program; each new geometry uploads buffers | Module-level constants shared by every instance; models through `ModelMeshNode` (cached by path) |
| A new particle system name per spawn | Each name is its own pool and shader | One `spawnVFX` name per effect kind (`genesys-vfx`) |
| First use mid-fight of a model, skinned mesh or effect | Its shader compiles the first time it is drawn | Warm up on the title (below) |

Fixed lights placed in the scene (lamps, fires, torches) are fine. Their count never changes, and changing their intensity or colour every frame does not recompile anything.

**Warm-up.** On the title screen, draw each gameplay-only model, skinned enemy and particle effect once, inside the camera frustum but hidden under the floor, and remove it after about 1.5 s; the renderer has no occlusion culling, so the hidden copy compiles its shader. Prefabs spawned in bursts: `await ENGINE.spawnAsync` one copy too (`genesys-prefabs` → *Spawn from code*). Snippet (`warmUpGameplay`): [warm-up](references/warm-up.md).

**Check it.** The smoke volley step fires the main action 30–50 times in a row (`genesys-verification`): no frame over 2× the median. A spike on the first shot only means the warm-up missed something; on every shot, something is paid per spawn.

## Measure

Full calls, fields and recipes: [capture](references/capture.md); scripted runs: `genesys-mcp-orchestrator` → `references/workflows.md` (*Profile a play session*).

- **Version gate.** `query_profiler` / `action_profiler` exist only in Sandbox Studio 18.1+ and are compact-hidden: call them through `run_script` (`genesys.queryProfiler` / `genesys.actionProfiler`) or `batch_execute`. If `search_tools` finds neither, say the app is older and use the Profiler panel by hand (`genesys-editor-manual`); never substitute timing code in the game.
- **Insights first.** `action_profiler(action="setInsights", enabled=true)`, wait until `status.live.insights.samples > 0`, then `action_profiler(action="generateReport")`: it returns `path`, `issues` and a timing summary (and GPU scopes on WebGPU). Do not call `readReport` in the same turn. A report with Insights off says `profiler_disabled`.
- **Trace** only when frame ordering or a hitch timeline is needed: `startTrace` (Play running) or `armTraceForGameStart` (from the first frame), with a short `maxDurationMs` in automated runs (omitted, it stops at 15 min or 2 GB). Let Play run for the window before `stopTrace`; read the returned **manifest** (`topScopes`, `topGpuScopes`, `slowestFrames`), never the trace `.json`, which runs to hundreds of MB. Arming persists: disarm with `armed: false` after a single capture.
- **Startup.** No signal marks "gameplay started": end a startup trace with a `GENESYS_GAMEPLAY_READY` console marker or a 5–10 s `maxDurationMs`, and ask the user which before starting ([capture](references/capture.md#startup-until-gameplay)).

## Spend the frame budget

Touch a knob only after a report names its cost.

| Knob that exists | Where | When to touch it |
| --- | --- | --- |
| `r.ScreenPercentage` console variable (drives the renderer pixel ratio) | `.engine/src/render/Renderer.ts` | After a profile says fill-rate is the cost. |
| CSM on (`useCsmShadows`) | `genesys-lighting` | Shadow passes high and CSM is on → turn it off (standard box around the player; the pawn carries it) or cut to one cascade first, before any other shadow knob. |
| `castShadow` and shadow-map size | `genesys-lighting` | After a profile says shadows are the cost. |
| Bloom, grade, and other post passes | `genesys-lighting` | After a profile says post is the cost. |
| Particle pools | `genesys-vfx` | When instance counts wrap or looping effects never stop. |
| Draw calls: separate nodes of the same model | `genesys-level-authoring` (*Instancing*) | Any model placed more than ~10 times as separate dressing nodes; a phone target. Budget: dressing as instanced nodes, a few hundred draw calls on a phone (draw calls are not in the report; count nodes with `query_node`). |
| Collider count | `genesys-level-authoring`, `genesys-physics` | Physics time high in the report, or thousands of static bodies: `physics: false` on dressing the player never touches. |
| `castShadow` on dressing | `genesys-level-authoring`, `genesys-lighting` | Shadow passes high: off on small scatter (grass, flowers, pebbles, floor tiles); keep it on trees, hedges, buildings, characters. |

**Render scale.** Set `r.ScreenPercentage` (play console `r.ScreenPercentage 75`, or `ENGINE.CVarManager.setValue('r.ScreenPercentage', 75)`), never `renderer.native.setPixelRatio()` directly: the variable's change callback overwrites a direct call ([render-scale](references/render-scale.md)).

A hitch that is identical at every visual setting is not automatically a shadow problem. Check for a per-frame audio decode (`genesys-audio`) before stripping the post stack. The profiler report is the decider.

**Audio-impostor triage.** Stutter only while moving, unchanged at `r.ScreenPercentage` 50 and 100 and with shadows and post off, desktop fine → not rendering. Look for per-frame audio work: a footstep or engine sound created or restarted each tick, many `SoundNode`s with volume or position written per frame (`genesys-audio`).

## Phone performance pass

1. Play the game on the target phone, or in the editor at a phone-sized viewport, through the heaviest moment (most enemies, most effects).
2. Insights on, wait for samples, `generateReport`. Note the top CPU and GPU scopes and the `issues`. If the sun has `useCsmShadows` on, turn it off for a phone-first game (`genesys-lighting` → *Cascaded shadows: default off*); medium-tier phones still render up to 2 cascades.
3. Change the one knob the report blames (table above). For fill-rate, step `r.ScreenPercentage` down in 25-point steps (100 → 75 → 50) and stop at the first value that clears the issue.
4. Generate a second report and compare. Keep the change only if the issue list moved.
5. Record the measured result and the chosen value in the game's design notes.

## Asset weight

Load time and download size are separate from frame time. Large generated GLBs (dense meshes, 4K embedded textures) and large PNGs slow the first load, especially on phones. The startup trace shows them as resource waits.

- Compress at build time with KTX2, Meshopt, and MP3 → `genesys-asset-compiler`. It is off by default, and Play-In-Editor does not bake unless `compileOnPlay` is on.
- Set triangle and texture-size budgets before generating, and rebuild or regenerate rather than ship an oversized source → `genesys-assets`.

## Traps

- **A hitch on every shot, hit or kill.** Something is created per spawn: a light (shader recompile), a material, a geometry, a new effect name. Apply *Never pay per spawn*.
- **A hitch on the first shot, first enemy or first effect only.** Its shader compiled on first draw. Warm it up on the title.
- **Lower pixel ratio without a profile.** It blurs the game and may not touch the real cost. Generate a report first.
- **Direct `setPixelRatio` reverts.** The `r.ScreenPercentage` change callback overwrites it. Set the variable.
- **A hand-rolled quality-tier menu or device preset table.** The engine already resolves a tier (`quality: "auto"`, lowered in Play by its watchdog). A settings menu calls `ENGINE.setQualityTierOverride(...)` and shows `ENGINE.getResolvedQualityTier().summary`; otherwise tune the one knob a report blames.
- **Phone frame rate low in a dressed level, no single hot scope.** Draw calls from hundreds of separate dressing nodes. Instance them (`genesys-level-authoring`), then profile again.
- **Stutter only during movement, unchanged by quality settings.** Per-frame audio work, not rendering (*Audio-impostor triage*).
- Capture traps (unlimited trace, pasted trace JSON, `profiler_disabled`, arm left on, 0 s trace, no `action_profiler`): [capture](references/capture.md#traps).

## Done

The report's issue list moved, or the user accepted the current cost. A before and after report (or trace manifest) both exist, and only one knob changed between them. A lower pixel ratio without a profile is not an optimization.

## References
- [capture](references/capture.md) — MCP surface, Insights vs Trace, what to read, every capture call and limit, startup capture, GPU detail, capture traps
- [warm-up](references/warm-up.md) — the `warmUpGameplay` snippet and the volley check
- [render-scale](references/render-scale.md) — `r.ScreenPercentage` vs `setPixelRatio`
- `genesys-mcp-orchestrator` → `references/workflows.md` (*Profile a play session*) — scripted Insights and trace recipes; each waits for samples or for the trace window before reading results
