# Genesys Project Structure

## Folder Layout

```
my-game/
├── assets/                      # Scenes, materials, textures, models, audio, prefabs
│   └── default.genesys-scene    # Default level file (more assets are added as you create them)
├── src/                         # TypeScript source code
│   ├── game.ts                  # Entry point - GameMode + GameLoop + main()
│   ├── auto-imports.ts          # Auto-generated: imports all source (DO NOT MODIFY)
│   └── game-data.ts             # Auto-generated when using @property (DO NOT MODIFY)
├── .engine/                     # Read-only engine source mirror — use as the primary API reference
├── .agents/                     # Skill files (including this one) consumed by AI tooling
├── .genesys/                    # SDK base files (configs, scripts) — do not modify
├── scripts/genesys/             # Build, manifest, prefab-validation, and MCP helper scripts
├── packs/                       # In-project asset packs (optional)
├── package.json                 # Dependencies
├── tsconfig.json                # TS config (extends .genesys/sdk/tsconfig.json)
├── vite.config.ts               # Vite config (merges with .genesys/sdk/vite.config.js)
├── eslint.config.js             # ESLint config (extends .genesys/sdk/eslint.config.js)
├── AGENTS.md                    # AI-agent rules
└── my-game.genesys-project      # Project metadata file (extension is the project marker)
```

Templates may add more `src/` files (for example a player pawn). The empty template ships only `game.ts` plus generated `auto-imports.ts`.

The engine source under .engine/ is the primary reference for class hierarchies, method signatures, and conventions when extending or composing engine APIs.

## The src/game.ts File

Every game requires a game.ts file exporting a main() function.

### Structure

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

### Core Classes

GameMode — Defines rules, player spawning, and default classes (Pawn, PlayerController). Transient (not saved).

GameLoop — Drives engine tick, manages World/Level lifecycle and state persistence.

main() — Entry point function called by the framework.

## Auto-Generated Files

src/auto-imports.ts — Imports all source files for compilation. Do not modify.

src/game-data.ts — Metadata for @ENGINE.property() decorated fields. Do not modify.

## Project Configuration

The .genesys-project file in the root configures engine settings and default scenes.

Fields:
- defaultScene — Default scene path for play / runtime.
- defaultServerScene — Optional dedicated-server scene override.
- engineVersion — Compatible engine version.
