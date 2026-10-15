# Step 1: Record a heap capture

Assume the user has never profiled memory. Do the work for them where you can,
explain in plain words, and never ask them to read DevTools output themselves.

A **heap capture** is a recording of every object the game keeps in memory at
one moment, plus (for a timeline) who created each object. The analyzer in
[heap-capture-analysis.md](heap-capture-analysis.md) turns it into "this system
holds this many MB".

## The environment: the project's dev server

Capture from the game running on the project's Vite dev server in a clean
Chrome. It does not need Studio, it is the same every time, and the capture
script can drive it. The dev server runs the game standalone with its default
scene (see `scripts/genesys/dev/launcher.ts` in the project).

Building the project needs the Genesys SDK, and project rules do not let the
agent run `pnpm dev` or `pnpm start`. `pnpm build` is not a substitute: it only
compiles the code, not the project. So the **user builds the project** and
**starts the dev server** in their own terminal. The agent then records.

## 1. Decide what to record

This file covers the **JavaScript heap**. If the problem is GPU memory (VRAM,
textures, render targets), or the user just says "memory is high", follow
[gpu-memory.md](gpu-memory.md) for the GPU capture; it reuses the same
environment, question flow and Paths A-C below, and it does not slow the game.
Do not record a heap timeline and a GPU capture at the same time.

Ask one question if the user has not said it: **"What looks wrong - memory is
high after loading, it keeps growing while playing, or you just want to know what
uses memory?"** Then pick:

| User's problem | Record | Why |
| --- | --- | --- |
| "What uses memory?" / high after loading | **Timeline** of about 60 s of normal play (or **snapshot** for a fast first look) | Names owners and the code that allocated them |
| Memory grows while playing | **Timeline** of 2-5 minutes of the growing activity | Shows what was allocated and is still alive at the end |
| Memory not freed after leaving a level or mode | Two timelines of the same moment, one before leaving and one after returning, then [compare-captures.md](compare-captures.md) | One capture cannot prove a leak |

Timeline vs snapshot:

- **Timeline** (`.heaptimeline`): records allocation stacks while you play. The
  game runs noticeably slower while recording and the file is large (hundreds of
  MB for a big game). Gives every section of the report.
- **Snapshot** (`.heapsnapshot`): a single instant, quick and smaller. No
  allocation stacks, so the report answers "who retains it" but not "who
  allocated it".

Default to a timeline. Use a snapshot when the user wants a quick look or the
timeline is too slow to play.

## 2. Ask who records, then choose how

**Before recording anything, ask the user whether they want to record the
capture themselves.** Some people prefer to drive DevTools, and some want to
control exactly when recording starts and stops. Use the AskQuestion tool with
two options:

- "You record it, I'll tell you how" (Path C), or
- "You record it for me - you just play the game" (Path A or B).

Ask this once, after step 1 (what to record) and before asking them to build, starting a dev
server, or launching Chrome. Do not assume.

Then work down this list and stop at the first that applies:

1. **The user already has a capture file.** Skip the question and recording; go
   to step 2 (analysis). If the file is a `.heapsnapshot` and they need
   **allocation call stacks**, explain that only an **allocation timeline**
   (`.heaptimeline`) includes stacks — see
   [heap-capture-analysis.md](heap-capture-analysis.md) and record again (Path C
   or `capture-heap.mjs` without `--mode=snapshot`).
2. **The user wants to record it themselves.** Use
   [Path C](#path-c-the-user-records-it-in-devtools). Give them the steps in full
   (do not just link to this file) and remind them to build the project first.
3. **The user wants the agent to record, and the problem happens in the dev
   server game** (the usual case, including any problem in the default scene or
   reachable by playing from it). Use [Path A](#path-a-dev-server-default).
4. **The user wants the agent to record, but the problem only appears inside
   Studio** (editor-only features, a scene the dev server does not start in). Ask
   once whether to restart Studio with a debug flag
   ([Path B](#path-b-studio-play-window)) or to record themselves
   ([Path C](#path-c-the-user-records-it-in-devtools)). Recommend Path B if they
   will capture more than once, Path C for a single capture.
5. **An automated path fails partway.** Offer Path C and say why. Do not retry
   silently.

## 3. Make the capture comparable

Tell the user, in one short list, before recording:

- Play the **same scenario** every time (same scene, same start, same actions).
  Different lifecycle states are not comparable.
- Let the game finish loading and sit idle for ~15 s before recording, unless
  the question is about loading.
- Close other DevTools panels on the game window. An attached DevTools keeps the
  script source in memory and inflates the numbers. Path A needs no DevTools
  window.
- Say which build was measured. The dev server serves unminified modules and
  source maps, so absolute numbers are higher than a shipped game; compare
  captures from the same environment against each other.
- Recording slows the game and uses a lot of memory.

## 4. Record it

### Path A: dev server (default)

The capture script launches a clean Chrome (temporary profile, no extensions, no
DevTools window, the dev server's local HTTPS certificate accepted), opens the
game, records, and saves the file. It needs Node 22 or newer and no extra
packages.

1. **User: build the project.** Ask them to build it with the SDK and tell you
   when it succeeds. Do not run `pnpm build` for them (it only builds the code),
   and do not capture a project that failed to build.
2. **User: start the dev server.** Ask them to run this in their own terminal in
   the project folder and leave it running:

   ```bash
   pnpm dev
   ```

   Tell them to close the browser tab it opens automatically (the project's Vite
   config sets `open: true`). That tab would load a second copy of the game and
   compete for the GPU.

3. **User: share the URL.** Vite prints a line such as
   `Local: https://localhost:3000/`. The port is `server.port` in
   `.genesys/sdk/vite.config.ts` (3000 by default) and moves to the next free port
   if something else holds it. Ask the user to paste the line. Do not guess.
4. **Agent: record.** From the project root:

   ```bash
   node .agents/skills/memory-profiling/scripts/capture-heap.mjs --url=https://localhost:3000/ --warmup=15
   ```

   Add `--duration=60` to stop after a fixed time, `--mode=snapshot` for a plain
   snapshot, `--warmup=0` to include the load itself. By default the script waits
   for `document.readyState === 'complete'` before warmup; use
   `--wait-for-expression=<js>` when the game exposes a ready flag. A visible
   Chrome window opens; WebGPU games need it, so do not pass `--headless`. Each
   capture writes a sibling `.meta.json` (URL, warmup, mode, `projectCwd`) for the
   analyzer. `projectCwd` is used to load `.genesys/heap-patterns.json` when you
   analyze from a directory other than the project root.

**Driving it as the agent.** The user must play while the recording runs, so run
the script as a background command and tell the user what to do:

1. Start the script with no `--duration` (or a generous one).
2. Tell the user: "A Chrome window opened with your game. Wait for it to load,
   then play through <scenario>. The game will feel slower while recording. Tell
   me when you are done."
3. When they say they are done, create the stop file the script printed
   (default `<out>/STOP`; for example `New-Item <out>\STOP -ItemType File`). The
   script then forces garbage collection, writes the file, and prints its path.
4. Wait for the script to exit, then run the analyzer on that path.
5. Tell the user they can stop the dev server (Ctrl+C) unless they want another
   capture.

Where files go: `<project>/.genesys/captures/` when you run the script from the
project root (ignored by the default `.gitignore`). Do not save captures under
`src/`, `assets/`, or other game source trees. Override with `--out=<dir>`.

Useful flags: `--warmup=<s>`, `--name=<label>`, `--wait-for-expression=<js>`,
`--keep-chrome`, `--chrome=<path>` (or the `CHROME_PATH` environment variable),
`--no-gc`. Run with `--help` for the full list.

### Path B: Studio play window

Studio is an Electron app, and Electron accepts Chromium's
`--remote-debugging-port` switch. The port number is any free port the user
picks; nothing in Studio defines one. Use the same number in both places.

1. Quit Studio completely (a second launch can hand its arguments to the running
   instance and the flag is lost).
2. Start Studio with `--remote-debugging-port=<port>`. Ask the user for the Studio
   executable if you do not know where it is. This is not verified for every
   Studio install, so confirm with step 4.
3. Open the project and press **Play** (F5 or F6). Wait for the game to load.
4. Check it is reachable:

   ```bash
   node .agents/skills/memory-profiling/scripts/capture-heap.mjs --attach=<port> --list
   ```

   The play window shows up as a page whose URL contains `play-in-editor`. If
   nothing is listed, use Path C.

5. Record, using the same background-and-stop-file flow as Path A:

   ```bash
   node .agents/skills/memory-profiling/scripts/capture-heap.mjs --attach=<port> --duration=60
   ```

The debugging port lets any program on the machine control the app, so tell the
user to restart Studio normally afterwards.

### Path C: the user records it in DevTools

For a user who prefers to record it, or when no automated path fits. Do not just
point at this file: write the steps out in your reply, tailored to their
question (timeline or snapshot, scenario, duration), and wait for them to report
back with the file path.

**Prepare the game first.** Ask them to build the project with the SDK, then
start the dev server in their own terminal with `pnpm dev` and leave it running. If they would rather capture in the Studio play window, skip this and
use step 1's Studio option. Use the same environment for every capture they want
to compare.

Steps to give the user, in this order:

1. **Open the game in a clean window.** Open the URL Vite printed (for example
   `https://localhost:3000/`) in a Chrome **Incognito** window, which disables
   most extensions that would pollute the numbers. If Chrome warns about the
   certificate, choose Advanced, then Proceed to localhost. (In Studio instead:
   press **Play**, then **F12** for the play window's Dev Console.)
2. **Let it load and settle.** Wait for the game to load, then leave it idle for
   about 15 seconds. Skip the wait only if the question is about loading.
3. **Open DevTools** with **F12** and go to the **Memory** tab.
4. **Pick the capture type.**
   - For a timeline select **Allocation instrumentation on timeline** (tick
     "Allocation stacks" if offered).
   - For a snapshot select **Heap snapshot**.
5. **Record.** For a timeline click **Start**, play the scenario you agreed on
   (the game will feel slower), then click the red **Stop** button. For a
   snapshot click **Take snapshot**. Both can take a minute on a big game.
6. **Save it.** In the left sidebar right-click the new profile and choose
   **Save as...** (or click its download icon). Save into
   `<project>/.genesys/captures/` (create the folder if needed).
7. **Tell the agent the full path** of the saved file and what they played, so it
   can analyze it.

**Shortcut for users who prefer the terminal.** They can let the script do the
recording while they stay in control of start and stop. With the dev server
running, in the project folder:

```bash
node .agents/skills/memory-profiling/scripts/capture-heap.mjs --url=<dev server url> --warmup=15
```

A clean Chrome opens with the game. They play the scenario, then press **Enter**
in the terminal to stop. The script prints the saved file path. Offer this when
they want control but no DevTools.

DevTools stays attached while recording by hand, so its script-source cost shows
up in the report. Mark it as a capture artifact; see
[known-heap-patterns.md](known-heap-patterns.md).

## 5. If it fails

| Symptom | Likely cause and fix |
| --- | --- |
| The project build fails | Ask the user to fix the build errors first; capturing a broken build is wasted time |
| Chrome opens to an error page or blank | The dev server is not running, or the URL or port is wrong. Ask the user to re-send the line Vite printed |
| Chrome not found | Pass `--chrome=<path>` or set `CHROME_PATH` |
| Game loads but shows the wrong scene | The dev server starts the project's default scene. Change the default scene, or use Path B or C for another scene |
| Game very slow or Chrome out of memory while recording | Allocation tracking is expensive. Record a shorter scenario or use `--mode=snapshot` |
| Capture file is hundreds of MB | Normal for big games. The analyzer handles it; do not open it in DevTools |
| Path B: `--list` shows no pages | Studio was not started with the port, or another instance swallowed the flag. Quit it fully and restart; otherwise use Path C |
| Path B: `no page matches play-in-editor` | The game is not playing yet or the window closed. Press Play, then retry; or pick one with `--target=` after `--list` |
| Path B: `cannot connect` | Wrong port, or something else is using it. Pick another port and restart |

Do not delete the capture afterwards unless the user asks. Captures are
evidence for later comparison.
