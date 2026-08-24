---
name: engine-reference
description: Print the full engine source of a Genesys engine class by name — its methods, properties, options type, and JSDoc. Use before calling or extending any engine class whose exact signature you are unsure of, or when the user names a specific node, pawn, controller, or other engine type. To find a class name you do not know yet, use the engine-search skill first.
---

# Engine Reference

Look up a class you can already name. Prints its complete source file from
`.engine/src/`, the project's authoritative engine reference.

```bash
pnpm exec tsx .agents/skills/engine-reference/scripts/engine-reference.ts <ClassName> [ClassName2 ...]
```

```bash
pnpm exec tsx .agents/skills/engine-reference/scripts/engine-reference.ts PointLightNode
pnpm exec tsx .agents/skills/engine-reference/scripts/engine-reference.ts CharacterMovementNode MeshNode
```

Output is each file's contents preceded by a header naming the class and the
resolved path.

## Rules

- Pass exact class names. The script resolves them through `.engine/src/engine-data.ts`, then falls back to searching `.engine/src` for the class declaration.
- Do not know the class name? Use the `engine-search` skill first.
- Prefer this over grepping `node_modules/@gnsx/genesys.js/dist` — `dist` holds declarations only, without implementations.
- Reading `.engine/src/<subsystem>/` directly is equally valid when you want a whole subsystem rather than one class.
