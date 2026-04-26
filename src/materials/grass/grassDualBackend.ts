import { GenesysGrassSwayNodeMaterial } from './GenesysGrassSwayNodeMaterial.js';
import { GrassSwayShaderMaterial } from './GrassSwayShaderMaterial.js';

const webGpuGrassBySource = new WeakMap<GrassSwayShaderMaterial, GenesysGrassSwayNodeMaterial>();

export function getOrCreateWebGpuGrassFromSource(source: GrassSwayShaderMaterial): GenesysGrassSwayNodeMaterial {
  let derived = webGpuGrassBySource.get(source);
  if (!derived) {
    derived = new GenesysGrassSwayNodeMaterial(source);
    derived.name = `${source.name}(WebGPU)`;
    webGpuGrassBySource.set(source, derived);
  }
  return derived;
}

export { GrassSwayShaderMaterial };
export { GrassUniformManager } from './GrassUniformManager.js';

