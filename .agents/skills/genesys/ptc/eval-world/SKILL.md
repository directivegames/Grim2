---
name: eval-world
description: |
  Query or modify the project with a JavaScript snippet. Use whenever you are requested to add/modify/query the scene file or the projects contents. For example: spawning actors, configuring components, or reading scene data.
metadata:
    version: 1.0.0
---

# Eval World

These steps must be followed exactly: 

1. Read `./scripts/editorContext.ts` to understand the available API. All calls must go through this interface.
2. Use `engine-search` skill to search the codebase, and understand what classes and capabilities exist.
3. Generate and send the request.

## Available Globals Inside the Script

| Global | Description |
|--------|-------------|
| `editor` | Implementation of IEditorContext interface |
| `ENGINE` | The full `@gnsx/genesys.js` namespace |
| `THREE` | The full `three` namespace |


## How to Use

Pass the JavaScript snippet directly as an inline string argument.

The script runs inside an `async` function body and **must** use `return` to produce a result. Always `return` the created object -it will automatically by serialized.

**The script must be minified — written as a single line with no newlines.** Use semicolons to separate statements.

```
npx tsx .agents/skills/eval-world/scripts/eval-world.ts "<your minified js here>"
```

## Result

- Prints the return value as JSON to stdout.
- Exits with code `1` if the call fails (e.g. script throws).
