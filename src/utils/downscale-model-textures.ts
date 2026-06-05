import * as THREE from 'three';

/**
 * Mobile-only runtime texture downscaling.
 *
 * GLB-embedded textures are decoded by three's GLTFLoader at full resolution and
 * uploaded to the GPU as-is. On mobile that steady-state GPU footprint blows past
 * Safari/WKWebView's low per-tab memory cap. We shrink each unique texture's image
 * to a max dimension on a canvas and swap it in, so the GPU only ever holds the
 * small version.
 *
 * Textures are shared across instances (SkeletonUtils.clone + the resource-manager
 * cache share material/texture references), so a `WeakSet` ensures each unique
 * texture is processed exactly once no matter how many actors reference it.
 *
 * This is intentionally NOT used on desktop — desktop has the memory headroom and
 * keeps full-resolution assets.
 */

const _processed = new WeakSet<THREE.Texture>();

/** Material property keys that may hold a THREE.Texture worth shrinking. */
const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'specularMap',
] as const;

function downscaleTexture(tex: THREE.Texture | null | undefined, maxDim: number): void {
  if (!tex || _processed.has(tex)) {
    return;
  }
  // Compressed (KTX2/DDS) and data textures can't be canvas-resized.
  if ((tex as unknown as { isCompressedTexture?: boolean }).isCompressedTexture
    || (tex as unknown as { isDataTexture?: boolean }).isDataTexture) {
    _processed.add(tex);
    return;
  }

  const img = tex.image as { width?: number; height?: number; close?: () => void } | undefined;
  if (!img) {
    // Not decoded yet (e.g. an async material override) — leave unmarked so a later
    // pass can shrink it once its image is available.
    return;
  }

  const w = img.width ?? 0;
  const h = img.height ?? 0;
  if (w <= 0 || h <= 0) {
    _processed.add(tex);
    return;
  }

  const maxSide = Math.max(w, h);
  if (maxSide <= maxDim) {
    _processed.add(tex);
    return;
  }

  const scale = maxDim / maxSide;
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.drawImage(img as CanvasImageSource, 0, 0, nw, nh);
    tex.image = canvas;
    tex.needsUpdate = true;
    // Release the original decoded bitmap's memory immediately where supported.
    if (typeof img.close === 'function') {
      img.close();
    }
    _processed.add(tex);
  } catch (error) {
    console.warn('[downscaleModelTextures] failed to downscale a texture', error);
    _processed.add(tex);
  }
}

/**
 * Walk an Object3D hierarchy and downscale every material texture larger than
 * `maxDim`. Safe to call repeatedly (already-shrunk textures are skipped).
 */
export function downscaleModelTextures(root: THREE.Object3D | null | undefined, maxDim: number): void {
  if (!root) {
    return;
  }
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.material) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      const bag = material as unknown as Record<string, unknown>;
      for (const key of TEXTURE_KEYS) {
        const value = bag[key];
        if (value && (value as THREE.Texture).isTexture) {
          downscaleTexture(value as THREE.Texture, maxDim);
        }
      }
    }
  });
}
