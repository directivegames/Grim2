# In-game smoke test

The smoke node plays the game by itself for about a minute: it sends input the way a player does, asserts what the player should see, saves Play frames, and logs one `[SMOKE]` line per step. The agent runs it through MCP and reads the console, the frames and the log. It is required verification, not test code, so the AGENTS.md "no test or example code" rule does not apply to it. It is not a unit-test framework, and it does nothing unless its one-shot gate is on.

## Files

| Copy | To | Holds |
|---|---|---|
| `.agents/skills/genesys-verification/templates/smoke-test.ts` | `src/debug/smoke-test.ts` | Gate, input helpers, `clickByText`, `capture`, `captureLuma`, `uiOverlaps`, `textOverflow`, direction and look helpers, `FrameRecorder`, `AudioMeter`, `ErrorWatch`, `noteShotHit`, `SmokeTestNode` |
| `.agents/skills/genesys-verification/templates/smoke-steps.example.ts` | `src/debug/smoke-steps.ts` | `SmokeTarget` (what the steps read from the game) and the default steps S01–S16 |
| `.agents/skills/genesys-verification/scripts/capture-receiver.mjs` | run in place | Holds the one-shot gate (`--arm`, `POST /arm`, `GET /smoke`). Writes POSTed frames to `.scratch/play/<name>.jpg` and lines to `.scratch/play/smoke.log`. |

Both templates typecheck against 18.1.0-alpha.317. The steps file is the only game-specific file. Keep game types behind `SmokeTarget`, so the harness never imports gameplay code.

## Default steps

The short list is in [SKILL.md → Smoke run](../SKILL.md#smoke-run). Adapt per game (`templates/smoke-steps.example.ts`).

| Id | Step | Asserts |
|---|---|---|
| S01 | Title | State Title; the pawn exists and a camera frames it; no UI overlap or text overflow |
| S02 | Start | `clickByText('start')` reaches Playing; the HUD has no overlaps |
| S03 | Readable frame | Centre-weighted luma ≥ 0.08 (dark games: also in the dark phase) |
| S04 | Move, sustained | Hold forward 4 s: ≥ 3 m along the camera forward, never slides back > 0.5 m, never falls |
| S05 | Direction | Right moves screen-right (camera-relative with a follow camera; screen-space with a fixed one) |
| S06 | Jump | Rises ≥ 0.5 m and lands |
| S07, S08 | Look axes | Look right turns yaw right; look up pitches up. Name both axes. |
| S09 | Main action | First hit: target, time and distance logged. ≥ 2 m from the muzzle, not the floor within 0.6 s. Sound audible or unknown. |
| S10 | Volley | 40 shots in a row: no frame over 2× the median, from the node's frame recorder |
| S11 | Pressure | An enemy reaches and damages the player within 20 s |
| S12, S13 | Pause | `P` → Paused, and nothing moves for 0.6 s; Resume → Playing |
| S14 | Fail | Kill the player through the game's damage path → Result within 3 s; the result card is readable |
| S15 | Retry | Playing; health full, score 0, no leftover projectiles or extra enemies |
| S16 | Clean console | No errors other than `[SMOKE]` lines |

Climbing and flying games replace S06 with a sustained climb: hold 3–5 s, and height keeps rising. Rigged heroes capture idle, run and jump inside S04 and S06.

**Escape and P.** In the editor, an Escape the game consumes stays in the game (`InputManager` calls `preventDefault` on it). Escape leaves Play only when the game did not consume it and pointer lock is off. F8 always leaves Play. Games pause on Escape and `P`. The smoke test presses `P`, because in a pointer-locked game the browser spends Escape on releasing the lock.

## Running it, step by step

The short sequence is in [SKILL.md → Run it](../SKILL.md#run-it). Tell the creator in one line first: "Running a self-play smoke test for about a minute. The `[SMOKE]` console lines are mine, not bugs."

1. `query_editor(operation="getPlayModeState")` returns `{ isActive, isStarting }`. If either is true, decide whose Play it is before waiting. A Play that started within ~30 s of your own `buildProject` or `enterPlayMode` while the receiver was armed is **yours**: `enterPlayMode` may still be finishing, or the build entered Play. Check the console for `[SMOKE] START` (and the receiver for "smoke consumed"); if either is there, poll for `DONE` and carry on. Only a Play with neither is the creator's: wait or ask, and never exit or take over their session.
2. The code is built: canonical build sequence and bundle proof (`genesys-game-boot`).
3. Start the armed receiver in the background: `node .agents/skills/genesys-verification/scripts/capture-receiver.mjs --clean --arm`. If it is already running, arm it with `curl -X POST http://127.0.0.1:8765/arm -d 1` instead. It binds 127.0.0.1:8765 and exits after 10 idle minutes. The game fetches from it; the MCP rule against localhost URLs covers MCP calls, not this.
4. `action_editor(action="enterPlayMode")`, as its own call. It saves the scene and builds before Play starts. At `beginPlay`, the smoke node asks the receiver `GET /smoke`, which answers once and disarms.
5. Poll `query_diagnostics(operation="getConsole")` from one `run_script` until `[SMOKE] DONE` (*Polling the console*). The node logs with `console.error`, because `getConsole` returns errors only.
6. `action_editor(action="exitPlayMode")`, but only for the Play you started.
7. Open every `.scratch/play/*.jpg` with the file-reading tool, and read `.scratch/play/smoke.log`.
8. Fix each FAIL and each non-smoke error, rebuild, and re-check with a filtered arm: `curl -X POST http://127.0.0.1:8765/arm -d 1:S09,S10` runs those steps plus the `always` ones (S02 reaches Playing, S16 checks the console). Add a step's prerequisite to the list (S13 needs S12, S15 needs S14). Each re-check is a Play entry against the budget (`SKILL.md` → *Budget*).

The creator's own Play never runs the test, because nothing armed the receiver. So there is no flag to turn off and no second build. POSTs from Play and the `GET /smoke` read are both proven in test builds. In one test, the first Play after a `buildProject` never asked the receiver, and the second Play did. If the receiver never prints "smoke consumed", or no `[SMOKE] START` appears within 5 s, exit Play and enter it once more (the receiver stays armed until a read). If it is still silent, fall back: run once with `SMOKE_FORCE = true` and a rebuild, then set it back to false and rebuild before reporting, and say so in the report.

When the receiver cannot run, ask the creator one specific question about the screens instead. This is a fallback, not the default.

## Gate and mount

The capture receiver holds the gate, not the game. `run_script` runs in a Node worker with only the `genesys.*` proxies, so it cannot reach the Play page's `window` or `localStorage`. The game already reaches the receiver over `fetch`, which is the path the captures use.

| Receiver | `GET /smoke` answers | Effect |
|---|---|---|
| Armed `1` (`--arm`, or `curl -X POST http://127.0.0.1:8765/arm -d 1`) | 200 `1` once, then disarms | This Play runs the steps. The next Play does not. |
| Armed `net:<ms>` (default 60000) | 200 `net` to every request within `<ms>` of arming | Every client world runs the steps (two-client runs) |
| Armed with a step filter (`1:S09,S16`, `net:60000:N01`) | 200 with the filter (`1:S09,S16`) | This Play runs only those ids plus the `always` steps (*Step filter*) |
| Not armed | 204 | Nothing is created |
| Not running | network error | Nothing is created, unless `SMOKE_FORCE` is true (the compile-time fallback, default false) |

`consumeSmokeFlag()` is async and waits up to 1.5 s. Start it at the top of `GameMode.beginPlay`, and mount the node after both it and the screens resolve. The creator's own Play never runs the test, because nothing armed the receiver. Never put the node in the GameMode's gameplay-node list: it must keep ticking while the game is paused, because it drives the pause step.

Composed — typechecked against 18.1.0-alpha.317
```ts
public override beginPlay(): boolean {
  if (!super.beginPlay()) return false;
  const smokeGate = consumeSmokeFlag();          // first: asks the receiver once (≤ 1.5 s)
  const world = this.getWorld();
  if (!world) return true;
  void Promise.all([mountScreens(world), smokeGate]).then(([, mode]) => { if (mode) this.mountSmoke(world, mode); });
  return true;
}

private mountSmoke(world: ENGINE.World, mode: SmokeMode): void {
  const smoke = SmokeTestNode.create({ name: 'SmokeTest' });
  const tag = mode === 'net' ? `client ${world.getPlayerControllerAt(0)?.netOwningClientId ?? '?'}` : '';
  smoke.setSteps(buildSmokeSteps(world, smoke, {
    stateName: () => RunState[this.state],
    pawn: () => this.hero,
    health: () => this.hp,
    maxHealth: () => 100,
    score: () => this.score,
    enemies: () => this.enemies,
    projectileCount: () => this.projectiles,
    killPlayer: () => this.damagePlayer(this.hp), // the game's own damage path, not a state write
  }), tag);
  world.add(smoke);
}
```

## Step filter

The full tour takes about a minute. A re-check of one fix needs only the steps that fix touches, so arm with their ids:

```bash
curl -X POST http://127.0.0.1:8765/arm -d 1:S09,S10
```

`consumeSmokeFlag` keeps the ids, and `SmokeTestNode.setSteps` keeps the matching steps plus every step marked `always: true`, in their original order. The example marks S02 (Start, so the run reaches Playing) and S16 (clean console). A step that depends on an earlier one goes in the list with it: S13 needs S12, S15 needs S14. Unknown ids are logged, and the START line names what runs: `[SMOKE] START 4 steps of 16 (only S02,S09,S10,S16)`.

A filtered run still counts as a Play entry (`SKILL.md` → *Budget*). Use the full tour for the first run, the post-critic re-run, and after any change to boot, screens or the GameMode.

## Saves

A smoke run must not overwrite the creator's save. Resolve the gate before loading the save, and pass a separate key to the save module while `isSmokeActive()` is true (`genesys-game-boot` → *Persistence*).

## Polling the console

`enterPlayMode` saves the scene and builds before it enters Play, so allow for that time. Poll the console from one `run_script` instead of guessing a wait. `getConsole` returns `{ errors, warnings, resultIsAuthoritative }`, with errors only in `errors`, which is why every smoke line is `console.error`. `getPlayModeState` returns `{ isActive, isStarting }`.

Composed — typechecked against 18.1.0-alpha.317
```js
let last = {};
for (let i = 0; i < 60; i++) {                          // 90 s cap, under the 300 s MCP call limit
  last = await genesys.queryDiagnostics({ operation: 'getConsole' });
  if (JSON.stringify(last.errors ?? last).includes('[SMOKE] DONE')) break;
  await new Promise(r => setTimeout(r, 1500));
}
const fmt = l => (typeof l === 'string' ? l : (l.message ?? l.text ?? JSON.stringify(l))).slice(0, 300);
return (last.errors ?? []).map(fmt);
```

The receiver's own output confirms the handshake: `[capture] smoke consumed (1), disarmed` prints when Play asks.

**Whose Play is it?** `enterPlayMode` and some `buildProject` paths leave Play starting for a while. If `getPlayModeState` shows Play active or starting within ~30 s of your own `buildProject` or `enterPlayMode` while the receiver was armed, it is your run. Read the console for `[SMOKE] START` (or the receiver for "smoke consumed") and poll for `DONE`; never wait on it as if the creator were playing.

**Verify on first use.** POSTs from Play to the receiver worked in an earlier session. The `GET /smoke` read has not been run from Play yet. If the receiver never prints "smoke consumed", or no `[SMOKE] START` appears within 5 s of Play starting, Play cannot read from the receiver. Fall back: set `SMOKE_FORCE = true`, run the canonical build sequence (`genesys-game-boot`), and run. Then set it back to false and rebuild before you report, and say in the report that the receiver gate did not work.

## Synthetic input

`InputManager` listens for `keydown`/`keyup` on `window` and for mouse events on the renderer element (`.engine/src/systems/InputManager.ts`), so dispatched events take the player's path.

- A key that is already down is ignored until its `keyup`. A hold is one `keydown` plus one `keyup` (`holdKey(code, seconds)`). A toggle is `tapKey(code)`.
- `mouseOnCanvas(world, 'mousedown')` reaches `DefaultPlayerController.handleMouseDown`, so left-button fire works without pointer lock.
- Synthetic events cannot take pointer lock, and `DefaultPlayerController.handleMouseMove` turns the view only while locked. Give `SmokeTarget.look(dx, dy)` a path into the game's own look input, or skip the look steps and say so.
- Engine `Button` listens for `click` only (`.engine/src/ui/components/Button.ts`), so `mousedown`/`mouseup` never press it. `clickByText` finds the visible button, fails when `elementFromPoint` at its centre hits another element (a hidden screen, title art, a full-screen panel), then calls `.click()`.
- Click the real buttons (at least Start, Resume and Retry). Calling the handler tests only the logic and skips the click path.

## Sustained outcomes

A mechanic step asserts what the player sees after holding the input, not the first frame. "Throw PASS" next to "the projectile explodes in the hand", and "stick back PASS" next to "refuses to pitch up and crashes", both came from first-frame checks.

| Mechanic | Hold / act | Assert |
|---|---|---|
| Walk, run, drive | Hold 3–5 s | Progress along the camera forward ≥ 3 m; never slides back > 0.5 m; does not fall > 2 m below the start |
| Climb, fly, swim up | Hold 3–5 s | Height keeps rising for the whole hold; pitch never drops below the limit (log the minimum) |
| Jump | Tap | Rise ≥ 0.5 m, then lands within 0.3 m of the start height inside 1.5 s |
| Projectile | One shot | `noteShotHit` logs target, seconds and metres. First hit ≥ 2 m from the muzzle (otherwise "explodes in the hand"), not the floor within 0.6 s |
| Melee | One swing at a dummy in reach | The dummy's health drops; the player's does not |
| Enemy pressure | Wait ≤ 20 s, no firing | The player's health drops: an enemy reached and damaged the player |
| Pickup, door, switch | Walk into or press E | The count or state changed, and it is still changed 1 s later |

Call `noteShotHit(hitName, secondsSinceFired, metresFromMuzzle)` from the projectile's hit handler. It is a no-op unless the smoke test is running.

## Direction and look

A control labelled "right" must move the pawn toward screen-right. Pick the check by camera:

| Camera | Check |
|---|---|
| Fixed, or one that does not follow the pawn (top-down arena, side view with a fixed frame) | `toScreen(world, p)` before and after: screen x or y changes with the right sign |
| Follows the pawn (third person, chase, follow-from-above) | The pawn stays at the same screen spot, so screen projection reads 0. Use world displacement along `cameraAxes(world).right` / `.fwd` |

`cameraAxes` uses `Camera.getWorldDirection` (the look direction) and `right = forward × up`. Swapping the operands gives the left vector.

Name both look axes. `cameraYawPitch` returns yaw (+ = turned right) and pitch (+ = looking up). Check "look right → yaw increases" and "look up → pitch increases" as two steps. Checking yaw alone once let a game ship with inverted pitch. A first-person pawn also checks that movement follows the view.

## Frame time (volley)

`SmokeTestNode.frames` is a wall-clock frame recorder. It needs no profiler or Insights. The volley step starts it, fires 40 times in a row, and stops it. The step passes when no frame is over 2× the median, with the first frame dropped. Log both numbers. A miss points to something created per spawn (`genesys-profiler` → *Never pay per spawn*).

## Captures

`capture(world, name)` grabs the game canvas two frames later (`canvas.toDataURL('image/jpeg', 0.8)`) and POSTs it to the receiver, which saves `.scratch/play/<name>.jpg`. Name captures by step id (`s02-hud`).

- The canvas holds the 3D view only. Engine widgets are DOM, so the HUD, menus and text are checked with `uiOverlaps`, `textOverflow` and `clickByText`, not read off a capture.
- `captureLuma(world)` returns the centre-weighted mean luma of the next frame (4×4 tiles, the centre four count double). Under 0.08 is unreadable, so gate dark phases (night, dungeon, fog) on it. `null` means unknown.
- **Per-state animation (rigged heroes).** Capture idle, walk or run, and jump inside the steps that produce them (`s04-anim-idle`, `s04-anim-run`, `s06-anim-jump`). Read each one: legs move in run, feet leave the ground in jump, no T-pose, and the upper body is not frozen.
- A black or empty capture means the frame was read after the renderer presented. Retry once; if it stays black, the look check is "unknown", not passed.

## Audio

`AudioMeter` taps an `AnalyserNode` off `world.audioListener.gain`, which the engine's Master bus feeds (`.engine/src/utils/GlobalAudioManager.ts`). Start it in the step that makes a real sound, sample every tick, and stop at the check. It reports *audible* when at least 10 samples exceed RMS 0.002. It reports *unknown* with no listener, a suspended context, or fewer than 10 samples. Unknown is logged, not failed. Verify in Play.

## UI checks

- `uiOverlaps(world, ignore?)` compares the visible widget roots (the element inside each `.ui-layout` container: `ui-card`, `ui-button`, `ui-progress-bar`, …) and every custom HUD piece marked `data-hud-item`. `textOverflow` also covers text inside `[data-hud]`. Overlaps over 2 px fail. Pass `ignore` for deliberate stacking, such as an icon inside a card.
- `textOverflow(world)` fails any visible text element whose `scrollWidth` is greater than its `clientWidth`.
- Run both on the title, the HUD, pause and the result.

## Two-client evidence (online games)

1. Set clients to 2 in the toolbar **Network** menu (clients 1–4, `genesys-editor-manual` → menus-and-play). It is a UI control. If MCP cannot set it, ask the creator once.
2. Arm the receiver with `net:60000` (`--arm net:60000`, or `POST /arm` with that body), so every client world that starts Play within 60 s runs the steps. The mount tags each client's lines with `client <id>`. The receiver's `smoke.log` collects every window's lines; `getConsole` may show only one. Verify in Play.
3. Assert:
   - **N01:** the owner's move shows on the owning client within 2 frames, before any server round trip.
   - **N02:** the other client's copy of that pawn moves more than 0.5 m within 1.5 s.
   - **N03:** replicated fields (`GameSessionInfo.sessionState`, each `PlayerInfo` score, read with `world.getNodes(ENGINE.PlayerInfo)`) match across clients after the server accepts a change.

A capture of one window is not this test.

Composed — typechecked against 18.1.0-alpha.317
```ts
export function ownerMoveStep(world: ENGINE.World): SmokeStep {
  const start = new THREE.Vector3();
  let frames = 0, movedAt = -1;
  const mine = (): ENGINE.Pawn | null => world.getPlayerControllerAt(0)?.getPawn() ?? null;
  return {
    id: 'N01', name: 'owner move is immediate',
    act: () => { mine()?.getWorldPosition(start); frames = 0; movedAt = -1; holdKey('KeyW', 1); },
    during: () => {
      frames++;
      const p = mine()?.getWorldPosition(new THREE.Vector3());
      if (movedAt < 0 && p && p.distanceTo(start) > 0.02) movedAt = frames;
    },
    wait: 1.2,
    check: () => movedAt > 0 && movedAt <= 2 ? true : `own pawn moved after ${movedAt} frames (no prediction?)`,
  };
}
```

## Log format

Source: `.agents/skills/genesys-verification/templates/smoke-test.ts` (`smokeLog`, `SmokeTestNode`)
```text
[SMOKE] START 16 steps
[SMOKE] START 4 steps of 16 (only S02,S09,S10,S16)      ← a filtered re-check
[SMOKE] PASS S04 forward held 4 s keeps moving (4.2 s)
[SMOKE] FAIL S09 main action: first hit is far and sounds (0.5 s): hit Hero 0.4 m from the muzzle: explodes in the hand
[SMOKE] (client 2) PASS N01 owner move is immediate (1.2 s)
[SMOKE] DONE pass 15 fail 1 errors 0 in 58.3 s
```

`console.error` shows a stack trace in the dev console. The `[SMOKE]` prefix is what tells the creator these lines are the agent's test, not bugs.

## When the receiver or MCP is off

- **Receiver cannot run** (port in use, blocked): run the smoke test anyway for the PASS lines. Ask the creator one specific question about the screens: "Does the title show the hero, and is Retry visible on the result card?"
- **MCP off:** the receiver still works, because it is a local process. Start it with `--arm`, ask the creator to press Play once, then read `.scratch/play/smoke.log` and the captures yourself. If the gate cannot be reached, the fallback is `SMOKE_FORCE` and a rebuild by the creator.

## Traps

- Start "fails" although the button works. The step sent `mousedown`/`mouseup`; engine `Button` listens for `click`. Use `clickByText`.
- The agent waits on its own Play, thinking the creator is playing. A Play that started within ~30 s of your own `buildProject` or `enterPlayMode`, with the receiver armed, is yours. Look for `[SMOKE] START` in the console before you wait.
- The creator pastes `[SMOKE]` lines as bugs. Announce the run in one line before it starts.
- `buildProject` and `enterPlayMode` in one message: `enterPlayMode` does not wait for a busy editor, but `buildProject` waits up to 30 s for one, then fails with `editor_busy`. Make each one its own call, and send `enterPlayMode` after the build returns.
- Controls checked in world space instead of on screen. "W moves +Z" can still move the pawn down the screen.
- Look checked on one axis. An inverted pitch shipped behind a passing yaw check.
