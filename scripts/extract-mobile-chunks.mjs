/**
 * One-off codegen: extract static GLB model placements from the real editor scene
 * (`assets/default.genesys-scene`) and emit `src/actors/mobile-scene-chunks.ts`.
 *
 * Mobile boots into a tiny empty scene to dodge the boot-time memory spike, then
 * this data drives MobileSceneChunkLoaderActor to stream the environment back in
 * at the real world coordinates (no offset — the combat town is authored around
 * the origin and the bedroom diorama sits at ~(188,-51)).
 *
 * Run: node scripts/extract-mobile-chunks.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCENE_PATH = path.join(ROOT, 'assets', 'default.genesys-scene');
const OUT_PATH = path.join(ROOT, 'src', 'actors', 'mobile-scene-chunks.ts');

/** modelUrl substrings that are spawned/managed at runtime — never load statically. */
const RUNTIME_URL_EXCLUDES = [
  'newzombie2',
  'weapon.glb',
  'soul.glb',
  'vomitball',
  'fistofannoyance',
  'thepostman2',
  'demonletter',
  'demonbox',
  'innocent',
  'grave.glb', // runtime DeadGraveActor manages these
  'bigundead', // runtime BigUndeadActor
  'oozebound', // BigUndead mesh folder
];

/** Bedroom diorama actors (loaded first for the intro). */
const BEDROOM_NAMES = new Set(['grimsroom', 'grimstatic']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function readVec(node, fallback) {
  if (node && Array.isArray(node._) && node._.length >= 3) {
    return [num(node._[0]), num(node._[1]), num(node._[2])];
  }
  return fallback;
}

function isExcludedUrl(url) {
  const u = url.toLowerCase();
  return RUNTIME_URL_EXCLUDES.some((s) => u.includes(s));
}

const raw = fs.readFileSync(SCENE_PATH, 'utf8');
const scene = JSON.parse(raw);
const actors = scene?.$root?.actors ?? {};

const placements = [];
const groundTiles = [];
for (const key of Object.keys(actors)) {
  if (key.startsWith('$')) continue;
  const actor = actors[key];
  if (!actor || typeof actor !== 'object') continue;
  const root = actor.rootComponent;
  if (!root || typeof root !== 'object') continue;

  // Ground tiles: MeshComponent primitives (default unit-box geometry) painted with a
  // .material.json (Grass/Road/Intersection). These form the town floor and were
  // previously skipped because they have no GLB modelUrl.
  const tileMaterial = typeof root.material === 'string' ? root.material : null;
  if (root.$bc === 'ENGINE.MeshComponent' && tileMaterial && tileMaterial.endsWith('.material.json')) {
    groundTiles.push({
      material: tileMaterial,
      position: readVec(root.position, [0, 0, 0]),
      scale: readVec(root.scale, [1, 1, 1]),
      rotation: readVec(root.rotation, [0, 0, 0]),
    });
    continue;
  }

  const modelUrl = root.modelUrl ?? actor?.$initOptions?.modelUrl;
  if (typeof modelUrl !== 'string' || !modelUrl) continue;

  const name = typeof actor.name === 'string' ? actor.name : key;
  const nameLower = name.toLowerCase();
  const isBedroom = BEDROOM_NAMES.has(nameLower);

  // Grim2.glb is also the player pawn model — only keep the intro `grimstatic`.
  if (modelUrl.toLowerCase().includes('grim2.glb') && nameLower !== 'grimstatic') continue;
  if (!isBedroom && isExcludedUrl(modelUrl)) continue;

  placements.push({
    name,
    modelUrl,
    material: typeof root.modelMaterial === 'string' ? root.modelMaterial : null,
    position: readVec(root.position, [0, 0, 0]),
    scale: readVec(root.scale, [1, 1, 1]),
    rotation: readVec(root.rotation, [0, 0, 0]),
    castShadow: root.castShadow === true,
    isBedroom,
  });
}

const bedroom = placements.filter((p) => p.isBedroom);
const env = placements.filter((p) => !p.isBedroom);

// Load nearest-to-origin first (player spawns at origin → town center first, then outskirts).
env.sort((a, b) => {
  const da = a.position[0] ** 2 + a.position[2] ** 2;
  const db = b.position[0] ** 2 + b.position[2] ** 2;
  return da - db;
});

const CHUNK_SIZE = 6;
const envChunks = [];
for (let i = 0; i < env.length; i += CHUNK_SIZE) {
  envChunks.push(env.slice(i, i + CHUNK_SIZE));
}

const f = (n) => {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? '0' : String(r);
};
const vec3 = (v) => `new THREE.Vector3(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;
const euler = (v) => `new THREE.Euler(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;

function emit(p) {
  const lines = [
    `  {`,
    `    name: ${JSON.stringify(p.name)},`,
    `    modelUrl: ${JSON.stringify(p.modelUrl)} as ENGINE.ModelPath,`,
    `    position: ${vec3(p.position)},`,
  ];
  if (p.scale[0] !== 1 || p.scale[1] !== 1 || p.scale[2] !== 1) {
    lines.push(`    scale: ${vec3(p.scale)},`);
  }
  if (p.rotation[0] !== 0 || p.rotation[1] !== 0 || p.rotation[2] !== 0) {
    lines.push(`    rotation: ${euler(p.rotation)},`);
  }
  if (p.material) lines.push(`    material: ${JSON.stringify(p.material)},`);
  if (p.castShadow) lines.push(`    castShadow: true,`);
  lines.push(`  },`);
  return lines.join('\n');
}

function emitTile(t, index) {
  const lines = [
    `  {`,
    `    name: ${JSON.stringify(`MobileGroundTile_${index}`)},`,
    `    material: ${JSON.stringify(t.material)},`,
    `    position: ${vec3(t.position)},`,
  ];
  if (t.scale[0] !== 1 || t.scale[1] !== 1 || t.scale[2] !== 1) {
    lines.push(`    scale: ${vec3(t.scale)},`);
  }
  if (t.rotation[0] !== 0 || t.rotation[1] !== 0 || t.rotation[2] !== 0) {
    lines.push(`    rotation: ${euler(t.rotation)},`);
  }
  lines.push(`  },`);
  return lines.join('\n');
}

const header = `// AUTO-GENERATED by scripts/extract-mobile-chunks.mjs — do not edit by hand.
// Static GLB placements pulled from assets/default.genesys-scene at real world
// coordinates. Consumed by MobileSceneChunkLoaderActor to stream the environment
// in on mobile after the boot-time memory spike is avoided.
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

export type GlbPlacement = {
  name: string;
  modelUrl: ENGINE.ModelPath;
  position: THREE.Vector3;
  scale?: THREE.Vector3;
  rotation?: THREE.Euler;
  material?: string;
  castShadow?: boolean;
};

export type GroundTilePlacement = {
  name: string;
  material: string;
  position: THREE.Vector3;
  scale?: THREE.Vector3;
  rotation?: THREE.Euler;
};
`;

let body = `\n/** Bedroom diorama — loaded first so the intro camera has something to frame. */\n`;
body += `export const BEDROOM_CHUNK: readonly GlbPlacement[] = [\n`;
body += bedroom.map(emit).join('\n');
body += `\n];\n`;

body += `\n/** Town environment, ordered nearest-to-origin first. */\n`;
body += `export const ENVIRONMENT_CHUNKS: readonly (readonly GlbPlacement[])[] = [\n`;
for (const chunk of envChunks) {
  body += `  [\n`;
  body += chunk.map((p) => emit(p).split('\n').map((l) => `  ${l}`).join('\n')).join('\n');
  body += `\n  ],\n`;
}
body += `];\n`;

body += `\n/** Town ground tiles (grass/road/intersection) — unit-box MeshComponents, floor first. */\n`;
body += `export const GROUND_TILES: readonly GroundTilePlacement[] = [\n`;
body += groundTiles.map((t, i) => emitTile(t, i)).join('\n');
body += `\n];\n`;

fs.writeFileSync(OUT_PATH, header + body, 'utf8');

console.log(`Bedroom placements: ${bedroom.length}`);
console.log(bedroom.map((p) => `  - ${p.name} (${p.modelUrl}) @ ${p.position.join(',')}`).join('\n'));
console.log(`Environment placements: ${env.length} in ${envChunks.length} chunks`);
const byModel = {};
for (const p of env) {
  const m = p.modelUrl.split('/').pop();
  byModel[m] = (byModel[m] ?? 0) + 1;
}
console.log('By model:');
for (const [m, c] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.toString().padStart(3)}  ${m}`);
}
console.log(`Ground tiles: ${groundTiles.length}`);
const byTileMat = {};
for (const t of groundTiles) {
  const m = t.material.split('/').pop();
  byTileMat[m] = (byTileMat[m] ?? 0) + 1;
}
for (const [m, c] of Object.entries(byTileMat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.toString().padStart(3)}  ${m}`);
}
console.log(`\nWrote ${path.relative(ROOT, OUT_PATH)}`);
