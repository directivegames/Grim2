import { resolve } from 'path';
import { NodeIO } from '@gltf-transform/core';

const path = resolve(process.argv[2] ?? 'assets/models/Vomitball.glb');
const io = new NodeIO();
const doc = await io.read(path);
const root = doc.getRoot();

console.log('File:', path);
console.log('Animations:', root.listAnimations().map(a => a.getName()));
console.log('Cameras:', root.listCameras().map(c => c.getName()));
console.log('Scenes:', root.listScenes().length);

for (const scene of root.listScenes()) {
  const walk = (node: ReturnType<typeof root.listNodes>[0], depth: number): void => {
    const pad = '  '.repeat(depth);
    const mesh = node.getMesh();
    const cam = node.getCamera();
    const extras = [mesh ? 'mesh' : '', cam ? 'camera' : ''].filter(Boolean).join(',');
    console.log(`${pad}${node.getName() ?? '(unnamed)'}${extras ? ` (${extras})` : ''}`);
    for (const c of node.listChildren()) walk(c, depth + 1);
  };
  for (const n of scene.listChildren()) walk(n, 0);
}
