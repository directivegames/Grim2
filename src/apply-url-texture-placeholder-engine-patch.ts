/**
 * Keeps serialized UrlTexture instances renderable while their source image is
 * loading. Three.js WebGPU reads `texture.image.complete` and throws when the
 * image is null.
 *
 * Newer engine builds initialise this in UrlTexture's constructor. Reapply it
 * after deserialization as a compatibility measure for editor-created assets
 * that bypass that constructor state.
 */
import * as ENGINE from '@gnsx/genesys.js';

const PATCHED = Symbol.for('grim.urlTexturePlaceholderPatched');

function addPlaceholderIfNeeded(texture: ENGINE.UrlTexture): void {
  if (texture.image !== null && texture.image !== undefined) {
    return;
  }
  if (typeof document === 'undefined') {
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  texture.image = canvas;
  texture.needsUpdate = true;
}

function applyPatch(): void {
  const prototype = ENGINE.UrlTexture.prototype as ENGINE.UrlTexture & {
    [PATCHED]?: boolean;
    deserialize(loader: unknown): void;
  };
  if (prototype[PATCHED]) {
    return;
  }

  const inheritedDeserialize = prototype.deserialize;
  prototype.deserialize = function deserializeWithPlaceholder(loader: unknown): void {
    inheritedDeserialize.call(this, loader);
    addPlaceholderIfNeeded(this);
  };
  prototype[PATCHED] = true;
}

applyPatch();
