---
name: engine-reference
description: Quickly reference engine definitions by their qualified name. For example, viewing the source code of a specific component. Use when you need to access engine definitions, or when the user requests you to use a specific actor or component.
metadata:
    version: 1.0.0
---

# Engine Reference

## Common Classes
 - MeshComponent

## Usage

```
node .agents/skills/engine-reference/scripts/engine-reference.js <ClassName> [ClassName2 ...]
```

**Examples:**
```
node .agents/skills/engine-reference/scripts/engine-reference.js PointLightComponent
node .agents/skills/engine-reference/scripts/engine-reference.js CharacterMovementComponent GLTFMeshComponent
node .agents/skills/engine-reference/scripts/engine-reference.js GameMode
```

## Output

Prints the full `.d.ts` declaration of each requested class to stdout, preceded by a header showing the resolved file path.

## Notes

- All engine declarations live under `node_modules/@gnsx/genesys.js/dist/src/`. You can also browse it directly if you know the subdirectory.
- The script searches for a file named `<ClassName>.d.ts` anywhere in that tree.
- The `.d.ts` files include JSDoc comments, the full public API surface, and imported types — making them the best reference for understanding how to use a class.
