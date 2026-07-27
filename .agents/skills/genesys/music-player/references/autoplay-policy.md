# Browser Autoplay Policy

## The problem

All modern browsers block audio playback until the user has interacted with the page (click, tap, keypress). Calling `play()` on an `AudioBufferSourceNode` before a user gesture throws a `NotAllowedError` or is silently ignored, depending on the browser.

## How MusicPlayerActor handles it

`start()` defers actual playback until `waitForLoad()` resolves, then calls `audioContext.resume()`. This covers cases where the context was created while suspended. However, `resume()` also requires a user gesture — if `start()` is called during automatic game initialisation with no gesture, the `resume()` call will be silently blocked and the music will not play.

## Safe patterns

Call `start()` from a user-gesture handler:

```ts
// From a "Start Game" button click:
startButton.addEventListener('click', () => {
  BackgroundMusicActor.ensurePlaying(world, '@project/assets/sounds/Track.mp3');
});
```

Or use the engine's input system — the first `handleMouseDown` or `handleKeyDown` fires in response to a gesture:

```ts
handleMouseDown(): boolean {
  if (!this._musicStarted) {
    this._musicStarted = true;
    music.start();
  }
  return false;
}
```

## Suspended context detection

```ts
const ctx = soundComponent.getAudioContext();
if (ctx?.state === 'suspended') {
  await ctx.resume(); // only works inside a user gesture handler
}
```

## Testing

In Chrome, open DevTools → Application → Frames and check the audio context state. A `suspended` context after clicking Start usually indicates the `resume()` call is happening outside a gesture frame. Move the `start()` call closer to the user interaction.
