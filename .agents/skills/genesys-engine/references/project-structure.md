# Genesys project structure

## Folder layout

```
my-game/
├── assets/                      # Scenes, materials, textures, models, audio, prefabs
│   └── default.genesys-scene    # Default level file (more assets are added as you create them)
├── src/                         # TypeScript source code
│   ├── game.ts                  # Entry point - GameMode + GameLoop + main()
│   ├── auto-imports.ts          # Generated: imports all source (DO NOT MODIFY)
│   └── game-data.ts             # Generated when using @ENGINE.property (DO NOT MODIFY)
├── .engine/                     # Read-only engine source mirror — the primary API reference
├── .agents/                     # Skill files consumed by AI tooling
├── .genesys/                    # SDK base files (configs, scripts) — do not modify
├── .dist/                       # Built bundle that Play runs (game.js)
├── scripts/genesys/             # Build, manifest, prefab-validation, and MCP helper scripts
├── packs/                       # In-project asset packs (optional)
├── package.json                 # Dependencies
├── tsconfig.json                # Extends .genesys/sdk/tsconfig.json
├── vite.config.ts               # Merges with .genesys/sdk/vite.config.js
├── eslint.config.js             # Extends .genesys/sdk/eslint.config.js
├── AGENTS.md                    # AI-agent rules
└── my-game.genesys-project      # Project metadata (the extension is the project marker)
```

Templates may add more `src/` files (for example a player pawn). The empty template ships only `game.ts` plus the generated `auto-imports.ts`.

Grow `src/` by concern, one class per file: `src/player/`, `src/enemies/`, `src/combat/`, `src/ui/`, `src/const.ts`. Keep `game.ts` to the GameMode, the loop, and `main()`. Every tunable number (speeds, damage, timers, spawn counts) goes in `src/const.ts` with a one-line comment; the rule and its shape are owned by `genesys-game-boot`. Shared module contracts (events, the GameMode facade) follow [contracts](contracts.md).

Run every shell command (`pnpm`, `git`) with the working directory set to the project root — the folder with `package.json` and the `.genesys-project` file.

## The src/game.ts file

Every game exports a `main()` function.

Source: project template `src/game.ts`; .engine/src/game/GameLoop.ts (`BaseGameLoop`, `BaseGameLoopOptions`), .engine/src/game/GameMode.ts
```typescript
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  // Game rules and player spawning
}

class MyGame extends ENGINE.BaseGameLoop {
  // World/Level lifecycle management
}

export function main(
  container: HTMLElement,
  options?: Partial<ENGINE.BaseGameLoopOptions>
): ENGINE.IGameLoop {
  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    defaultGameModeClass: MyGameMode,
  };
  return new MyGame(container, mergedOptions);
}
```

`BaseGameLoop` is the one class created with `new`; it is not a node.

- **GameMode** — rules, player spawning, default pawn and controller classes. Transient (not saved). The screen state machine and spawn factories live here; see `genesys-game-boot`.
- **GameLoop** — drives the engine tick and the World/level lifecycle; see [game-loop](game-loop.md).
- **main()** — the entry point the framework calls.

## Generated files

- `src/auto-imports.ts` — imports every source file so `@ENGINE.GameClass()` classes register. The build pipeline rewrites it. Never edit it.
- `src/game-data.ts` — metadata for `@ENGINE.property()` fields. Generated. Never edit it.

## Project configuration

The `.genesys-project` file at the root configures engine settings and default scenes.

- `defaultScene` — scene path for Play / runtime (for example `./assets/default.genesys-scene`).
- `defaultServerScene` — optional dedicated-server scene override.
- `engineVersion` — compatible engine version.
- `assetCompiler` — build-time compression settings; see `genesys-asset-compiler`.

## Scene files

Do not read or open `*.genesys-scene` files unless the user asks or MCP is unavailable. They are large, and the editor is the source of truth for scene state. Query the scene through MCP (`genesys-mcp-orchestrator`).

## Verifying code

- `pnpm build` — typecheck only.
- `pnpm lint` — detect and auto-fix lint issues.
- `pnpm test`, `pnpm dev`, and `pnpm start` are not supported.
- MCP `action_build(action="buildProject")` refreshes registered classes and the Play bundle. Bundle proof is in `genesys-game-boot`.
