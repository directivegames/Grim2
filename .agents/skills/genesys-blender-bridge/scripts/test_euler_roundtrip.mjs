#!/usr/bin/env node
// Bridge self-test: rotations and transforms Genesys -> Blender -> Genesys, checked against three.js.
//
//   node <this-skill>/scripts/test_euler_roundtrip.mjs [--project-root <game project>] [--out <dir>] [--blender <path>]
//
// Needs Blender (BLENDER env, /Applications/Blender.app, or `blender` on PATH) and three from the
// game project's node_modules (--project-root, default: the current directory). Writes only under
// --out (default <project-root>/.scratch/blender-bridge/test). No editor or MCP needed.
//
// Checks, tolerance 1e-5 (Blender stores float32):
//   1. Blender world matrix of every case == C * M_three * C^-1, with C the documented axis map
//      Genesys (x, y, z) -> Blender (x, -z, y).
//   2. Genesys -> Blender -> Genesys: the returned position / Euler / scale, composed by three.js,
//      reproduces the original three.js world matrix.
//   3. sync-from-genesys on a synthetic manifest (hierarchy, primitives, an unsupported mesh, a
//      missing model, lights), re-sync without .001 names, validate, then a moved child, an added
//      linked model and a duplicated instance: diff's desiredLocal, composed under the parent's
//      three.js world matrix, lands on the target world matrix.
// Prints PASS/FAIL lines and the largest errors; exits 1 on any failure.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const projectRoot = path.resolve(opt('--project-root', process.cwd()));
const outDir = path.resolve(opt('--out', path.join(projectRoot, '.scratch', 'blender-bridge', 'test')));
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(projectRoot, 'package.json'));
const THREE = require('three');
const TOL = 1e-5;

function findBlender() {
  const candidates = [
    opt('--blender', ''),
    process.env.BLENDER ?? '',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    path.join(process.env.HOME ?? '', 'Applications/Blender.app/Contents/MacOS/Blender'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const which = spawnSync('sh', ['-c', 'command -v blender'], { encoding: 'utf8' });
  return which.stdout.trim() || null;
}

// Deterministic pseudo-random numbers so a failure reproduces.
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const range = (a, b) => a + (b - a) * rand();

const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
const Cinv = C.clone().invert();
const compose = (t) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...t.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rotation, 'XYZ')),
    new THREE.Vector3(...t.scale),
  );
const toBlender = (m) => C.clone().multiply(m).multiply(Cinv);
const rowsOf = (m) => {
  const e = m.elements; // column-major
  return [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => e[c * 4 + r]));
};
const fromRows = (rows) => new THREE.Matrix4().set(...rows.flat());
const maxDiff = (a, b) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
const worldTransform = (m) => {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { position: p.toArray(), rotation: [e.x, e.y, e.z], scale: s.toArray() };
};

// ---- 1 + 2: conversion cases ------------------------------------------------------------
const H = Math.PI / 2;
const special = [
  [0, 0, 0], [H, 0, 0], [0, H, 0], [0, 0, H], [H, H, 0], [0, H, H], [H, 0, H], [H, H, H],
  [0.3, -0.7, 1.1], [-1.2, 0.4, 2.9], [0.1, H - 1e-3, 0.2], [2.5, -H + 1e-3, -0.4], [Math.PI, 0.5, -Math.PI / 3],
];
const cases = [];
for (const rotation of special) cases.push({ position: [1, 2, 3], rotation, scale: [1, 1, 1] });
for (let i = 0; i < 300; i += 1) {
  cases.push({
    position: [range(-50, 50), range(-50, 50), range(-50, 50)],
    rotation: [range(-Math.PI, Math.PI), range(-H, H), range(-Math.PI, Math.PI)],
    scale: [range(0.2, 3), range(0.2, 3), range(0.2, 3)],
  });
}
cases.forEach((c, i) => (c.id = i));

// ---- 3: synthetic manifest -----------------------------------------------------------------
const nodes = [
  { id: 'g1', name: 'Group', className: 'ENGINE.SceneNode', parent: null, local: { position: [2, 1, -3], rotation: [0.4, -0.8, 1.2], scale: [1.5, 1.5, 1.5] } },
  { id: 'm1', name: 'Box', className: 'ENGINE.MeshNode', parent: 'g1', local: { position: [1, 0.5, 0], rotation: [0.3, 0.9, -0.5], scale: [1, 2, 0.5] }, geometry: { type: 'BoxGeometry', parameters: { width: 1, height: 1, depth: 1 } }, material: { color: 0xff8800 } },
  { id: 'm2', name: 'Cone', className: 'ENGINE.MeshNode', parent: 'g1', local: { position: [-1, 0, 1], rotation: [0, 0, 0.7], scale: [1, 1, 1] }, geometry: { type: 'ConeGeometry', parameters: { radius: 0.5, height: 1 } } },
  { id: 'i1', name: 'Crate Instance', className: 'ENGINE.ModelMeshNode', parent: 'g1', local: { position: [0, 0, 2], rotation: [0, 1.1, 0], scale: [1, 1, 1] }, modelUrl: '<TEST_MODEL>' },
  { id: 'm3', name: 'Floor', className: 'ENGINE.MeshNode', parent: null, local: { position: [0, 0, 0], rotation: [-H, 0, 0], scale: [10, 10, 1] }, geometry: { type: 'PlaneGeometry', parameters: { width: 1, height: 1 } } },
  { id: 'm4', name: 'Pill', className: 'ENGINE.MeshNode', parent: null, local: { position: [3, 1, 3], rotation: [0.2, 0.3, 0.4], scale: [1, 1, 1] }, geometry: { type: 'CapsuleGeometry', parameters: { radius: 0.3, height: 1 } } },
  { id: 'm5', name: 'Ring', className: 'ENGINE.MeshNode', parent: null, local: { position: [-3, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, geometry: { type: 'TorusGeometry', parameters: { radius: 1, tube: 0.2 } } },
  { id: 'm6', name: 'Knot', className: 'ENGINE.MeshNode', parent: null, local: { position: [5, 0, 5], rotation: [0.5, 0, 0], scale: [1, 1, 1] }, geometry: { type: 'TorusKnotGeometry', parameters: {} } },
  { id: 'm7', name: 'Tri', className: 'ENGINE.MeshNode', parent: null, local: { position: [0, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, geometry: { type: 'BufferGeometry', data: { attributes: { position: { itemSize: 3, type: 'Float32Array', array: [0, 0, 0, 1, 0, 0, 0, 1, 0] } } } } },
  { id: 'i2', name: 'Missing Model', className: 'ENGINE.ModelMeshNode', parent: null, local: { position: [7, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, modelUrl: '@engine/assets/models/does-not-exist.glb' },
  { id: 'l1', name: 'Lamp', className: 'ENGINE.PointLightNode', parent: null, local: { position: [0, 5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  { id: 'l2', name: 'Sky Fill', className: 'ENGINE.HemisphereLightNode', parent: null, local: { position: [0, 10, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
  { id: 't1', name: 'Twin', className: 'ENGINE.MeshNode', parent: null, local: { position: [-5, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, geometry: { type: 'SphereGeometry', parameters: { radius: 0.5 } } },
  { id: 't2', name: 'Twin', className: 'ENGINE.MeshNode', parent: null, local: { position: [-6, 0, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, geometry: { type: 'SphereGeometry', parameters: { radius: 0.5 } } },
];
const worldOf = new Map();
for (const n of nodes) {
  const local = compose(n.local);
  worldOf.set(n.id, n.parent ? worldOf.get(n.parent).clone().multiply(local) : local);
}
const records = nodes.map((n, index) => ({
  id: n.id,
  name: n.name,
  className: n.className,
  parentId: n.parent,
  bridgeParentId: n.parent,
  siblingIndex: index,
  outlinePath: [index],
  outlineOrder: index,
  group: n.parent ?? n.name,
  groupId: n.parent ?? n.id,
  ...worldTransform(worldOf.get(n.id)),
  parentTransform: n.parent ? worldTransform(worldOf.get(n.parent)) : null,
  visible: true,
  modelUrl: n.modelUrl ?? null,
  geometry: n.geometry ?? null,
  material: n.material ?? null,
}));
const manifest = {
  format: 'genesys-blender-bridge',
  version: 1,
  sourceScene: '@project/assets/test.genesys-scene',
  totalNodes: records.length,
  inventoryHash: 'test',
  skippedCount: 0,
  skippedByBlockingClass: {},
  records,
};
const targets = {
  move: { position: [4, 2, -1], rotation: [1.0, -0.6, 2.2], scale: [1.5, 3, 0.75] },
  add: { position: [3, 0.5, -2], rotation: [-0.4, 1.3, 0.8], scale: [1.5, 1.5, 1.5] },
  duplicate: { position: [1, 1, 1], rotation: [0.9, 0.2, -1.4], scale: [1.5, 1.5, 1.5] },
};
const targetMatrix = Object.fromEntries(Object.entries(targets).map(([k, t]) => [k, compose(t)]));
const edits = {
  move: { id: 'm1', blenderWorld: rowsOf(toBlender(targetMatrix.move)) },
  add: { parentId: 'g1', blenderWorld: rowsOf(toBlender(targetMatrix.add)) },
  duplicate: { id: 'i1', blenderWorld: rowsOf(toBlender(targetMatrix.duplicate)) },
};

// ---- run Blender ------------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true });
const casesPath = path.join(outDir, 'cases.json');
const resultsPath = path.join(outDir, 'results.json');
fs.rmSync(resultsPath, { force: true });
fs.writeFileSync(casesPath, JSON.stringify({ cases, sync: { manifest, edits } }));
const blender = findBlender();
if (!blender) {
  console.log('FAIL Blender not found: set BLENDER=/path/to/blender or pass --blender');
  process.exit(1);
}
const run = spawnSync(
  blender,
  ['-b', '--factory-startup', '--python', path.join(here, 'test_bridge_blender.py'), '--', casesPath, resultsPath, outDir],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
// Blender's exit code is not the script's: the results file and its ok flag decide.
if (!fs.existsSync(resultsPath)) {
  console.log('FAIL Blender wrote no results');
  console.log((run.stdout || '').split('\n').slice(-30).join('\n'), run.stderr || '');
  process.exit(1);
}
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
if (!results.ok) {
  console.log(`FAIL Blender side: ${results.error}\n${results.traceback}`);
  process.exit(1);
}

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};

// ---- compare 1 + 2 ----------------------------------------------------------------------------
let worstWorld = 0;
let worstRoundTrip = 0;
let worstLegacyDeg = 0;
const legacyDegs = [];
for (const r of results.conversion) {
  const original = compose(cases[r.id]);
  worstWorld = Math.max(worstWorld, maxDiff(fromRows(r.blenderWorld), toBlender(original)));
  worstRoundTrip = Math.max(worstRoundTrip, maxDiff(compose(r.roundTrip), original));
  const expected = new THREE.Matrix4().extractRotation(toBlender(compose({ ...cases[r.id], scale: [1, 1, 1] })));
  const legacy = new THREE.Matrix4().set(...r.legacyBlenderRotation[0], 0, ...r.legacyBlenderRotation[1], 0, ...r.legacyBlenderRotation[2], 0, 0, 0, 0, 1);
  const qa = new THREE.Quaternion().setFromRotationMatrix(expected);
  const qb = new THREE.Quaternion().setFromRotationMatrix(legacy);
  worstLegacyDeg = Math.max(worstLegacyDeg, THREE.MathUtils.radToDeg(qa.angleTo(qb)));
  legacyDegs.push(THREE.MathUtils.radToDeg(qa.angleTo(qb)));
}
check(worstWorld <= TOL, `Blender world == C*M_three*C^-1 for ${results.conversion.length} transforms (max abs error ${worstWorld.toExponential(2)})`);
check(worstRoundTrip <= TOL, `Genesys->Blender->Genesys reproduces the three.js matrix (max abs error ${worstRoundTrip.toExponential(2)})`);
legacyDegs.sort((a, b) => a - b);
console.log(`INFO the pre-fix 'XYZ' parse was off by a median ${legacyDegs[legacyDegs.length >> 1].toFixed(1)}° and up to ${worstLegacyDeg.toFixed(1)}° on these cases`);

// ---- compare 3 --------------------------------------------------------------------------------
const s = results.sync;
check(s.firstSync.ok && s.secondSync.ok, 'sync-from-genesys succeeds twice on the synthetic manifest');
check(s.firstSync.transformValidation?.ok === true, `post-sync transform validation (max position error ${s.validation.maxPositionError?.toExponential?.(2)}, rotation ${s.validation.maxRotationError?.toExponential?.(2)} rad)`);
check(s.validation.ok === true, 'validate after re-sync is ok');
const placeholderIds = (s.secondSync.placeholders || []).map((p) => p.id).sort();
check(JSON.stringify(placeholderIds) === JSON.stringify(['i2', 'm6']), `exactly the missing model and the unsupported mesh became placeholders (${placeholderIds.join(', ')})`);
check(s.namesRestored, `re-sync keeps Genesys names, no stray .001 (${s.objectNames.join(', ')})`);
// Primitive sizes and axes, in the node's Genesys local frame (three.js geometry extents).
const expectedExtents = { m1: [1, 1, 1], m2: [1, 1, 1], m3: [1, 1, 0], m4: [0.6, 1.6, 0.6], m5: [2.4, 2.4, 0.4], m7: [1, 1, 0], t1: [1, 1, 1] };
for (const [id, want] of Object.entries(expectedExtents)) {
  const got = s.extents[id];
  const err = got ? Math.max(...want.map((v, i) => Math.abs(v - got[i]))) : Infinity;
  check(err <= 0.02, `${id} primitive extents ${got ? got.map((v) => v.toFixed(3)).join(' x ') : 'missing'} (three.js ${want.join(' x ')})`);
}
const delta = s.delta;
check(delta.changes.length === 1 && delta.changes[0].id === 'm1', `diff proposes exactly one transform change (got ${delta.changes.map((c) => c.id).join(', ') || 'none'})`);
const parentWorld = worldOf.get('g1');
const localError = (local, target) => maxDiff(parentWorld.clone().multiply(compose(local)), target);
if (delta.changes[0]) {
  const err = localError(delta.changes[0].desiredLocal, targetMatrix.move);
  check(err <= TOL, `moved child: parentWorld * desiredLocal == target (max abs error ${err.toExponential(2)})`);
}
const byName = Object.fromEntries(delta.additions.map((a) => [a.name, a]));
check(delta.additions.length === 2, `diff proposes two additions: linked model and duplicated instance (got ${delta.additions.map((a) => a.name).join(', ')})`);
for (const [name, key] of [['crate_added', 'add'], [s.copyName, 'duplicate']]) {
  const a = byName[name];
  if (!a) {
    check(false, `addition ${name} present`);
    continue;
  }
  const err = localError(a.desiredLocal, targetMatrix[key]);
  check(a.parentId === 'g1' && err <= TOL, `addition ${name}: parent g1, parentWorld * desiredLocal == target (max abs error ${err.toExponential(2)})`);
}
check((delta.unsupported || []).length === 0, `no unsupported objects (${JSON.stringify(delta.unsupported)})`);

console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
