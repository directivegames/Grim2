---
name: engine-reference
description: Quickly reference engine definitions by their qualified name. For example, viewing the source code of a specific node class. Use when you need to access engine definitions, or when the user requests you to use a specific SceneNode or gameplay type.
metadata:
    version: 1.0.0
---

# Engine Reference

## Common Classes
 - MeshNode
 - PointLightNode
 - CharacterMovementNode

## Usage

```
node .agents/skills/genesys/ptc/engine-reference/scripts/engine-reference.js <ClassName> [ClassName2 ...]
```

**Examples:**
```
node .agents/skills/genesys/ptc/engine-reference/scripts/engine-reference.js PointLightNode
node .agents/skills/genesys/ptc/engine-reference/scripts/engine-reference.js CharacterMovementNode MeshNode
node .agents/skills/genesys/ptc/engine-reference/scripts/engine-reference.js GameMode
```

## Output

Prints the full `.d.ts` declaration of each requested class to stdout, preceded by a header showing the resolved file path.

## Notes

- Run the documented **`.js`** script above. The sibling `engine-reference.ts` is a different/dev tool that reads `.engine/src` TypeScript sources — do **not** run the `.ts` expecting published `.d.ts` lookup behaviour.
- All engine declarations live under `node_modules/@gnsx/genesys.js/dist/src/`. You can also browse it directly if you know the subdirectory.
- The `.js` script searches for a file named `<ClassName>.d.ts` anywhere in that tree.
- Legacy `*Component` names may still resolve if a matching `.d.ts` exists; prefer `*Node` class names for v14.
- The `.d.ts` files include JSDoc comments, the full public API surface, and imported types.
