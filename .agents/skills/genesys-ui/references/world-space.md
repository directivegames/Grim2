# World-space UI

Text and widgets that belong to a point in the world: nameplates, overhead health bars, interact prompts, quest markers, floating damage numbers. Three engine nodes cover it. All three are SceneNodes, so build them with `.create()` and `add` them to the node they follow; the widgets they host are not SceneNodes and are built with `new`.

| Node | Draws | Use for | Cost |
|---|---|---|---|
| `UI3DNode` | Any `BaseUIComponent` (DOM), moved to the node's projected screen point every frame | Overhead `ProgressBar`, nameplate `Badge` / `Message`, interact prompt `Keystroke` / `Message`, objective arrow | One DOM widget each; fine for 1–20 |
| `TextNode` | Canvas text on a camera-facing sprite, in 3D (occluded by walls unless `depthTest: false`) | Damage numbers, floating signs, debug labels | One canvas texture and material per node; cap live ones |
| `BillboardNode` | An image on a camera-facing sprite | Markers, simple far impostors, an icon over a pickup | One texture load per image path |

Source: `.engine/src/nodes/visual/UI3DNode.ts`, `.engine/src/nodes/visual/TextNode.ts`, `.engine/src/nodes/visual/BillboardNode.ts`.

## `UI3DNode`

| Option / property | Default | Notes |
|---|---|---|
| `uiComponent` | — | The widget. `UI3DNode` calls `initialize()` on it at `beginPlay` (or at once when already in the world) and `show()`s it |
| `screenOffset` | `null` | `{ x, y }` pixels added after projection, multiplied by the distance scale. Negative `y` moves up |
| `hideWhenBehindCamera` | `true` | Hides the widget when the point is behind the camera |
| `clampToScreenBounds` | `true` | Keeps the widget `screenMargin` px inside the view |
| `screenMargin` | `10` | Points closer than this to an edge hide the widget |
| `distanceScaling` | `null` | `{ baseDistance, minScale, maxScale }`: scale = `baseDistance / distance`, clamped. `{ 8, 0.5, 1 }` keeps bars readable from 8 m out to 16 m |

Behaviour to know:
- Each frame, while the point is on screen, it writes `setPosition({ left, top, position: 'absolute', transform: 'translate(-50%, -50%) scale(s)' })` and shows the widget; off screen or behind the camera it hides it. A `hide()` on the widget (or `setVisible(false)` on the pin) sticks until `show()` (or `setVisible(true)`).
- `endPlay` hides the widget and lets go of it, but never destroys it. Call `widget.destroy()` when the owner dies or the prompt is no longer needed.
- Set text after the widget is initialized: `await widget.initialize()` first, then set text, then hand it to the pin (below).
- The pin is a child of the node it follows: its `position` is local (head height ≈ 1.8–2.2 m for a humanoid).

Overhead health bar:

Source: `.engine/src/nodes/visual/UI3DNode.ts`, `.engine/src/ui/components/ProgressBar.ts` — typechecked against 18.1.0-alpha.317
```ts
// Overhead health bar: a screen widget pinned to a point above the enemy.
export function addOverheadBar(world: ENGINE.World, enemy: ENGINE.SceneNode, headY = 2.1): ENGINE.ProgressBar {
  const bar = new ENGINE.ProgressBar(world.uiManager, { ...ENGINE.ProgressBar.presets.healthSmall,
    currentValue: 100, maxValue: 100, width: 72, textDisplay: 'none' });
  const pin = ENGINE.UI3DNode.create({
    position: new THREE.Vector3(0, headY, 0),        // local to the enemy
    uiComponent: bar,                                // UI3DNode initializes it and moves it every frame
    hideWhenBehindCamera: true,
    screenOffset: { x: 0, y: -8 },                   // pixels; negative is up
    distanceScaling: { baseDistance: 8, minScale: 0.5, maxScale: 1 },
  });
  enemy.add(pin);
  return bar;                                        // bar.setValue(hp); on death: bar.destroy(), then destroy the enemy
}
```

Nameplate or world-space interact prompt:

Source: `.engine/src/nodes/visual/UI3DNode.ts`, `.engine/src/ui/components/Message.ts` (`setMessage`) — typechecked against 18.1.0-alpha.317
```ts
// Interact prompt / nameplate over a node. Initialize the widget first so text can be set before it is pinned.
export async function addLabelPin(world: ENGINE.World, owner: ENGINE.SceneNode, text: string, height = 1.6): Promise<{ msg: ENGINE.Message; pin: ENGINE.UI3DNode }> {
  const msg = new ENGINE.Message(world.uiManager, {});
  await msg.initialize();
  msg.setMessage({ body: text });                  // text setter: safe for player names
  const pin = ENGINE.UI3DNode.create({ position: new THREE.Vector3(0, height, 0), uiComponent: msg, screenOffset: { x: 0, y: -12 } });
  owner.add(pin);
  return { msg, pin };
}
```

- **Interact prompt.** The text comes from `pawn.getInteractionNode()?.getCurrentPrompt()`, polled every 0.1 s (`genesys-interactions`); an empty string hides it. Default: one screen-space prompt at `bottom-center`, 96 px up (a `Keystroke` "E" beside a `Message`). Use a world-space pin over the object instead when several interactables sit close together and the player must see which one is meant.
- **Nameplates.** Online player names arrive from the network: text setters only (`setMessage`, `setLabel`), never `iconHtml` (`genesys-multiplayer`). Show nameplates within 25 m; beyond that `hide()` them.
- **Enemy bars.** Show the bar only after the first hit, hide it 3 s after the last one, and never on enemies that die in one hit. A boss gets a screen `ProgressBar` with `presets.boss` at `top-center` instead.

## `TextNode`

| Option | Default | Notes |
|---|---|---|
| `text` | `''` | `updateText(newText)` re-renders. Canvas `fillText`: never parsed as HTML |
| `fontSize` / `fontFamily` / `fontWeight` | 32 / `'Arial'` / `'bold'` | `fontFamily` takes a loaded `@font-face` family name too |
| `textColor` | `'#ffffff'` | |
| `backgroundColor` / `backgroundOpacity` | `'#000000'` / 0.7 | `backgroundOpacity: 0` for floating numbers |
| `padding` / `borderRadius` | 10 / 10 | |
| `canvasWidth` / `canvasHeight` | 512 / 128 | The sprite is `canvasWidth / canvasHeight` m wide and 1 m tall at scale 1. Scale the node to size it |
| `depthTest` / `depthWrite` | true / false | `depthTest: false` keeps damage numbers visible through the target |

`TextNode` never ticks (`canEverTick = false`), so `setLifeSpan` on it does nothing. Move and destroy it from a tween or from a ticking owner.

### Floating damage numbers

Rise 0.8 m and shrink to half over 600 ms, then destroy. White for normal hits, `#ffd23f` and larger (`fontSize` 80) for crits, red `#ff5a5a` for damage the player takes. Cap live numbers at 12 and drop the rest; at very high hit rates, sum hits per target over 100 ms into one number.

Source: `.engine/src/nodes/visual/TextNode.ts`, `.engine/src/systems/TweenManager.ts` (`createTween`, `getCurrentTime`) — typechecked against 18.1.0-alpha.317
```ts
const MAX_LIVE_NUMBERS = 12;   // past the cap, drop the new number
let liveNumbers = 0;
// Floating damage number: canvas text in the world, rises 0.8 m and shrinks over 600 ms, then is destroyed.
export function spawnDamageNumber(world: ENGINE.World, at: THREE.Vector3, amount: number, crit = false): void {
  if (liveNumbers >= MAX_LIVE_NUMBERS) return;
  liveNumbers++;
  const label = ENGINE.TextNode.create({
    text: String(Math.round(amount)), fontSize: 64, textColor: crit ? '#ffd23f' : '#ffffff',
    backgroundOpacity: 0, canvasWidth: 256, canvasHeight: 96, depthTest: false,
    position: at.clone().add(new THREE.Vector3(0, 1.2, 0)), scale: new THREE.Vector3(0.6, 0.6, 0.6),
  });
  world.add(label);
  const startY = label.position.y;
  const t = { k: 0 };
  world.tweenManager.createTween(t)
    .to({ k: 1 }, 600)
    .onUpdate(() => { label.position.y = startY + 0.8 * t.k; label.scale.setScalar(0.6 * (1 - 0.5 * t.k)); })
    .onComplete(() => {
      label.destroy();
      liveNumbers--;
    })
    .onStop(() => { liveNumbers--; })       // world teardown stops tweens without completing them
    .start(world.tweenManager.getCurrentTime());
}
```

Call it from the hit handler, in the same place as the impact effect and hit sound (`genesys-combat` raises the hit; `genesys-vfx` and `genesys-audio` own the other two channels).

## `BillboardNode`

| Option | Default | Notes |
|---|---|---|
| `imageUrl` | `''` | Literal `@project/assets/...` path. The image is a GPU texture, so it may be KTX2-compressed at build |
| `depthTest` / `depthWrite` | true / true | |
| `transparent` | true | |
| `toneMapped` | true | Set false for a marker that must keep its exact colour |

## Traps

- Bars or labels float at the enemy's feet → the pin sits at the owner's origin. Give it a local `position` at head height.
- Damage numbers disappear inside the enemy → `depthTest` is true. Set `depthTest: false` on the `TextNode`.
- Numbers never leave → the tween's `onComplete` does not destroy, or `.start()` used the wall clock. Destroy in `onComplete`, start with `world.tweenManager.getCurrentTime()`.
- A hitch on every hit with many numbers → one canvas texture per `TextNode` with no cap. Cap at 12, merge hits per target.
- A nameplate shows raw HTML or runs script → it went through `iconHtml` or `innerHTML`. Use `setMessage` / `setLabel`.
- An overhead bar does not come back after it went off screen → it was hidden with `hide()` or `setVisible(false)`, which sticks → `show()` the widget or `setVisible(true)` on the pin.
- Overhead bar widgets leak after enemies die → `UI3DNode` hides its widget on destroy but never destroys it, so the hidden elements stay in the DOM → `widget.destroy()` before the enemy is destroyed.
