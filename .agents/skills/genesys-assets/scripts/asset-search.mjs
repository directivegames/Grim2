#!/usr/bin/env node
// Search every model, texture, sound, prefab and material the game can use without
// generating anything: the engine (@engine/assets), the project (@project/assets) and
// installed packs (@project/packs/<id>/assets). Run from the game project root.
//
//   node asset-search.mjs <words…> [--type model|texture|audio|prefab|material|font|svg] [--limit 20]
//   node asset-search.mjs --type model --all          # every model, grouped by folder
//
// Models print their real size in metres (node transforms applied; skinned models in their rest
// pose), triangles, clip names, and for skinned models whether the rig uses the mannequin's
// mixamorig bones (then the engine's Idle/Walk/Run/Jump clips play on it). Paths print ready to paste.
// Exit code 1 when nothing matches.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const type = opt('type', null);
const limit = Number(opt('limit', 20));
const all = flag('all');
const words = args.map((w) => w.toLowerCase());

const KINDS = {
  model: ['.glb', '.gltf'],
  texture: ['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.hdr', '.exr', '.texture.json'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
  prefab: ['.prefab.json'],
  material: ['.material.json'],
  font: ['.ttf', '.otf', '.woff', '.woff2'],
  svg: ['.svg'],
};
const kindOf = (f) => {
  const l = f.toLowerCase();
  for (const [k, exts] of Object.entries(KINDS)) if (exts.some((e) => l.endsWith(e))) return k;
  return null;
};

// mesh-classifier writes <Name>.md (a card), <Name>.detail.md and <Name>.jpg (a render) next to a GLB.
const cardOf = (glb) => {
  const md = glb.replace(/\.glb$/i, '.md');
  if (!fs.existsSync(md)) return null;
  const head = fs.readFileSync(md, 'utf8').slice(0, 2000);
  if (!/^classifier: mesh-classifier/m.test(head)) return null;
  const field = (k) => head.match(new RegExp(`^${k}: "?([^"#\\n]*?)"?\\s*(#.*)?$`, 'm'))?.[1];
  return { md, summary: field('summary'), pending: field('interpretation') !== 'done' };
};
const isClassifierRender = (f) => /\.jpg$/i.test(f) && !!cardOf(f.replace(/\.jpg$/i, '.glb'));
// The nearest ASSETS.md index above a classified GLB, up to the folder that holds its assets/ (a pack's root).
const indexOf = (glb, base) => {
  const stop = path.dirname(base);
  for (let d = path.dirname(glb); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'ASSETS.md'))) return path.join(d, 'ASSETS.md');
    if (d === stop || d === path.dirname(d)) return null;
  }
};

// Words that should find each other. Keep short; the path tokens do most of the work.
const SYNONYMS = {
  rock: ['stone', 'boulder', 'cliff'], stone: ['rock', 'brick'], tree: ['pine', 'palm', 'coconut', 'oak', 'birch'],
  bush: ['shrub', 'foliage', 'grass'], plant: ['foliage', 'flower', 'grass', 'bush'], wall: ['brick', 'fence'],
  floor: ['ground', 'tile'], pillar: ['column'], column: ['pillar'], door: ['gate', 'arch'], arch: ['door', 'gate'],
  character: ['skm', 'adventurer', 'dude', 'knight'], hero: ['adventurer', 'knight', 'character'],
  enemy: ['spider', 'arachnid', 'skeleton', 'monster'], monster: ['spider', 'arachnid'], gun: ['shotgun', 'weapon'],
  weapon: ['shotgun', 'gun', 'sword'], health: ['pickup', 'heal'], coin: ['pickup', 'gold'], cloud: ['clouds'],
  sky: ['skybox', 'hdr'], pot: ['claypot', 'vase'], statue: ['aztecstatue'], landscape: ['terrain'],
  terrain: ['landscape', 'ground'], music: ['bgm', 'loop'], ship: ['wreck', 'boat'], bridge: ['hanging'],
};

const tokenize = (p) =>
  p.replace(/\.(prefab|material|texture)\.json$/i, '').replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sources = [];
const engineDir = path.join(root, 'node_modules', '@gnsx', 'genesys.js');
sources.push({ base: path.join(engineDir, 'assets'), logical: (f) => '@engine/' + path.relative(engineDir, f) });
sources.push({ base: path.join(root, 'assets'), logical: (f) => '@project/' + path.relative(root, f) });
for (const pack of fs.existsSync(path.join(root, 'packs')) ? fs.readdirSync(path.join(root, 'packs')) : []) {
  sources.push({ base: path.join(root, 'packs', pack, 'assets'), logical: (f) => '@project/' + path.relative(root, f) });
}

const items = [];
for (const s of sources) {
  for (const f of walk(s.base)) {
    const kind = kindOf(f);
    if (!kind || (type && kind !== type)) continue;
    if (kind === 'texture' && isClassifierRender(f)) continue;
    const logical = s.logical(f).split(path.sep).join('/');
    items.push({ file: f, base: s.base, logical, kind, tokens:tokenize(logical.replace(/^@(engine|project)\//, '')) });
  }
}

// Rank by how many query words match (any word may miss), then by match quality.
function score(it) {
  if (!words.length) return 1;
  let matched = 0;
  let quality = 0;
  for (const w of words) {
    const alts = SYNONYMS[w] || [];
    if (it.tokens.some((t) => t === w)) { matched++; quality += 3; }
    else if (it.tokens.some((t) => t.startsWith(w) || (w.startsWith(t) && t.length > 3))) { matched++; quality += 2; }
    else if (it.tokens.some((t) => alts.includes(t))) { matched++; quality += 1; }
  }
  return matched ? matched * 100 + quality : 0;
}

// ---------------------------------------------------------------- GLB facts
const COMP = { 5120: [1, 127], 5121: [1, 255], 5122: [2, 32767], 5123: [2, 65535], 5125: [4, 0], 5126: [4, 0] };
function mat4(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

// Meshopt-compressed buffer views (engine GLBs) need the decoder from the project's node_modules.
let meshopt = null;
try {
  const req = createRequire(path.join(root, 'package.json'));
  meshopt = req('meshoptimizer').MeshoptDecoder;
  await meshopt.ready;
} catch { meshopt = null; }

// The joint names the engine's clips animate (from the mannequin), to tell whether a rig is compatible.
let mannequinBones = null;
function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'glTF') return null;
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.toString('utf8', 20, 20 + len));
  let bin = null;
  const o = 20 + len;
  if (o + 8 <= b.length && b.readUInt32LE(o + 4) === 0x004e4942) bin = b.subarray(o + 8, o + 8 + b.readUInt32LE(o));
  return { j, bin };
}
function viewBytes(j, bin, vi) {
  const bv = j.bufferViews[vi];
  const ext = bv.extensions?.EXT_meshopt_compression;
  if (ext) {
    if (!meshopt || !bin) return null;
    const out = new Uint8Array(ext.count * ext.byteStride);
    const src = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength);
    meshopt.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter || 'NONE');
    return out;
  }
  if (!bin) return null;
  return new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
}
function inverseBind(j, bin, skin) {
  const acc = j.accessors[skin.inverseBindMatrices];
  if (!acc || acc.componentType !== 5126) return null;
  const bytes = viewBytes(j, bin, acc.bufferView);
  if (!bytes) return null;
  const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset + (acc.byteOffset || 0), bytes.byteOffset + (acc.byteOffset || 0) + 64));
  return Array.from(f);
}

function glbFacts(file) {
  try {
    const g = readGlb(file);
    if (!g) return null;
    const { j, bin } = g;
    const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const world = new Array(j.nodes.length).fill(null);
    const setWorld = (ni, parentM) => {
      world[ni] = mul(parentM, mat4(j.nodes[ni]));
      for (const c of j.nodes[ni].children || []) setWorld(c, world[ni]);
    };
    const scene = j.scenes?.[j.scene ?? 0];
    for (const ni of scene?.nodes || []) setWorld(ni, I);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    let restMeasured = true;
    j.nodes.forEach((n, ni) => {
      if (n.mesh === undefined || !world[ni]) return;
      // Skinned meshes render through their joints: at rest, vertex × (jointWorld × inverseBind).
      // gltfpack bakes position dequantization into the inverse bind matrices, so this is also
      // what makes quantized engine characters measure in metres.
      let m = world[ni];
      if (n.skin !== undefined) {
        const skin = j.skins[n.skin];
        const ibm = inverseBind(j, bin, skin);
        const jw = world[skin.joints[0]];
        if (ibm && jw) m = mul(jw, ibm);
        else { m = I; restMeasured = false; }
      }
      for (const p of j.meshes[n.mesh].primitives) {
        const acc = j.accessors[p.attributes.POSITION];
        if (!acc || !acc.min) continue;
        let [mn, mx] = [acc.min, acc.max];
        if (acc.normalized && COMP[acc.componentType]?.[1]) {
          const d = COMP[acc.componentType][1];
          mn = mn.map((v) => Math.max(v / d, -1));
          mx = mx.map((v) => v / d);
        }
        for (let i = 0; i < 8; i++) {
          const c = apply(m, [i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]]);
          for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], c[k]); hi[k] = Math.max(hi[k], c[k]); }
        }
        const count = p.indices !== undefined ? j.accessors[p.indices].count : acc.count;
        tris += Math.floor(count / 3);
      }
    });
    const skinned = (j.skins || []).length > 0;
    let rig = null;
    if (skinned) {
      if (!mannequinBones) {
        const mq = readGlb(path.join(root, 'node_modules', '@gnsx', 'genesys.js', 'assets', 'character', 'mannequinG.glb'));
        mannequinBones = mq ? new Set(mq.j.skins[0].joints.map((i) => mq.j.nodes[i].name)) : new Set();
      }
      const names = new Set(j.skins.flatMap((s) => s.joints.map((i) => j.nodes[i].name)));
      const shared = [...mannequinBones].filter((b) => names.has(b)).length;
      rig = { mixamo: [...names].some((b) => /^mixamorig/.test(b || '')), shared, of: mannequinBones.size };
    }
    const all = (j.animations || []).map((a) => a.name).filter(Boolean);
    const anims = all.filter((a) => !/\|/.test(a) && !/mixamo\.com/i.test(a));
    const size = lo[0] === Infinity ? null : hi.map((v, k) => v - lo[k]);
    return { size, bottom: lo[1], tris, skinned, restMeasured, rig, anims, hiddenClips: all.length - anims.length };
  } catch {
    return null;
  }
}

const fmtSize = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function describe(it) {
  const bytes = fs.statSync(it.file).size;
  let line = `${it.logical}  [${it.kind}, ${fmtSize(bytes)}]`;
  if (it.kind === 'model' && it.file.endsWith('.glb')) {
    const f = glbFacts(it.file);
    if (f?.size && (!f.skinned || f.restMeasured)) {
      const [w, h, d] = f.size.map((v) => v.toFixed(2));
      line += `  ${w}×${h}×${d} m (w×h×d${f.skinned ? ', rest pose' : ''})  ${f.tris} tris`;
      if (Math.abs(f.bottom) > 0.05) line += `  bottom ${f.bottom.toFixed(2)}`;
    } else if (f?.skinned) line += `  ${f.tris} tris (size: open its sheet)`;
    if (f?.skinned) {
      const r = f.rig;
      line += r?.mixamo && r.shared === r.of
        ? '  skinned, mannequin rig (engine clips play)'
        : r?.mixamo ? `  skinned, mixamorig bones ${r.shared}/${r.of} of the mannequin (engine clips play on the shared bones; check with sheet)`
          : '  skinned, own rig (engine clips will not play)';
    }
    if (f?.anims.length) line += `  anims: ${f.anims.slice(0, 8).join(', ')}${f.anims.length > 8 ? ` +${f.anims.length - 8}` : ''}`;
    const card = cardOf(it.file);
    if (card) {
      line += `\n    card: ${path.relative(root, card.md)}${card.pending ? ' (interpretation pending: facts only)' : ''}`;
      if (card.summary) line += `  ${card.summary}`;
    }
  }
  return line;
}

if (!words.length && !all) {
  const counts = {};
  for (const it of items) {
    const top = path.posix.dirname(it.logical);
    counts[top] = (counts[top] || 0) + 1;
  }
  console.log('Asset folders (count). Search with words, e.g. `asset-search.mjs stone wall --type model`:\n');
  for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${v.toString().padStart(4)}  ${k}`);
  process.exit(0);
}

const hits = items.map((it) => ({ it, s: score(it) })).filter((h) => h.s > 0)
  .sort((a, b) => b.s - a.s || a.it.logical.localeCompare(b.it.logical));
if (!hits.length) {
  const q = `"${words.join(' ')}"${type ? ` (${type})` : ''}`;
  console.log(`No match for ${q}. Try a broader word, drop --type, or run with no words to see folders.`);
  if (!type || type === 'model' || type === 'prefab') console.log('No model fits? Build it in Blender: genesys-blender-modeling (blender.sh build blender/<asset>).');
  if (!type || type === 'audio') console.log('No sound fits? Make it with synth.mjs: genesys-audio.');
  if (type === 'texture' || type === 'material') console.log('No surface fits? Use a flat palette material (gkit mat) or an engine material: genesys-assets → Gaps.');
  process.exit(1);
}
const shown = all ? hits : hits.slice(0, limit);
for (const { it } of shown) console.log(describe(it));
if (hits.length > shown.length) console.log(`… ${hits.length - shown.length} more (--limit ${hits.length})`);
const indexes = [...new Set(shown.filter(({ it }) => it.kind === 'model' && cardOf(it.file))
  .map(({ it }) => indexOf(it.file, it.base)).filter(Boolean))];
if (indexes.length) {
  console.log('\nCarded models: read the card before placing (size, pivot, facing, how it sits, Use it rules); its .jpg render next to the GLB is your look.');
  console.log(`Pack-wide rules (scale, facing convention, pivots to fix, recipes) are in Pack notes: ${indexes.map((i) => path.relative(root, i)).join(', ')}`);
}
if (shown.some(({ it }) => it.kind === 'model' && !cardOf(it.file))) {
  const blenderSh = path.relative(root, path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'genesys-blender-modeling', 'scripts', 'blender.sh'));
  console.log(`\nLook before you choose: place the model and take an editor screenshot, or, with Blender installed, ${blenderSh} sheet <path>   (sheet lands in .scratch/blender/sheets/)`);
}
