#!/usr/bin/env node
// Level layout tool: a layout JSON (assets + rules) becomes one generated prefab that MCP places with a
// single `action_prefab.instantiate`. Re-running regenerates the prefab; the editor reloads placed instances.
// Run from the game project root (run with no arguments to print the exact command for this install):
//
//   node <this-script> build  levels/street.layout.json [--force]
//   node <this-script> pull   levels/street.layout.json
//   node <this-script> status levels/street.layout.json
//
// build   expand the layout, apply <name>.overrides.json, write the prefab and <name>.generated.json.
//         Refuses when the prefab holds Prefab Editor edits that were not pulled (--force discards them).
// pull    copy Prefab Editor edits into <name>.overrides.json so the next build keeps them: moved, rotated,
//         scaled, deleted or re-propertied nodes at any depth, nodes added anywhere, moved or appended
//         instances of instanced nodes. Fails loudly on edits it cannot represent (reparented nodes,
//         instances removed from an instanced node, shared $objects) instead of dropping them.
// status  print node counts and pending Prefab Editor edits.
//
// "instanced": true on an item (or in defaults) emits one ENGINE.InstancedModelMeshNode per model with
// per-instance transforms, instead of one ENGINE.ModelMeshNode per copy. build hints when an instanced model
// reaches far past its pivot, where the engine's per-instance culling hides copies still on screen. An item with another "className"
// (e.g. ENGINE.SplineMeshNode) may omit "asset" and carry its serialized fields in "props".
//
// Format: see references/layouts.md in this skill.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfAbs = fileURLToPath(import.meta.url);
const selfRel = path.relative(process.cwd(), selfAbs);
const selfPath = selfRel && !selfRel.startsWith('..') ? selfRel : selfAbs;
const [cmd, layoutArg, ...flags] = process.argv.slice(2);
if (!['build', 'pull', 'status'].includes(cmd) || !layoutArg) {
  console.log(`usage: node ${selfPath} build|pull|status <file.layout.json> [--force]   (run from the game project root)`);
  process.exit(2);
}
const force = flags.includes('--force');
const layoutPath = path.resolve(layoutArg);
const base = layoutPath.replace(/\.layout\.json$/, '').replace(/\.json$/, '');
const overridesPath = `${base}.overrides.json`;
const generatedPath = `${base}.generated.json`;

const fail = (msg) => { console.log(`FAIL ${msg}`); process.exit(1); };
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (fallback !== undefined && e.code === 'ENOENT') return fallback; fail(`${p}: ${e.message}`); } };
const writeJson = (p, v, pretty = true) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, pretty ? 2 : 0) + '\n'); };

if (!fs.existsSync('package.json')) console.log('WARN no package.json in the current folder; run from the game project root');
const layout = readJson(layoutPath);
if (!layout.prefab || !/\.prefab\.json$/.test(layout.prefab)) fail('layout.prefab must be a project path ending in .prefab.json (e.g. assets/prefabs/levels/Street.prefab.json)');
const prefabFile = path.resolve(layout.prefab.replace(/^@project\//, ''));
const prefabLogical = '@project/' + path.relative(process.cwd(), prefabFile).split(path.sep).join('/');
if (!prefabLogical.startsWith('@project/assets/')) console.log(`WARN ${prefabLogical} is outside assets/; the editor and the build only load prefabs under assets/`);
const rootName = layout.name ?? path.basename(prefabFile, '.prefab.json');

// ---------- stable ids, seeded randomness ----------
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');
const stableId = (key) => hash(`${prefabLogical}|${key}`).slice(0, 16);
const stableNodeId = (key) => parseInt(hash(`node|${prefabLogical}|${key}`).slice(0, 7), 16);
function rng(seedText) {
  let a = parseInt(hash(seedText).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const DEG = Math.PI / 180;
const vec = (v, d = 0) => (Array.isArray(v) ? [v[0] ?? d, v[1] ?? d, v[2] ?? d] : typeof v === 'number' ? [v, v, v] : [d, d, d]);
const round = (n) => Math.round(n * 1e5) / 1e5;
const add3 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const ROOT = 'root';

// ---------- expand layout into flat entries ----------
function resolveAsset(ref, index, rand) {
  const list = Array.isArray(ref) ? ref : [ref];
  const pick = list[layout.assetPick === 'random' ? Math.floor(rand() * list.length) : index % list.length];
  const url = layout.assets?.[pick] ?? pick;
  if (typeof url !== 'string' || !/^@(project|engine)\//.test(url)) fail(`asset "${pick}" is not in layout.assets and is not an @project/@engine path`);
  const label = layout.assets?.[pick] ? pick : path.basename(url).replace(/\.[^.]+$/, '');
  return { url, label };
}

function physicsFor(spec) {
  const p = spec ?? true;
  if (p === false) return { enabled: false };
  if (p === true) return null; // engine default: static, convex hull
  // Engine CollisionMeshType values (.engine/src/physics/PhysicsTypes.ts); 'box' / 'sphere' are aliases.
  const MESH_TYPES = { trimesh: 'trimesh', convexHull: 'convexHull', boundingBox: 'boundingBox', box: 'boundingBox',
    boundingSphere: 'boundingSphere', sphere: 'boundingSphere', voxels: 'voxels' };
  if (typeof p === 'string' && MESH_TYPES[p]) return { collisionMeshType: MESH_TYPES[p] };
  if (typeof p === 'object') return p;
  fail(`unknown physics value ${JSON.stringify(p)} (use false, true, "trimesh", "convexHull", "boundingBox", "boundingSphere", "voxels" or a physicsOptions object)`);
}

function instancedFor(spec, item, where) {
  if (!spec) return null;
  if (spec !== true && typeof spec !== 'object') fail(`${where}: "instanced" must be true or { cullDistance, lods }`);
  const o = spec === true ? {} : spec;
  const out = {};
  if (o.cullDistance !== undefined) out.cullDistance = o.cullDistance;
  if (o.lods) {
    if (Array.isArray(item.asset)) fail(`${where}: instanced "lods" need a single asset, not a list`);
    out.lods = o.lods.map((l) => ({ distance: l.distance, modelUrl: resolveAsset(l.asset, 0, () => 0).url }));
  }
  return out;
}

function expand() {
  const groups = [];
  const seenGroups = new Set();
  for (const g of layout.groups ?? []) {
    if (!g.name) fail('every group needs a name');
    if (seenGroups.has(g.name)) fail(`duplicate group name ${g.name}`);
    seenGroups.add(g.name);
    const entries = [];
    const seenKeys = new Set();
    for (const item of g.items ?? []) {
      if (!item.key) fail(`group ${g.name}: every item needs a key`);
      if (seenKeys.has(item.key)) fail(`group ${g.name}: duplicate item key ${item.key}`);
      seenKeys.add(item.key);
      const where = `group ${g.name} item ${item.key}`;
      const d = { ...layout.defaults, ...g.defaults, ...item };
      if (item.repeat && item.ring) fail(`${where}: use repeat or ring, not both`);
      const instanced = instancedFor(d.instanced, item, where);
      if (instanced && d.className && d.className !== 'ENGINE.InstancedModelMeshNode') fail(`${where}: instanced items always become ENGINE.InstancedModelMeshNode; remove className or "instanced"`);
      const count = item.repeat?.count ?? item.ring?.count ?? 1;
      const step = vec(item.repeat?.step);
      const rotStep = vec(item.repeat?.rotationStep);
      const mirrors = item.mirror === 'x' ? [1, -1] : [1];
      for (let i = 0; i < count; i++) {
        for (const m of mirrors) {
          const instKey = `${g.name}/${item.key}${count > 1 ? `#${i}` : ''}${m < 0 ? '~mx' : ''}`;
          const rand = rng(`${layout.seed ?? 0}|${instKey}`);
          let pos = add3(vec(item.position), step, i);
          let rot = add3(vec(item.rotation), rotStep, i);
          if (item.ring) {
            const a = (item.ring.startDeg ?? 0) + (i * 360) / count;
            const r = item.ring.radius ?? 10;
            pos = add3(pos, [Math.sin(a * DEG) * r, 0, Math.cos(a * DEG) * r]);
            rot[1] += a + (item.ring.faceCenter ? 180 : 0);
          }
          if (d.jitter) {
            const jp = vec(d.jitter.position), jr = vec(d.jitter.rotation);
            pos = pos.map((v, k) => v + (rand() * 2 - 1) * jp[k]);
            rot = rot.map((v, k) => v + (rand() * 2 - 1) * jr[k]);
          }
          let scale = vec(item.scale ?? 1, 1);
          if (d.jitter?.scale) { const s = 1 + (rand() * 2 - 1) * d.jitter.scale; scale = scale.map((v) => v * s); }
          if (m < 0) { pos[0] = -pos[0]; rot[1] = -rot[1]; rot[2] = -rot[2]; }
          const asset = item.asset !== undefined ? resolveAsset(item.asset, i, rand) : { url: null, label: item.key };
          if (!asset.url && (instanced || !d.className || d.className === 'ENGINE.ModelMeshNode')) fail(`${where}: needs an asset (only items with another className, such as ENGINE.SplineMeshNode, may omit it)`);
          entries.push({
            key: instKey, itemKey: item.key, itemName: item.name ?? item.key,
            className: d.className ?? 'ENGINE.ModelMeshNode',
            name: item.name ? `${item.name}${count > 1 ? `_${i}` : ''}${m < 0 ? '_L' : ''}` : instKey.split('/')[1].replace('#', '_').replace('~mx', '_L'),
            modelUrl: asset.url, assetLabel: asset.label, singleAsset: !Array.isArray(item.asset),
            position: pos, rotation: rot.map((r) => r * DEG), scale,
            castShadow: d.castShadow ?? true, receiveShadow: d.receiveShadow ?? true,
            physics: physicsFor(d.physics), extra: d.props ?? null, instanced, optedOut: d.instanced === false,
          });
        }
      }
    }
    groups.push({ name: g.name, key: `${g.name}/`, position: vec(g.position), rotation: vec(g.rotation).map((r) => r * DEG), entries });
  }
  return groups;
}

// ---------- per-instance culling check ----------
// The engine's per-instance frustum test (BaseInstancedMeshNode.runCullAndLODPass) uses a sphere centred on each
// instance's pivot, with the bounding radius of the model's first submesh. A model whose geometry reaches well past
// that radius from its pivot (corner pivots, tall bottom-pivot pieces) is culled while part of it is still in view.
const CULL_SLACK_M = 1;
const cullReach = new Map();
function glbReach(url) {
  if (cullReach.has(url)) return cullReach.get(url);
  let out = null;
  try {
    const file = url.startsWith('@project/') ? url.slice(9) : `node_modules/@gnsx/genesys.js/${url.slice(8)}`;
    const buf = fs.readFileSync(file);
    if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('not a GLB');
    const gltf = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
    const mul = (a, b) => { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
    const local = (n) => {
      if (n.matrix) return n.matrix;
      const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
      return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
    };
    let radius = null, reach = 0;
    const visit = (i, parent) => {
      const n = gltf.nodes[i];
      const m = mul(parent, local(n));
      for (const prim of n.mesh !== undefined ? gltf.meshes[n.mesh].primitives : []) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        if (!acc?.min || !acc?.max) continue;
        const [x0, y0, z0] = acc.min, [x1, y1, z1] = acc.max;
        const scale = Math.max(...[0, 4, 8].map((c) => Math.hypot(m[c], m[c + 1], m[c + 2])));
        radius ??= (Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2) * scale; // first submesh, as the engine does
        for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
          reach = Math.max(reach, Math.hypot(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]));
        }
      }
      for (const c of n.children ?? []) visit(c, m);
    };
    const scene = gltf.scenes?.[gltf.scene ?? 0];
    for (const i of scene?.nodes ?? []) visit(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    if (radius !== null) out = { radius, reach };
  } catch {
    // Unreadable or compressed model: skip the check rather than fail the build.
  }
  cullReach.set(url, out);
  return out;
}

// ---------- prefab serialisation (engine format: sparse, $bc type tags, v3 / e tuples) ----------
// Instanced form checked against the engine serializer (WorldSerializer.exportObject on an InstancedModelMeshNode):
// instances: [{ position: {$bc:'v3',_:[x,y,z]}, rotation: {$bc:'e',_:[rx,ry,rz]}, scale: {$bc:'v3',_:[sx,sy,sz]} }]
const isOne = (s) => s.every((v) => Math.abs(v - 1) < 1e-9);
const isZero = (s) => s.every((v) => Math.abs(v) < 1e-9);
const tuple = (v, d) => (v && Array.isArray(v._) ? v._.map(round) : [d, d, d]);
const transformOf = (n) => ({ position: tuple(n.position, 0), rotation: tuple(n.rotation, 0), scale: tuple(n.scale, 1) });
const instTuple = (i) => [...tuple(i?.position, 0), ...tuple(i?.rotation, 0), ...tuple(i?.scale, 1)];
const instJson = (t) => ({ position: { $bc: 'v3', _: t.position.map(round) }, rotation: { $bc: 'e', _: t.rotation.map(round) }, scale: { $bc: 'v3', _: t.scale.map(round) } });
const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
const sameT = (a, b) => ['position', 'rotation', 'scale'].every((k) => near(a[k], b[k]));
function setT(n, t) {
  delete n.position; delete n.rotation; delete n.scale;
  if (t.position && !isZero(t.position)) n.position = { $bc: 'v3', _: t.position.map(round) };
  if (t.rotation && !isZero(t.rotation)) n.rotation = { $bc: 'e', _: t.rotation.map(round) };
  if (t.scale && !isOne(t.scale)) n.scale = { $bc: 'v3', _: t.scale.map(round) };
}
const SKIP_FIELDS = new Set(['children', 'position', 'rotation', 'scale', 'nodeId', 'prefabId', 'instances']);
const fieldsOf = (n) => Object.fromEntries(Object.entries(n).filter(([k]) => !SKIP_FIELDS.has(k)));
// Canonical JSON: sorted keys, rounded numbers, nodeId ignored (the editor may renumber it).
const canon = (v) => JSON.stringify(v, (k, x) => {
  if (k === 'nodeId') return undefined;
  if (typeof x === 'number') return Math.round(x * 1e4) / 1e4;
  if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]]));
  return x;
});

function nodeJson(e) {
  const n = { $bc: e.className, children: [], name: e.name, nodeId: stableNodeId(e.key), prefabId: stableId(e.key) };
  if (e.modelUrl) n.modelUrl = e.modelUrl;
  if (e.castShadow) n.castShadow = true;
  if (e.receiveShadow) n.receiveShadow = true;
  if (e.physics) n.physicsOptions = e.physics;
  setT(n, e);
  if (e.extra) Object.assign(n, e.extra);
  return n;
}
function bucketJson(b) {
  const e = b.first;
  const n = { $bc: 'ENGINE.InstancedModelMeshNode', children: [], name: b.name, nodeId: stableNodeId(b.key), prefabId: stableId(b.key), modelUrl: e.modelUrl };
  if (e.castShadow) n.castShadow = true;
  if (e.receiveShadow) n.receiveShadow = true;
  if (e.physics) n.physicsOptions = e.physics;
  if (e.instanced.cullDistance !== undefined) n.cullDistance = e.instanced.cullDistance;
  if (e.instanced.lods?.length) n.lods = e.instanced.lods;
  if (e.extra) Object.assign(n, e.extra);
  return n;
}
function applyOverride(n, o) {
  if (!o) return;
  if (o.position || o.rotation || o.scale) setT(n, { ...transformOf(n), ...o });
  if (o.props) Object.assign(n, o.props);
  for (const k of o.unset ?? []) delete n[k];
}

// ---------- overrides file ----------
function readOverrides() {
  const o = readJson(overridesPath, { nodes: {}, added: [], addedInstances: {} });
  o.nodes ??= {};
  o.added = (o.added ?? []).map((a) => (a.parent ? a : { parent: `${a.group}/`, node: a.node })); // older files keyed added nodes by group name
  o.addedInstances ??= {};
  return o;
}

// ---------- build the prefab tree ----------
function buildTree() {
  const overrides = readOverrides();
  const groups = expand();
  const gen = { version: 2, prefab: prefabLogical, builtAt: new Date().toISOString(), ids: {}, nodes: {}, added: [] };
  const stats = { nodes: 0, overridden: 0, dropped: 0, instanced: 0, instances: 0, added: 0 };
  const byKey = new Map();
  const record = (key, parent, n) => {
    gen.ids[n.prefabId] = key;
    gen.nodes[key] = { parent, t: transformOf(n), f: fieldsOf(n) };
    byKey.set(key, n);
  };
  const deleted = (key) => overrides.nodes[key]?.deleted;

  const rootNode = { $bc: 'ENGINE.SceneNode', children: [], name: rootName, nodeId: stableNodeId(ROOT), prefabId: stableId(ROOT) };
  const r = layout.root ?? {};
  setT(rootNode, { position: vec(r.position), rotation: vec(r.rotation).map((v) => v * DEG), scale: vec(r.scale ?? 1, 1) });
  applyOverride(rootNode, overrides.nodes[ROOT]);
  record(ROOT, null, rootNode);

  const hints = new Map();
  const cullHints = new Map();
  for (const g of groups) {
    if (deleted(g.key)) { stats.dropped += g.entries.length; continue; }
    const gn = { $bc: 'ENGINE.SceneNode', children: [], name: g.name, nodeId: stableNodeId(g.key), prefabId: stableId(g.key) };
    setT(gn, { position: g.position, rotation: g.rotation });
    applyOverride(gn, overrides.nodes[g.key]);
    record(g.key, ROOT, gn);
    rootNode.children.push(gn);
    const buckets = new Map();
    for (const e of g.entries) {
      const o = overrides.nodes[e.key];
      if (o?.deleted) { stats.dropped++; continue; }
      if (e.instanced) {
        const bKey = `${g.name}/${e.itemKey}@${e.assetLabel}`;
        let b = buckets.get(bKey);
        if (!b) {
          if (deleted(bKey)) { stats.dropped++; continue; }
          b = { key: bKey, first: e, name: e.singleAsset ? e.itemName : `${e.itemName}_${e.assetLabel}`, keys: [], ts: [] };
          buckets.set(bKey, b);
          b.node = bucketJson(b);
          gn.children.push(b.node); // the node takes the slot of its first copy, so item order is kept
        }
        const t = o?.position ? { position: o.position, rotation: o.rotation, scale: o.scale } : { position: e.position, rotation: e.rotation, scale: e.scale };
        if (o?.position) stats.overridden++;
        b.keys.push(e.key); b.ts.push(t);
        continue;
      }
      if (!e.optedOut && e.modelUrl) {
        const h = hints.get(e.modelUrl) ?? { n: 0, items: new Set() };
        h.n++; h.items.add(`${g.name}/${e.itemKey}`); hints.set(e.modelUrl, h);
      }
      const n = nodeJson(e);
      if (o) { stats.overridden++; applyOverride(n, o); }
      record(e.key, g.key, n);
      gn.children.push(n);
      stats.nodes++;
    }
    for (const b of buckets.values()) {
      for (const [k, t] of (overrides.addedInstances[b.key] ?? []).entries()) { b.keys.push(`+${k}`); b.ts.push(t); }
      b.node.instances = b.ts.map(instJson);
      if (b.ts.length > 1000) b.node.maxInstances = b.ts.length; // engine default capacity is 1000
      applyOverride(b.node, overrides.nodes[b.key]);
      if (b.node.perInstanceFrustumCulling !== false) {
        const h = cullHints.get(b.node.modelUrl) ?? new Set();
        h.add(`${g.name}/${b.first.itemKey}`); cullHints.set(b.node.modelUrl, h);
      }
      record(b.key, g.key, b.node);
      gen.nodes[b.key].inst = { keys: b.keys, t: b.node.instances.map(instTuple) };
      stats.nodes++; stats.instanced++; stats.instances += b.ts.length;
    }
  }
  for (const a of overrides.added) {
    const parent = byKey.get(a.parent);
    if (!parent) { console.log(`WARN added node "${a.node?.name}" skipped: its parent ${a.parent} is no longer in the layout`); continue; }
    parent.children ??= [];
    parent.children.push(a.node);
    gen.added.push(a.parent);
    stats.added++;
  }
  for (const [url, items] of cullHints) {
    const c = glbReach(url);
    if (c && c.reach - c.radius > CULL_SLACK_M) console.log(`HINT ${path.basename(url)} reaches ${c.reach.toFixed(1)} m from its pivot, but the engine culls each instance with a ${c.radius.toFixed(1)} m sphere around the pivot, so copies vanish while still on screen (${[...items].join(', ')}); add "props": { "perInstanceFrustumCulling": false } to those items`);
  }
  for (const [url, h] of hints) if (h.n > 10) console.log(`HINT ${h.n} separate ModelMeshNodes of ${path.basename(url)} (${[...h.items].join(', ')}); add "instanced": true to repeated dressing ("instanced": false silences this)`);
  return { rootNode, gen, groups, stats };
}

// ---------- read the prefab on disk and compare with what the last build wrote ----------
function walkDisk(gen) {
  const doc = readJson(prefabFile);
  if (doc.$objects) fail(`${prefabLogical} holds shared $objects (written by the editor); layout.mjs cannot round-trip them. Unlink, or rebuild with --force to discard.`);
  const root = doc.$root?.rootNode;
  if (doc.$root?.$bc !== 'ENGINE.Prefab' || !root || typeof root !== 'object') fail(`${prefabLogical} is not a prefab document layout.mjs understands ($root.$bc ENGINE.Prefab with a rootNode)`);
  const seen = new Map();
  const added = [];
  const check = (n, where) => {
    if (!n || typeof n !== 'object' || Array.isArray(n) || '$ref' in n) fail(`${where}: node is a reference or not an object; layout.mjs cannot round-trip it`);
    if (n.children !== undefined && !Array.isArray(n.children)) fail(`${where}: children is not an array`);
  };
  const containsKnown = (n) => (n && gen.ids[n.prefabId] ? n.name ?? n.prefabId : (n?.children ?? []).map(containsKnown).find(Boolean));
  const walk = (n, parentKey, where) => {
    check(n, where);
    const key = gen.ids[n.prefabId];
    if (!key) {
      if (parentKey === null) fail(`${prefabLogical}: the root node was replaced in the Prefab Editor; rebuild with --force`);
      const inner = (n.children ?? []).map(containsKnown).find(Boolean);
      if (inner) fail(`generated node "${inner}" was moved under "${n.name}", a node added in the Prefab Editor; layout.mjs cannot represent that. Move it back, or build --force to discard.`);
      added.push({ parent: parentKey, node: n });
      return;
    }
    if (seen.has(key)) fail(`generated node ${key} appears twice in ${prefabLogical}`);
    seen.set(key, { node: n, parent: parentKey });
    (n.children ?? []).forEach((c, i) => walk(c, key, `${where}/${c?.name ?? i}`));
  };
  walk(root, null, rootName);
  return { seen, added };
}

function normalizeGen(gen) {
  if (gen.version === 2) return gen;
  // generated.json from an older layout.mjs: transforms of item nodes only, no parents, no fields.
  console.log('WARN generated.json is from an older layout.mjs: only item transforms are tracked until the next build');
  const nodes = Object.fromEntries(Object.entries(gen.nodes ?? {}).map(([k, t]) => [k, { t }]));
  return { ...gen, legacy: true, ids: { ...gen.ids, [stableId(ROOT)]: ROOT }, nodes, added: [] };
}

function diskEdits() {
  const raw = readJson(generatedPath, null);
  if (!raw || !fs.existsSync(prefabFile)) return { gen: raw, moved: [], deleted: [], changed: [], instMoved: [], extraInst: {}, added: [], addedDiff: 0, pending: 0 };
  const gen = normalizeGen(raw);
  const overrides = readOverrides();
  const { seen, added } = walkDisk(gen);
  const moved = [], deleted = [], changed = [], instMoved = [], extraInst = {};
  let instChanges = 0;
  for (const [key, rec] of Object.entries(gen.nodes)) {
    const s = seen.get(key);
    if (!s) { deleted.push(key); continue; }
    if (!gen.legacy && s.parent !== rec.parent) fail(`${key} was moved from ${rec.parent} to ${s.parent} in the Prefab Editor; layout.mjs cannot represent a reparent. Move it back, or build --force to discard.`);
    const now = transformOf(s.node);
    if (!sameT(now, rec.t)) moved.push({ key, t: now });
    if (!gen.legacy) {
      const before = rec.f, after = fieldsOf(s.node);
      const props = {}, unset = [];
      for (const k of Object.keys(after)) if (canon(after[k]) !== canon(before[k])) props[k] = after[k];
      for (const k of Object.keys(before)) if (!(k in after)) unset.push(k);
      if (Object.keys(props).length || unset.length) changed.push({ key, props, unset });
    }
    if (rec.inst) {
      const disk = Array.isArray(s.node.instances) ? s.node.instances : [];
      if (disk.length < rec.inst.keys.length) fail(`${key}: ${rec.inst.keys.length - disk.length} instance(s) removed in the Prefab Editor; layout.mjs maps instances by index and cannot pull a removal. Delete copies in the layout (or "deleted": true in the overrides), or build --force to discard.`);
      const extra = [];
      disk.forEach((inst, i) => {
        const t = instTuple(inst);
        const tObj = { position: t.slice(0, 3), rotation: t.slice(3, 6), scale: t.slice(6, 9) };
        const k = rec.inst.keys[i];
        if (k === undefined || k.startsWith('+')) { extra.push(tObj); return; }
        if (!near(t, rec.inst.t[i])) instMoved.push({ key: k, t: tObj });
      });
      if (canon(extra) !== canon(overrides.addedInstances[key] ?? [])) instChanges++;
      extraInst[key] = extra;
    }
  }
  const before = new Set(overrides.added.map((a) => canon(a)));
  const now = new Set(added.map((a) => canon(a)));
  const addedDiff = [...now].filter((x) => !before.has(x)).length + [...before].filter((x) => !now.has(x)).length;
  const pending = moved.length + deleted.length + changed.length + instMoved.length + instChanges + addedDiff;
  return { gen, moved, deleted, changed, instMoved, extraInst, added, addedDiff, pending };
}

function build(guard = true) {
  if (guard && !force) {
    const edits = diskEdits();
    if (edits.pending) fail(`${path.relative(process.cwd(), prefabFile)} has ${edits.pending} Prefab Editor edit(s) not in the layout. Run "layout.mjs pull" first, or build --force to discard them.`);
  }
  const { rootNode, gen, groups, stats } = buildTree();
  writeJson(prefabFile, { $root: { $bc: 'ENGINE.Prefab', $uuid: stableId('prefab'), rootNode }, $version: 3 }, false);
  writeJson(generatedPath, gen);
  const urls = new Set(groups.flatMap((g) => g.entries.map((e) => e.modelUrl)).filter(Boolean));
  const engineRoot = 'node_modules/@gnsx/genesys.js/';
  for (const u of urls) {
    if (u.startsWith('@project/') && !fs.existsSync(u.replace('@project/', ''))) console.log(`WARN missing model ${u}`);
    if (u.startsWith('@engine/') && fs.existsSync(engineRoot) && !fs.existsSync(engineRoot + u.replace('@engine/', ''))) console.log(`WARN missing engine model ${u}`);
  }
  console.log(`PREFAB ${prefabLogical}  groups ${groups.length}  nodes ${stats.nodes}  instanced ${stats.instanced} (${stats.instances} instances)  overridden ${stats.overridden}  deleted ${stats.dropped}  added ${stats.added}  models ${urls.size}`);
  console.log(`NEXT first time: action_prefab instantiate { prefabPath: "${prefabLogical}" }; later builds reload placed instances (resync if one does not update).`);
  console.log('RESULT ok');
}

function pull() {
  const { gen, moved, deleted, changed, instMoved, extraInst, added } = diskEdits();
  if (!gen) fail(`no ${path.basename(generatedPath)} or no prefab yet: run build first`);
  const overrides = readOverrides();
  const entry = (k) => (overrides.nodes[k] = overrides.nodes[k]?.deleted ? {} : (overrides.nodes[k] ?? {}));
  for (const m of [...moved, ...instMoved]) Object.assign(entry(m.key), m.t);
  for (const c of changed) {
    const o = entry(c.key);
    const props = { ...o.props };
    for (const k of c.unset) delete props[k];
    Object.assign(props, c.props);
    const unset = [...new Set([...(o.unset ?? []), ...c.unset])].filter((k) => !(k in props));
    if (Object.keys(props).length) o.props = props; else delete o.props;
    if (unset.length) o.unset = unset; else delete o.unset;
  }
  for (const k of deleted) overrides.nodes[k] = { deleted: true };
  overrides.added = added;
  for (const [k, list] of Object.entries(extraInst)) { if (list.length) overrides.addedInstances[k] = list; else delete overrides.addedInstances[k]; }
  writeJson(overridesPath, overrides);
  // The prefab on disk now matches layout + overrides, so record it as the generated state.
  build(false);
  console.log(`PULLED moved ${moved.length}  instances moved ${instMoved.length}  changed ${changed.length}  deleted ${deleted.length}  added ${added.length}  → ${path.relative(process.cwd(), overridesPath)}`);
}

function status() {
  const groups = expand();
  const { gen, moved, deleted, changed, instMoved, addedDiff, pending } = diskEdits();
  const plain = groups.reduce((s, g) => s + g.entries.filter((e) => !e.instanced).length, 0);
  const inst = groups.reduce((s, g) => s + g.entries.filter((e) => e.instanced).length, 0);
  console.log(`LAYOUT ${path.relative(process.cwd(), layoutPath)}  groups ${groups.length}  nodes ${plain}  instances ${inst}`);
  console.log(`PREFAB ${prefabLogical}  ${fs.existsSync(prefabFile) ? 'exists' : 'not built'}${gen ? `  last build ${gen.builtAt}` : ''}`);
  console.log(`EDITS moved ${moved.length}  instances moved ${instMoved.length}  changed ${changed.length}  deleted ${deleted.length}  added/removed ${addedDiff}${pending ? '  → run pull before build' : ''}`);
}

({ build: () => build(true), pull, status })[cmd]();
