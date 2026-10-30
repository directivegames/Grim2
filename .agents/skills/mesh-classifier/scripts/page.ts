/**
 * Browser entry, bundled by classify.ts and driven over the DevTools protocol.
 * `window.classify(url, opts)` loads one GLB, measures it, renders it, and returns plain JSON.
 */

import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { measure } from './measure.js';
import { render } from './render.js';

import type { ClassifyResult, RenderOptions } from './types.js';

declare global {
  interface Window {
    classify: (url: string, opts: RenderOptions) => Promise<ClassifyResult>;
    classifierReady: boolean;
  }
}

window.classify = async (url, opts) => {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the GLB (${res.status})`);
  const gltf = await loader.parseAsync(await res.arrayBuffer(), '');
  const measurement = measure(gltf.scene, gltf.animations);
  return { measurement, render: render(gltf.scene, measurement, opts) };
};

window.classifierReady = true;
