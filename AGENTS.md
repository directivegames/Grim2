# GENESYS-SDK-BEGIN
# Assets

## Engine Assets
- The engine's default assets are located in the **`node_modules/@gnsx/genesys.js/assets`** directory.
- To reference these assets in your code, replace the **`node_modules/@gnsx/genesys.js`** prefix with **`@engine`** in the asset path.

  **Example:**  
  If an asset is located at:  
  `node_modules/@gnsx/genesys.js/assets/models/SM_Cube.glb`  
  Then the corresponding URL should be:  
  `@engine/assets/models/SM_Cube.glb`


## Project Assets
- The project's assets are located in the **`/assets`** directory.
- To reference these assets in your code, use the **fully qualified path** with **`@project`** prefix.

  **Example:**  
  If an asset is located at:  
  `/assets/models/tiger.glb`  
  Then the corresponding URL should be:  
  `@project/assets/models/tiger.glb`

  **Important:** Write the complete path as one string literal (`'@project/assets/models/tiger.glb'`). The build copies only `@project/...` paths that appear in the bundle as a real file. Do **not** build that path with a shared prefix, a template literal, or `+`.

  ```typescript
  // Wrong — minification keeps the folder prefix, and the file is left out of the build
  const MESH = '@project/assets/generated/mesh/';
  const path = `${MESH}fox.glb`;

  // Right
  const path = '@project/assets/generated/mesh/fox.glb';
  ```

  The only exception is a path chosen at runtime (a level name, a generated id, a locale). List that file or folder in the `.genesys-project` file so the build copies it even though the full path is not a literal:

  ```json
  "alwaysCopyAssets": ["@project/assets/generated/mesh"]
  ```

## Resolve Asset Paths
- Using asset paths containing `@engine` or `@project` in raw html will not work out of the box as the browser doesn't know how to resolve them.
  The solution is to resolve them using **`ENGINE.resolveAssetPathsInText`** first.
  Example:
  ```
  const htmlString = '...<img src="@engine/assets/textures/Checkerboard.png">...'
  const resolvedHtml = await ENGINE.resolveAssetPathsInText(htmlString);
  // then use resolvedHtml as normal
  ```

## Loading Textures (Runtime)
- `@project/`/`@engine/`: `ENGINE.resourceManager.loadTexture(ENGINE.AssetPath.fromString('@project/.../foo.png'))` — keep the logical path (`.png`/`.jpg`) even with baking.
- Never `TextureLoader` after resolve (baking → `.ktx2`). `TextureLoader` only for external URLs; `resolveAssetPathsInText` only for HTML.

## Prefabs
- Prefabs are json files stored under `/assets` (commonly `/assets/prefabs`), with the suffix `.prefab.json`.
- Prefer Prefabs for reusable scene-node templates when the same hierarchy is placed more than once, stays in sync, or is spawned at runtime. See the `genesys-prefabs` skill.
- Create, place, and isolate via MCP first (`genesys.actionPrefab` / `batch_execute`); do not hand-edit `.prefab.json`.
- When referencing classes in prefab/serialized data, use the appropriate prefix.
  Engine classes **must** be referenced as `ENGINE.{class name}`, example: `ENGINE.SceneNode`, `ENGINE.MeshNode`.
  Custom game classes **must** be referenced as `GAME.{class name}`, example: `GAME.MyCustomNode`, `GAME.MyPickupRoot`.

---

# Scene And Editor State

Do **not** read or open `*.genesys-scene` files unless the user explicitly asks or MCP is unavailable and filesystem fallback is appropriate. These files are large and the editor is the source of truth for scene state.

For scene-visible or editor-authored changes, use Genesys MCP first when Connected or Probe-capable (see `.cursor/rules/genesys-mcp.mdc` and `.agents/skills/genesys-mcp-orchestrator/SKILL.md`). Before **mutations**, run `query_editor(getState)`; read-only queries can go straight to `query_node` / `run_script(readOnly)`. Mutate with `action_node`, `action_scene`, compact-hidden `action_prefab` (`genesys.actionPrefab`), or `batch_execute` / `run_script`. Flush scenes with `action_scene(save)`; flush Prefab Editor with `action_prefab.save` / `close`.

**Before writing code, decide where this state should live** (scene/editor vs runtime behaviour) and route accordingly.

| State owner | Use |
| --- | --- |
| **Scene / editor** | MCP first — per-scene or per-instance node transform, hierarchy, node properties (`material` on MeshNode, colours, mesh/model refs, light/camera settings), prefab instance overrides, active scene |
| **Runtime behaviour** | TypeScript — reusable gameplay logic, class defaults, constructors for new runtime objects, new SceneNode/PrimitiveNode subclasses, input, networking, UI logic, systems not already in the scene |
| **Both** | Code first to build/register the capability, then MCP to place or configure it in the scene |

Do **not** use `beginPlay`, constructors, or one-off runtime hacks to patch a specific editor-authored node just to persist a visual scene change. It is still correct to define reusable class defaults, construct runtime-created objects, and initialise behaviour in code when those values should apply to every instance or to objects spawned at runtime.

---

# Coding Rules

**CRITICAL**: Never edit `auto-imports.ts` - This file is automatically generated by the build pipeline to register all @ENGINE.GameClass() decorated classes. Any manual changes will be overwritten and may break the build system. Classes with proper @ENGINE.GameClass() decorators are automatically discovered and imported.

## General Guidelines
- Before implementing, take a hard look of the engine and figure out what can be used to implement the user's requirement. **Do not** reinvent wheels. When using the search tool, expand the search parameters with similar keywords.
- Work **WITH** the engine architecture, **NOT** against it. 
- Try to find and use appropriate art assets as needed if the user does not specify. Check both engine and project assets for something that fits the feature.
- You **should avoid** writing **monolithic code** — do not place all logic, definitions, and configurations into a single file.  
  Instead, structure your code into modular, reusable, and maintainable components.
- Custom node classes **must not** be registered as **`EngineClass`**, use **`GameClass`** instead.
- **Do not** create documentation or test/example code unless specifically asked to.
- Be **very brief** on the summary when the implementation is completed.

## Engine Source Reference
- The engine source code is available in the **`.engine`** folder at the project root.
- Use the engine source as the **primary reference** when implementing game code to understand:
  - Class hierarchies and inheritance patterns
  - Available methods, properties, and their signatures
  - Engine conventions and coding patterns
  - How built-in features are implemented
- When extending engine classes or implementing similar functionality, **study the existing engine code** to ensure consistency and proper integration.
- The `.engine` folder mirrors the structure of the engine package — search here first when you need to understand how a particular system works.

## UI
- Any HTML UI you create **MUST NOT** be added to the document root directly. Add them to the game UI container, which can be accessed through `world.gameContainer`.
- For in-game UI (HUD, menus, buttons, bars, inventories, crosshairs, minimaps, counters, etc.), **prefer the engine's `BaseUIComponent` widgets** (Game UI Kit) over hand-rolling HTML / CSS. See the `genesys-ui-kit` skill in `.agents/skills/genesys-ui-kit/` — its `references/catalog.md` lists every shipped widget. Fall back to raw HTML only when the user asks for a custom look or no widget matches.
- **Safe UI (XSS):** Dynamic strings (player names, chat, scores, RPC / `joinParams`) go through text setters (`setLabel`, `setMessage`, `setTitle`) or `element.textContent` — never `innerHTML`, `setHTML`, `iconHtml` / `setIconHtml`, or `imageHtml`. Those `*Html` APIs are for developer-authored markup only (e.g. `ENGINE.Icons.*`). Do not put network or player strings into `customStyles`. Follow the **Safe UI** section in the `genesys-ui-kit` skill and `.agents/skills/genesys-ui-kit/references/safe-ui.md`.

## Testing Constraints
- You may **only** use `pnpm build` to verify code compilation.
- You **must** use `pnpm lint` to detect and auto-fix linting issues.
- For every shell command (`pnpm`, `git`, TypeScript tools, etc.), set `workingDirectory` to this game project root — the folder that contains `package.json` and the `.genesys-project` file. Do not rely on the default shell cwd; it may be the Genesys desktop app process directory.
- To register newly added game classes in the running editor, use MCP `action_build(action="buildProject")`.
- Do **not** run `pnpm test`, `pnpm dev`, or `pnpm start` — these commands are **not supported**.
- To see the game while Play is already running in the editor and MCP is off, read pixels from the Play listener. Do not start a dev server.
  1. Play must already be running in the editor.
  2. Read `.genesys/play-server.json` (from the project root).
  3. `curl.exe -sf -H "Authorization: Bearer <token>" <baseUrl>/surfaces`
  4. `curl.exe -sf -H "Authorization: Bearer <token>" -o .genesys/play-capture-<id>.jpg "<baseUrl>/screenshot?surface=<id>"`
  5. Read the image. On Windows use `curl.exe`; PowerShell `curl` is a different command.
  6. A missing file, refused connection, or 503 means Play is not running; ask the user. 429 means wait. Do not retry in a loop.
- All testing is the responsibility of the user.  
  You are encouraged to:
  - Recommend suitable testing approaches.
  - Collaborate with the user to evaluate test results.


## Prompt Handling & Clarification

Before implementing any user request, you **must** interpret the prompt, identify ambiguities, and either:
- State clear assumptions **before** coding, or
- Ask the user targeted clarification questions.

When `request_user_input` is in your tool list, call it instead of asking those questions in chat, then wait for the answer. Use it only when a wrong assumption would change the work. Otherwise state the assumption and continue. Prefer one question (three at most). Put the recommended option first and suffix its label with "(Recommended)". Do not add an Other option.

### Required Steps
1. **Understand intent** — Restate what the user is asking in your own words.
2. **Identify ambiguities** — Look for vague or overloaded terms.
3. **Clarify or assume** —
   - If unclear and `request_user_input` is available, call it with specific, short questions and wait.
   - If the tool is not available, ask specific, short questions in chat.
   - If the user skips or cannot clarify, proceed with explicit, written assumptions.
4. **Confirm scope** — Specify what systems, assets, or files you will change.

This process **prevents incorrect implementations** when user wording is incomplete or ambiguous.

## Implementation Plan Tags

When planning mixed work, tag each step by state owner so scene edits are not mistaken for code tasks:

- `[Code]` — TypeScript/source changes
- `[MCP]` — scene, node, prefab, material, transform, or other editor state changes
- `[Asset]` — imported, moved, or generated asset files
- `[Verify]` — build, lint, diagnostics, or editor re-query

Example: `[MCP] Set MeshNode material on Floor root` → `[Verify] Re-query node and confirm scene saved`.

## Keeping SDK Files From Updating

When the project is opened, the SDK refreshes the files and skills it manages (for example `scripts/genesys/**`, `.vscode/**`, `.agents/skills/<name>`). To keep your own edits to one of them, list its project-relative path in a `.genesysignore` file at the project root, using `.gitignore` syntax (globs, `#` comments, `!` negation, trailing `/` for directories). Matching files are not added, updated, or deleted. `package.json` and the SDK sections of marker-based files (such as this one) always update.
# GENESYS-SDK-END

# Add your custom AI instructions below.

