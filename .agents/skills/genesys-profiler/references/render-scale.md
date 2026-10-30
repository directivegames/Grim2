# Render scale

The short rule is in [SKILL.md → Spend the frame budget](../SKILL.md#spend-the-frame-budget).

## `r.ScreenPercentage` vs `setPixelRatio`

`Renderer` registers `r.ScreenPercentage` (default `100`, meaning pixel ratio 1.0) and calls `native.setPixelRatio(value / 100)` whenever the variable changes. If the variable is still at default when the renderer starts, the renderer writes the current pixel ratio back into it. So a game that calls `renderer.native.setPixelRatio()` directly leaves the variable stale, and the next change to the variable overwrites it. Set the variable instead: type `r.ScreenPercentage 75` in the play console, or from code:

Source: .engine/src/systems/ConsoleVariableManager.ts, .engine/src/render/Renderer.ts
```ts
// 75 = render at 0.75 pixel ratio; values above 100 raise fill cost on HiDPI screens.
ENGINE.CVarManager.setValue('r.ScreenPercentage', 75);
```

`setPixelRatio` / `getPixelRatio` remain the underlying `IGenesysRenderer` methods (`.engine/src/render/IGenesysRenderer.ts`). Read `Renderer.ts` before calling them from game code.
