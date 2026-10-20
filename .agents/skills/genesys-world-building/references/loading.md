# Loading screens and scene readiness

A world keeps building after Play starts: water compiles its shaders, textured terrain generates its heights and bakes its textures and
compiles its shader, grass builds its field, and models load. Shown straight away, players watch it assemble (plain
terrain colours, then textures, then grass, then the water popping in). Cover the scene (your own overlay or fade) until the world is ready.

Read the signatures in `.engine/src/game/WorldReadiness.ts` and `.engine/src/utils/IReadiness.ts` before using them.

## The API

- `world.getLoadingProgress()` returns `{ ready, progress, total, pending }`. `progress` runs 0 to 1; `pending` lists
  `{ node, label }` such as "Compiling water shaders…", "Baking terrain textures…", "Growing grass…" or
  "Loading <model>…". A world that is not playing yet is not ready.
- `world.whenReady({ timeoutMs, steadyFrames, onProgress, signal })` always resolves, never rejects. After
  `timeoutMs` (default 30 s) it resolves with `timedOut: true` and the nodes still pending, so a loading screen
  never sticks. `steadyFrames` (default 12) also waits for that many smooth frames, which hides the first-draw shader stalls; pass `0` to skip.
- `world.beginLoadingTask(label)` returns a task (`update(progress, label?)`, `end()`) for your own loading step; it shows in `pending` until you end it. `world.isDestroyed()` tells a long async step the world is gone.
- `WaterNode`, `TerrainMeshNode`, `GrassNode` and `ScatterNode` each have `isReady`, `whenReady()` and `onReadyChanged`, if you only
  care about one of them.

A terrain with `erosion` above 0 generates its heights on a worker in the browser: it shows a flat placeholder (`isReady` false, "Generating terrain…") until the real shape arrives, and `terrain.whenHeightsReady()` waits for it. Height queries (`getHeightAt`) before then finish the work synchronously.

Failures never leave the game waiting: a terrain whose texture bake or shader fails falls back to vertex colours,
and water whose shaders take too long shows a flat plane until they finish. Both count as ready.

## Cover the first load

Start it from `preStart` and do not `await` it there: `beginPlay` runs after `preStart` returns, and the world counts
as loading until it plays.

```ts
class MyGame extends ENGINE.BaseGameLoop {
  protected override async preStart(): Promise<void> {
    await super.preStart();
    showCover();                                  // your own overlay
    void this.world.whenReady({ steadyFrames: 12 }).then(hideCover);
  }
}
```

## Cover a level switch

`onAfterLevelLoad` runs once the new level is playing. Start the wait there, and abort the previous one in
`onBeforeLevelLoad` with the `signal` option:

```ts
private levelLoad: AbortController | null = null;

protected override onBeforeLevelLoad(scenePath: string): void {
  super.onBeforeLevelLoad(scenePath);
  this.levelLoad?.abort();
}

protected override onAfterLevelLoad(scenePath: string): void {
  super.onAfterLevelLoad(scenePath);
  this.levelLoad = new AbortController();
  showCover();
  void this.world.whenReady({ signal: this.levelLoad.signal }).then(hideCover);
}
```

## Rules

- Use `whenReady`; do not poll individual nodes or wait a fixed number of seconds.
- Do not hide the scene with your own timer: the world reports when it is complete.
- After changing a water preset, terrain layers or a world style at runtime, the water keeps its old surface until the
  new one compiles. Call `whenReady` again only if you want to cover that change.
- Check the log after a `timedOut` result: it names the node that was still loading.
