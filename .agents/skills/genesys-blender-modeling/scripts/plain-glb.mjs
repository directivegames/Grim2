#!/usr/bin/env node
// Make a GLB Blender can import: decode Meshopt, dequantize, transcode KTX2 (Basis)
// and WebP textures to PNG. Engine models ship with all four, and Blender's glTF
// importer refuses KHR_texture_basisu.
//
//   node plain-glb.mjs <in.glb> <out.glb>
//
// Run from the game project root (uses its node_modules: @gltf-transform, meshoptimizer,
// sharp, and three's basis transcoder).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { dequantize } = require('@gltf-transform/functions');
const { MeshoptDecoder } = require('meshoptimizer');
const sharp = require('sharp');

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node plain-glb.mjs <in.glb> <out.glb>');
  process.exit(2);
}

let basisModule = null;
async function basis() {
  if (basisModule) return basisModule;
  const dir = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  const src = fs.readFileSync(path.join(dir, 'basis_transcoder.js'), 'utf8');
  const mod = { exports: {} };
  vm.runInThisContext(`(function (module, exports, require, __dirname, __filename) {${src}\n})`)(
    mod, mod.exports, require, dir, path.join(dir, 'basis_transcoder.js'));
  const BASIS = mod.exports;
  basisModule = await BASIS({ wasmBinary: fs.readFileSync(path.join(dir, 'basis_transcoder.wasm')) });
  basisModule.initializeBasis();
  return basisModule;
}

const RGBA32 = 13; // basis_transcoder cTFRGBA32

async function ktx2ToPng(bytes) {
  const B = await basis();
  const file = new B.KTX2File(new Uint8Array(bytes));
  try {
    if (!file.isValid()) throw new Error('invalid KTX2');
    const width = file.getWidth();
    const height = file.getHeight();
    if (!file.startTranscoding()) throw new Error('startTranscoding failed');
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
    const dst = new Uint8Array(size);
    if (!file.transcodeImage(dst, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error('transcodeImage failed');
    return sharp(Buffer.from(dst), { raw: { width, height, channels: 4 } }).png().toBuffer();
  } finally {
    file.close();
    file.delete();
  }
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);

let converted = 0;
for (const tex of doc.getRoot().listTextures()) {
  const mime = tex.getMimeType();
  const img = tex.getImage();
  if (!img) continue;
  if (mime === 'image/ktx2') {
    tex.setImage(await ktx2ToPng(img)).setMimeType('image/png');
    converted++;
  } else if (mime === 'image/webp') {
    tex.setImage(await sharp(Buffer.from(img)).png().toBuffer()).setMimeType('image/png');
    converted++;
  }
  if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(ktx2|webp)$/i, '.png'));
}
await doc.transform(dequantize());
// Meshopt-decoded accessors lose their (fallback) buffer; give everything one plain buffer.
const buffer = doc.createBuffer('main');
for (const acc of doc.getRoot().listAccessors()) acc.setBuffer(buffer);
for (const old of doc.getRoot().listBuffers()) if (old !== buffer) old.dispose();
for (const ext of doc.getRoot().listExtensionsUsed()) {
  if (['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(ext.extensionName)) {
    ext.dispose();
  }
}
fs.mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, doc);
console.log(`PLAIN ${path.relative(root, output)}  textures→png ${converted}`);
