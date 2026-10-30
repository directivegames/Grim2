/**
 * Export the game's code-built models to GLB files the editor shows and other tools open.
 *
 * Usage (from the game project root, the folder with package.json):
 *   pnpm exec tsx <skills-root>/genesys-code-modeling/scripts/export-glb.ts [--only bear,hero] [--dry] [--repack] [--help]
 * Needs tsx, @gltf-transform/core, @gltf-transform/functions and sharp: the SDK's devDependencies ship them.
 * Exit codes: 0 exported (WARN lines may remain — report them), 1 a FAIL, 2 usage or setup error.
 *
 * Input: tools/models/index.ts in the project. It exports
 *   MODELS: Array<{ file: string; build: () => THREE.Object3D }>   one GLB per entry, root object named 'rig'
 *   TOON_BANDS?: number[]                                         toon ramp values, dark → lit (default [90, 170, 255])
 * Builders mark each mesh's look by its material name: 'toon', 'flat', 'soft', 'glow' or 'ink'
 * (tools/models/looks.ts). An ink hull (BackSide) takes its model's main look, with its winding flipped
 * so that front-side material draws it as the outline.
 *
 * Output (written only when the bytes change; nothing is ever deleted):
 *   assets/models/<file>.glb                one per MODELS entry
 *   assets/textures/T_Palette.png           one swatch per colour the models use
 *   assets/textures/T_ToonRamp.png          when a model uses 'toon'
 *   assets/materials/M_<Look>.material.json one per look the models use
 *   tools/models/palette.json               the swatch of every colour; keeps swatches in place between runs
 * Colours become palette swatches: every vertex's UV points at its swatch centre, one colour per
 * triangle (a UV cannot blend between swatches). Each GLB material carries the engine's
 * GENESYS_material_overrides extension, so the engine swaps in M_<Look> on load. The GLB also embeds
 * the palette, so viewers and Blender show the right colours.
 *
 * The code is the source of truth: every listed GLB is overwritten on each run. A GLB edited by hand
 * keeps its edits only once its entry leaves MODELS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Document, NodeIO, TextureInfo } from '@gltf-transform/core';
import type { Material, Node as GNode, Texture } from '@gltf-transform/core';
import { prune, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import * as THREE from 'three';

type ModelSpec = { file: string; build: () => THREE.Object3D };
type Look = 'toon' | 'flat' | 'soft' | 'glow';
type Role = Look | 'ink';

const args = process.argv.slice(2);
const flag = (name: string): string | true | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
if (args.includes('--help')) {
  console.log('usage: pnpm exec tsx <skills-root>/genesys-code-modeling/scripts/export-glb.ts [--only a,b] [--dry] [--repack]  (run from the project root; reads tools/models/index.ts)');
  process.exit(0);
}
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
  console.log('FAIL run from the game project root (the folder with package.json)');
  process.exit(2);
}
const indexFile = path.join(ROOT, 'tools/models/index.ts');
if (!fs.existsSync(indexFile)) {
  console.log('FAIL tools/models/index.ts not found — it exports MODELS (genesys-code-modeling → Build)');
  process.exit(2);
}
const dry = flag('dry') === true;
const only = typeof flag('only') === 'string' ? new Set(String(flag('only')).split(',')) : null;

const index = await import(pathToFileURL(indexFile).href) as { MODELS?: ModelSpec[]; TOON_BANDS?: number[] };
if (!Array.isArray(index.MODELS) || !index.MODELS.length) {
  console.log('FAIL tools/models/index.ts exports no MODELS');
  process.exit(2);
}
const BANDS = index.TOON_BANDS ?? [90, 170, 255];
const CELL = 8; // swatch size in px: KTX2 4×4 blocks stay single-coloured

const PATHS = {
  palette: '@project/assets/textures/T_Palette.png',
  ramp: '@project/assets/textures/T_ToonRamp.png',
  material: (look: Look) => `@project/assets/materials/M_${look[0].toUpperCase()}${look.slice(1)}.material.json`,
};
const toFile = (logical: string) => path.join(ROOT, logical.slice('@project/'.length));

// ------------------------------------------------------------------ build and collect colours
const _c = new THREE.Color();
const _v = new THREE.Vector3();
const roleOf = (m: THREE.Mesh): Role => {
  const name = (m.material as THREE.Material).name;
  if ((m.material as THREE.Material).side === THREE.BackSide) return 'ink';
  return name === 'flat' || name === 'soft' || name === 'glow' ? name : 'toon';
};

/** Non-indexed copy with unit normals; ink hulls turned inside out; 'flat' gets one normal per face. */
function prepared(m: THREE.Mesh): THREE.BufferGeometry {
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  if (roleOf(m) === 'flat' || !g.getAttribute('normal')) g.computeVertexNormals();
  if ((m.material as THREE.Material).side === THREE.BackSide) {
    for (const name of ['position', 'normal', 'color']) {
      const a = g.getAttribute(name);
      if (!a) continue;
      const arr = a.array as Float32Array;
      const k = a.itemSize;
      for (let t = 0; t < a.count; t += 3) {
        for (let j = 0; j < k; j++) {
          const tmp = arr[(t + 1) * k + j];
          arr[(t + 1) * k + j] = arr[(t + 2) * k + j];
          arr[(t + 2) * k + j] = tmp;
        }
      }
    }
    const nrm = g.getAttribute('normal').array as Float32Array;
    for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i];
  }
  const n = g.getAttribute('normal') as THREE.BufferAttribute; // glTF needs unit normals
  for (let i = 0; i < n.count; i++) {
    _v.fromBufferAttribute(n, i);
    if (_v.lengthSq() < 1e-12) _v.set(0, 1, 0);
    _v.normalize();
    n.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return g;
}

/** sRGB hex per vertex, one colour per triangle: the corner colour closest to the triangle's average. */
function vertexHexes(m: THREE.Mesh, g: THREE.BufferGeometry): number[] {
  const mat = m.material as THREE.MeshBasicMaterial;
  const col = g.getAttribute('color');
  const n = g.getAttribute('position').count;
  if (!(mat.vertexColors && col)) return new Array<number>(n).fill(mat.color.getHex());
  const out: number[] = [];
  const corners = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
  const avg = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    avg.setRGB(0, 0, 0);
    corners.forEach((c, k) => { c.setRGB(col.getX(t + k), col.getY(t + k), col.getZ(t + k)); avg.add(c); });
    avg.multiplyScalar(1 / 3);
    const dist = (c: THREE.Color) => (c.r - avg.r) ** 2 + (c.g - avg.g) ** 2 + (c.b - avg.b) ** 2;
    const pick = corners.reduce((a, b) => (dist(b) < dist(a) ? b : a)).getHex();
    out.push(pick, pick, pick);
  }
  return out;
}

const models = index.MODELS.map((s) => ({ file: s.file, root: s.build() }));
for (const name of only ?? []) {
  if (!models.some((m) => m.file === name)) { console.log(`FAIL --only ${name}: no MODELS entry has that file name`); process.exit(1); }
}
// Stable swatches: tools/models/palette.json keeps each colour in its swatch between runs, so a model
// list in another order, a hand-edited GLB or a texture the editor holds in memory never points at the
// wrong colour. A new colour takes the first free swatch; --repack lays the palette out from scratch.
// Without palette.json, an existing T_Palette.png seeds the swatches.
const PALETTE_FILE = path.join(ROOT, 'tools/models/palette.json');
type PaletteFile = { grid: number; colours: string[] }; // colours[i] = '#rrggbb' in swatch i, '' when free
let saved: PaletteFile = { grid: 0, colours: [] };
if (flag('repack') !== true) {
  if (fs.existsSync(PALETTE_FILE)) {
    saved = JSON.parse(fs.readFileSync(PALETTE_FILE, 'utf8')) as PaletteFile;
  } else if (fs.existsSync(toFile(PATHS.palette))) {
    const { data, info } = await sharp(fs.readFileSync(toFile(PATHS.palette))).raw().toBuffer({ resolveWithObject: true });
    const grid = Math.round(info.width / CELL);
    saved.grid = grid;
    for (let i = 0; i < (grid * grid) / 2; i++) {
      const at = ((Math.floor(i / grid) * CELL + CELL / 2) * info.width + (i % grid) * CELL + CELL / 2) * info.channels;
      const hex = (data[at] << 16) | (data[at + 1] << 8) | data[at + 2];
      saved.colours.push(`#${hex.toString(16).padStart(6, '0')}`);
    }
    // Swatches fill from the start, so black after the last other colour is free; black before it is #000000.
    let last = saved.colours.length - 1;
    while (last >= 0 && saved.colours[last] === '#000000') saved.colours[last--] = '';
  }
}
const palette = new Map<number, number>();
saved.colours.forEach((c, i) => { if (c) palette.set(parseInt(c.slice(1), 16), i); });
const taken = new Set(palette.values());
let nextFree = 0;
const addColour = (hex: number): void => {
  if (palette.has(hex)) return;
  while (taken.has(nextFree)) nextFree++;
  palette.set(hex, nextFree);
  taken.add(nextFree);
};
const looks = new Set<Look>();
const meshData = new Map<THREE.Mesh, { g: THREE.BufferGeometry; hex: number[]; look: Look }>();
for (const { file, root } of models) {
  if (root.name !== 'rig') console.log(`WARN ${file}: root object is "${root.name}", not "rig" (the runtime finds it by name)`);
  const names = new Set<string>();
  let main: Look | null = null; // the model's main look: ink hulls take it
  root.traverse((o) => { if (!main && o instanceof THREE.Mesh) { const r = roleOf(o); if (r !== 'ink' && r !== 'glow') main = r; } });
  root.traverse((o) => {
    if (o.name && names.has(o.name)) console.log(`WARN ${file}: two objects named "${o.name}" — the loader renames one, so part() may miss it`);
    names.add(o.name);
    if (!(o instanceof THREE.Mesh)) return;
    const g = prepared(o);
    const hex = vertexHexes(o, g);
    for (const h of hex) addColour(h);
    const role = roleOf(o);
    const look: Look = role === 'ink' ? (main ?? 'toon') : role;
    looks.add(look);
    meshData.set(o, { g, hex, look });
  });
}

// N×N swatches; the bottom half mirrors the top, so the palette reads the same whether a loader flips V or not.
let N = Math.max(16, saved.grid); // 16×16 holds 128 colours: most games never grow it
const highest = Math.max(...palette.values());
while ((N * N) / 2 <= highest) N *= 2;
const grew = saved.grid > 0 && N !== saved.grid;
if (grew) console.log(`WARN palette grid grew from ${saved.grid} to ${N}: every swatch moved, so every GLB in MODELS is exported again (--only ignored); GLBs no longer in MODELS keep the old swatches`);
const size = N * CELL;
const pixels = Buffer.alloc(size * size * 3);
for (const [hex, i] of palette) {
  const cx = i % N;
  const cy = Math.floor(i / N);
  for (const row of [cy, N - 1 - cy]) {
    for (let y = row * CELL; y < (row + 1) * CELL; y++) {
      for (let x = cx * CELL; x < (cx + 1) * CELL; x++) pixels.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255], (y * size + x) * 3);
    }
  }
}
const uvOf = (hex: number): [number, number] => {
  const i = palette.get(hex)!;
  return [((i % N) + 0.5) / N, (Math.floor(i / N) + 0.5) / N];
};

// ------------------------------------------------------------------ GLB
const OVERRIDE_EXT = 'GENESYS_material_overrides';

function toGltf(doc: Document, o: THREE.Object3D, mats: Record<Look, Material>): GNode {
  const node = doc.createNode(o.name)
    .setTranslation(o.position.toArray() as [number, number, number])
    .setRotation(o.quaternion.toArray() as [number, number, number, number])
    .setScale(o.scale.toArray() as [number, number, number]);
  const data = o instanceof THREE.Mesh ? meshData.get(o) : undefined;
  if (data) {
    const uv = new Float32Array(data.hex.length * 2);
    data.hex.forEach((h, i) => uv.set(uvOf(h), i * 2));
    const buf = doc.getRoot().listBuffers()[0];
    const acc = (type: 'VEC2' | 'VEC3', arr: Float32Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', Float32Array.from(data.g.getAttribute('position').array as ArrayLike<number>)))
      .setAttribute('NORMAL', acc('VEC3', Float32Array.from(data.g.getAttribute('normal').array as ArrayLike<number>)))
      .setAttribute('TEXCOORD_0', acc('VEC2', uv))
      .setMaterial(mats[data.look]);
    node.setMesh(doc.createMesh(o.name).addPrimitive(prim));
  }
  for (const child of o.children) node.addChild(toGltf(doc, child, mats));
  return node;
}

/** Add the material-override extension (by material name M_<Look>) to the GLB's JSON chunk. */
function withOverrides(glb: Uint8Array): Buffer {
  const view = Buffer.from(glb);
  const jsonLen = view.readUInt32LE(12);
  const json = JSON.parse(view.subarray(20, 20 + jsonLen).toString('utf8').trimEnd());
  const bin = view.subarray(20 + jsonLen);
  for (const m of json.materials ?? []) {
    const look = String(m.name).replace(/^M_/, '').toLowerCase() as Look;
    m.extensions = { ...(m.extensions ?? {}), [OVERRIDE_EXT]: { materialOverride: PATHS.material(look) } };
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), OVERRIDE_EXT])];
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + bin.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  return Buffer.concat([header, text, bin]);
}

// ------------------------------------------------------------------ write
const report: string[] = [];
const out = (logical: string, data: Buffer | string): void => {
  const file = toFile(logical);
  const same = fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), Buffer.from(data)) === 0;
  if (!same && !dry) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  }
  report.push(`${same ? 'same ' : dry ? 'would' : 'wrote'} ${logical}`);
};
const lin = (hex: number) => { _c.setHex(hex); return { $bc: 'c', _: [_c.r, _c.g, _c.b] }; };
const materialJson = (root: Record<string, unknown>) => JSON.stringify({ $root: root, $version: 2 }, null, 2) + '\n';

const palettePng = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
out(PATHS.palette, palettePng);
{
  const colours = new Array<string>((N * N) / 2).fill('');
  for (const [hex, i] of palette) colours[i] = `#${hex.toString(16).padStart(6, '0')}`;
  const text = JSON.stringify({ grid: N, colours } satisfies PaletteFile, null, 1) + '\n';
  const same = fs.existsSync(PALETTE_FILE) && fs.readFileSync(PALETTE_FILE, 'utf8') === text;
  if (!same && !dry) fs.writeFileSync(PALETTE_FILE, text);
  report.push(`${same ? 'same ' : dry ? 'would' : 'wrote'} tools/models/palette.json`);
}
if (looks.has('toon')) {
  const ramp = Buffer.alloc(256 * 3);
  for (let x = 0; x < 256; x++) ramp.fill(BANDS[Math.min(Math.floor((x / 256) * BANDS.length), BANDS.length - 1)], x * 3, x * 3 + 3);
  out(PATHS.ramp, await sharp(ramp, { raw: { width: 256, height: 1, channels: 3 } }).png().toBuffer());
  out(PATHS.material('toon'), materialJson({ $bc: 'ENGINE.MeshToonNodeMaterialAsset', color: lin(0xffffff), mapPath: PATHS.palette, gradientMapPath: PATHS.ramp }));
}
if (looks.has('flat')) out(PATHS.material('flat'), materialJson({ $bc: 'ENGINE.MeshStandardNodeMaterialAsset', color: lin(0xffffff), mapPath: PATHS.palette, roughness: 0.85, metalness: 0, flatShading: true }));
if (looks.has('soft')) out(PATHS.material('soft'), materialJson({ $bc: 'ENGINE.MeshStandardNodeMaterialAsset', color: lin(0xffffff), mapPath: PATHS.palette, roughness: 0.6, metalness: 0 }));
if (looks.has('glow')) {
  out(PATHS.material('glow'), materialJson({
    $bc: 'ENGINE.MeshStandardNodeMaterialAsset', color: lin(0x111111), emissive: lin(0xffffff), emissiveMapPath: PATHS.palette, emissiveIntensity: 2.5, roughness: 0.6, metalness: 0,
  }));
}

const io = new NodeIO();
for (const { file, root } of models) {
  if (only && !grew && !only.has(file)) continue;
  const doc = new Document();
  doc.createBuffer();
  const tex: Texture = doc.createTexture('T_Palette').setImage(new Uint8Array(palettePng)).setMimeType('image/png');
  const nearest = (m: Material, slot: 'base' | 'emissive') => {
    const info = slot === 'base' ? m.getBaseColorTextureInfo() : m.getEmissiveTextureInfo();
    info?.setMagFilter(TextureInfo.MagFilter.NEAREST).setMinFilter(TextureInfo.MinFilter.NEAREST);
    return m;
  };
  const base = (look: Look, roughness: number) => nearest(doc.createMaterial(`M_${look[0].toUpperCase()}${look.slice(1)}`)
    .setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(roughness), 'base');
  const mats: Record<Look, Material> = {
    toon: base('toon', 1),
    flat: base('flat', 0.85),
    soft: base('soft', 0.6),
    glow: nearest(doc.createMaterial('M_Glow').setBaseColorFactor([0.01, 0.01, 0.01, 1]).setEmissiveTexture(tex).setEmissiveFactor([1, 1, 1]), 'emissive'),
  };
  doc.getRoot().setDefaultScene(doc.createScene(file).addChild(toGltf(doc, root, mats)));
  await doc.transform(prune({ keepLeaves: true }), weld()); // keepLeaves: empty pivots (sockets) stay // prune: unused looks; weld: shared vertices → indexed, about 4× smaller
  out(`@project/assets/models/${file}.glb`, withOverrides(await io.writeBinary(doc)));
}

console.log(report.join('\n'));
const inUse = new Set([...meshData.values()].flatMap((d) => d.hex));
const unused = [...palette.keys()].filter((h) => !inUse.has(h)).length;
console.log(`ok EXPORT ${only && !grew ? only.size : models.length} models, ${looks.size} looks, palette ${palette.size} colours (${unused} no longer used) in ${N}×${N} swatches (${size}px)${dry ? ' (dry run)' : ''}`);
