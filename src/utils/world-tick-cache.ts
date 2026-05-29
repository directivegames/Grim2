import * as ENGINE from '@gnsx/genesys.js';

let _cachedFrameKey = -1;
let _cachedWorld: ENGINE.World | null = null;
let _cachedPlayer: ENGINE.Pawn | null = null;

/** ~60Hz frame key from game time — World has no frameCount property. */
function getWorldFrameKey(world: ENGINE.World): number {
  return Math.floor(world.getGameTime() * 60);
}

/** One getFirstPlayerPawn() per world per frame — shared by horde AI. */
export function getCachedPlayerPawn(world: ENGINE.World): ENGINE.Pawn | null {
  const frameKey = getWorldFrameKey(world);
  if (_cachedWorld === world && _cachedFrameKey === frameKey) {
    return _cachedPlayer;
  }
  _cachedFrameKey = frameKey;
  _cachedWorld = world;
  _cachedPlayer = world.getFirstPlayerPawn();
  return _cachedPlayer;
}

export function getCachedWorldFrame(world: ENGINE.World): number {
  return getWorldFrameKey(world);
}
