/**
 * Install a dual-backend grass material conversion for WebGPU.
 *
 * Genesys runs WebGPU via THREE.WebGPURenderer which cannot execute THREE.ShaderMaterial directly.
 * The engine supports this by converting specific ShaderMaterials (e.g. MatcapShaderMaterial)
 * into NodeMaterials via the renderer's internal node library (`library.fromMaterial`).
 *
 * This patch adds the same conversion hook for our grass sway material.
 */
import * as ENGINE from '@gnsx/genesys.js';
import { getOrCreateWebGpuGrassFromSource, GrassSwayShaderMaterial } from './materials/grass/grassDualBackend.js';

const PATCHED = '__grimGrassShaderPatched' as const;

function applyPatch(): void {
  const Ctor = ENGINE.GenesysWebGPURenderer as unknown as {
    prototype?: Record<string, unknown>;
    create?: (...args: any[]) => any;
  };
  const proto = Ctor.prototype as any;
  if (!proto || proto[PATCHED]) return;

  // Patch instance method used by GenesysWebGPURenderer constructor.
  const libraryGetter = Object.getOwnPropertyDescriptor(proto, 'library')?.get;
  // Fallback: patch create() to install after construction if we can't hook library early.
  const wrapCreate = (): void => {
    const origCreate = (Ctor as any).create as ((...args: any[]) => any) | undefined;
    if (typeof origCreate !== 'function') return;
    (Ctor as any).create = (...args: any[]) => {
      const renderer = origCreate(...args);
      tryInstallHook(renderer);
      return renderer;
    };
  };

  const tryInstallHook = (renderer: any): void => {
    const lib = renderer?.library as { fromMaterial?: (m: any) => any } | undefined;
    if (!lib || typeof lib.fromMaterial !== 'function') return;
    if ((lib as any)[PATCHED]) return;

    const baseFromMaterial = lib.fromMaterial.bind(lib);
    lib.fromMaterial = (material: any) => {
      if (material instanceof GrassSwayShaderMaterial) {
        return getOrCreateWebGpuGrassFromSource(material);
      }
      return baseFromMaterial(material);
    };
    (lib as any)[PATCHED] = true;
  };

  // Preferred: if the getter exists, patch `create` and install hook post-construct.
  // (Genesys sets library.fromMaterial inside its constructor; we extend it afterward.)
  if (libraryGetter) {
    wrapCreate();
  } else {
    wrapCreate();
  }

  proto[PATCHED] = true;
}

applyPatch();

