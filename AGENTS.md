# GENESYS-SDK-BEGIN

## How to Work
- Ask only when a wrong guess would change the work: a vague term, a missing target (which node, asset, or scene), or more than one reasonable reading. When a wrong guess is cheap to undo, or the user does not answer, state your assumption in one line and continue. When the request is clear, start; do not restate it or ask for confirmation.
- To ask, call `request_user_input` when it is in your tool list; otherwise ask in chat. Prefer one question (three at most). Put the recommended option first with a "(Recommended)" suffix, and do not add an Other option.
- Inspect the project before you make changes, whether you build a new feature, fix a bug, or continue earlier work. For work that spans several systems or files, name what you will change before you start.
- Skills hold Genesys-specific workflows, APIs, and pitfalls that general Three.js or game-engine knowledge gets wrong. Before you start a task, check the available skills for any that cover it, read each matching `SKILL.md`, and follow it. When a task touches several areas, read every matching skill. If a skill and your own knowledge disagree, follow the skill.
- Do not create documentation, tests, or example code unless the user asks for them. Testing is the user's responsibility: recommend approaches and help evaluate results, but do not run test runners.
- Keep status and progress updates brief.

## How a Genesys Project Is Organised

### Scene State vs Runtime Behaviour
Before you write code, decide where the state belongs.

| State owner | Use |
| --- | --- |
| **Scene / editor** | MCP first — per-scene or per-instance node transform, hierarchy, node properties (`material` on MeshNode, colours, mesh/model refs, light/camera settings), prefab instance overrides, active scene |
| **Runtime behaviour** | TypeScript — reusable gameplay logic, class defaults, constructors for new runtime objects, new SceneNode/PrimitiveNode subclasses, input, networking, UI logic, systems not already in the scene |
| **Both** | Code first to build/register the capability, then MCP to place or configure it in the scene |

Do **not** use `beginPlay`, constructors, or one-off runtime hacks to patch a specific editor-authored node just to persist a visual scene change. Class defaults, runtime-spawned objects, and behaviour that applies to every instance still belong in code.

### Editor and MCP
The running editor is the source of truth for scene state. Make scene and editor changes through Genesys MCP when its tools are available. Before your first MCP call in a task, read `.agents/skills/genesys-mcp-orchestrator/SKILL.md` and follow it.

For outdoor worlds (terrain, water, islands, foliage, sky, lighting look), read `.agents/skills/genesys-world-building/SKILL.md` too.

When MCP is not ready, follow the `recovery` hint in the error (retry, open a scene, exit play mode) or stop and tell the user. Never edit runtime game code as a stand-in for a scene edit.

Do **not** read or open `*.genesys-scene` files unless the user explicitly asks or MCP is unavailable. They are large, and the editor holds the current state.

### Engine Source
Read-only engine source is in `.engine/` at the project root. `pnpm install` recreates it from `node_modules/@gnsx/genesys.js` (`src/`, `demos/examples/`, and top-level `*.md` files only), so do not edit it. Search it for class hierarchies, method signatures, and built-in implementations. Before you subclass an engine class or build a similar feature, read the matching engine code and follow its patterns.

### Assets
- **Engine assets** are in `node_modules/@gnsx/genesys.js/assets` (not in `.engine/`). Reference them by replacing `node_modules/@gnsx/genesys.js` with `@engine`: `node_modules/@gnsx/genesys.js/assets/models/SM_Cube.glb` → `@engine/assets/models/SM_Cube.glb`.
- **Project assets** are in `assets/` at the project root. Reference them with the `@project/` prefix: `assets/models/tiger.glb` → `@project/assets/models/tiger.glb`.
- When the user does not specify assets, check both locations for a match. Code art is fine when it fits the feature or helps prototype.

## Conventions
- Register custom node classes with `@GameClass`, never `@EngineClass`.
- Split logic, definitions, and configuration into separate, focused modules. Do not put everything in one file.
- Build in-game UI with the `genesys-ui-kit` skill. It covers the `BaseUIComponent` widget catalog, the `world.gameContainer` mounting rule, and Safe UI (XSS) handling for dynamic strings.
- The build copies a project asset only when its full `@project` path appears in one string literal. Do not join a folder prefix to a file name:
  ```typescript
  const good = '@project/assets/generated/mesh/fox.glb';
  const bad = `${MESH_DIR}fox.glb`; // file name is not in the literal
  ```
  When the path is chosen at runtime, list the asset or its folder in `.genesys-project` under `alwaysCopyAssets`, for example `"alwaysCopyAssets": ["@project/assets/generated/mesh"]`.
- The browser cannot load `@engine` or `@project` paths. Before you put them in an HTML string, resolve them with `await ENGINE.resolveAssetPathsInText(html)`. If the HTML also contains dynamic strings, follow the Safe UI rules in the UI kit skill.

## Environment & Verification
- Run every shell command (`pnpm`, `git`, TypeScript tools, etc.) from this game project root — the folder that contains `package.json` and the `.genesys-project` file. If your shell tool has a working-directory option, set it; otherwise `cd` there first. Do not rely on the default shell cwd; it may be the Genesys desktop app process directory.
- To check that code compiles, run `pnpm build`. Do not run `tsc` directly: `pnpm build` also regenerates the property metadata the editor reads.
- You **must** use `pnpm lint` to detect and auto-fix linting issues.
- When MCP is available, `query_diagnostics` and editor re-queries are also valid checks, and `action_build(action="buildProject")` registers newly added game classes in the running editor (not needed before Play).
- Entering Play already saves the scene and rebuilds the project. Do not run `action_build` before `enterPlayMode`; use it only to register new game classes.
- Verify with one Play session: enter once, capture, exit once. Diagnose with edit-mode queries first.
- Do not start a dev server (`pnpm dev` or similar).

### Viewing Play Without MCP
When Play is already running in the editor and MCP is off, you can capture frames from the Play listener. It is a separate service from MCP: the ban on shell calls to MCP applies only to `/mcp` and `/scenario/mcp` and does not apply to `.genesys/play-server.json`.
- Read the `baseUrl` and token from `.genesys/play-server.json`. List surfaces with `curl.exe -sf -H "Authorization: Bearer <token>" <baseUrl>/surfaces`, save a frame with `curl.exe -sf -H "Authorization: Bearer <token>" -o .genesys/play-capture-<id>.jpg "<baseUrl>/screenshot?surface=<id>"`, then read the image. On Windows use `curl.exe`; PowerShell `curl` is a different command.
- A missing file, refused connection, or 503 means Play is not running; ask the user. 429 means wait. Do not retry in a loop.

# GENESYS-SDK-END

# Add your custom AI instructions below.

