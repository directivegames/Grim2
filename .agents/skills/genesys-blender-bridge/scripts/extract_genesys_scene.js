// Genesys MCP run_script body — extract a chunk of the live scene for the Blender bridge.
// Replace OFFSET / COUNT before each call. Chunk size 40 is a safe default.
// This file is a run_script body (wrapped in async by Genesys) — top-level await is intentional.

const OFFSET = 0;
const COUNT = 40;

const MIRRORABLE = new Set([
  "ENGINE.SceneNode",
  "ENGINE.MeshNode",
  "ENGINE.ModelMeshNode",
]);

function isLightClass(className) {
  return typeof className === "string" && /^ENGINE\..*LightNode$/.test(className);
}

function isMirrorableClass(className) {
  return MIRRORABLE.has(className) || isLightClass(className);
}

function isMirrorableAncestorClass(className) {
  return MIRRORABLE.has(className);
}

function vector3(value, fallback = [0, 0, 0]) {
  if (typeof value === "string") {
    const numbers = value
      .match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)
      ?.map(Number);
    if (numbers?.length >= 3) return numbers.slice(0, 3);
  }
  if (Array.isArray(value) && value.length >= 3) {
    return value.slice(0, 3).map(Number);
  }
  if (value && typeof value === "object") {
    const result = [
      value.x ?? value._x,
      value.y ?? value._y,
      value.z ?? value._z,
    ];
    if (result.every(Number.isFinite)) return result;
  }
  return [...fallback];
}

function worldTransform(component) {
  return {
    position: vector3(component?.transform?.position, [0, 0, 0]),
    rotation: vector3(component?.transform?.rotation, [0, 0, 0]),
    scale: vector3(component?.transform?.scale, [1, 1, 1]),
  };
}

function hashInventory(ids) {
  let hash = 2166136261;
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const state = await genesys.queryEditor({ operation: "getState" });
if (!state.editorReady) {
  throw new Error(
    `Editor not ready: ${(state.blockingReasons || []).join("; ")}`,
  );
}
if (state.documentType !== "scene" || !state.activeScenePath) {
  throw new Error("Open a Genesys scene before extracting a Blender bridge chunk");
}
if (state.playMode?.isActive || state.playMode?.isStarting) {
  throw new Error("Stop play mode before extracting a Blender bridge chunk");
}

const meshTree = await genesys.queryNode({
  operation: "getTree",
  query: "ENGINE.MeshNode",
  limit: 500,
});
const modelTree = await genesys.queryNode({
  operation: "getTree",
  query: "ENGINE.ModelMeshNode",
  limit: 500,
});
const lightTree = await genesys.queryNode({
  operation: "getTree",
  query: "LightNode",
  limit: 500,
});
const sceneTree = await genesys.queryNode({
  operation: "getTree",
  query: "ENGINE.SceneNode",
  limit: 500,
});
for (const [label, tree] of [
  ["MeshNode", meshTree],
  ["ModelMeshNode", modelTree],
  ["LightNode", lightTree],
  ["SceneNode", sceneTree],
]) {
  if ((tree.nodes || []).length >= 500) {
    throw new Error(
      `${label} inventory reached the 500-node query limit; ` +
        "complete extraction cannot be proven",
    );
  }
}

const byId = new Map();
for (const tree of [meshTree, modelTree, lightTree, sceneTree]) {
  for (const node of tree.nodes || []) {
    byId.set(node.id, node);
  }
}

// Broaden identity map so ancestry walks can see actors / other blockers.
const broadPasses = ["", "ENGINE.", "GAME.", "Node", "Actor"];
for (const query of broadPasses) {
  const tree = await genesys.queryNode({
    operation: "getTree",
    ...(query ? { query } : {}),
    limit: 500,
  });
  for (const node of tree.nodes || []) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }
}

async function detailsFor(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    const result = await genesys.queryNode({
      operation: "getDetails",
      componentIds: slice,
    });
    for (const component of result.components || []) {
      if (component?.id && !component.error) out.set(component.id, component);
    }
  }
  return out;
}

async function editableFor(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 20) {
    const slice = ids.slice(i, i + 20);
    const result = await genesys.queryNode({
      operation: "getEditableProperties",
      componentIds: slice,
    });
    for (const component of result.components || []) {
      if (component?.id) out.set(component.id, component);
    }
  }
  return out;
}

function propertyValue(editable, path) {
  const props = editable?.editableProperties || [];
  const hit = props.find((property) => property.path === path);
  return hit?.value;
}

/**
 * Actor-ancestry rule: a node is mirrored only when every ancestor up to the
 * world root is ENGINE.SceneNode / MeshNode / ModelMeshNode. Anything whose
 * ancestry passes through an Actor (or any other class) is excluded entirely,
 * including lights nested under actors.
 */
function mirrorableAncestry(nodeId) {
  const chain = [];
  let current = byId.get(nodeId);
  const seen = new Set();
  while (current) {
    if (seen.has(current.id)) {
      return { ok: false, blocker: "cycle", chain };
    }
    seen.add(current.id);
    chain.push(current);
    if (!current.parentId) return { ok: true, blocker: null, chain };
    const parent = byId.get(current.parentId);
    if (!parent) {
      return { ok: false, blocker: `missing-parent:${current.parentId}`, chain };
    }
    if (!isMirrorableAncestorClass(parent.className)) {
      return { ok: false, blocker: parent.className, chain };
    }
    current = parent;
  }
  return { ok: false, blocker: "unknown", chain };
}

const candidateIds = [...byId.values()]
  .filter((node) => isMirrorableClass(node.className))
  .map((node) => node.id);

const skippedByBlockingClass = {};
const eligible = [];
for (const id of candidateIds) {
  const node = byId.get(id);
  // SceneNodes are only kept when they become ancestors of a kept leaf; seed
  // from meshes/lights first, then add exact SceneNode ancestors.
  if (node.className === "ENGINE.SceneNode") continue;
  const ancestry = mirrorableAncestry(id);
  if (!ancestry.ok) {
    if (
      ancestry.blocker === "cycle" ||
      ancestry.blocker === "unknown" ||
      ancestry.blocker?.startsWith("missing-parent:")
    ) {
      throw new Error(
        `Cannot prove complete ancestry for ${node.id} (${node.name}): ` +
          ancestry.blocker,
      );
    }
    const key = ancestry.blocker || "unknown";
    skippedByBlockingClass[key] = (skippedByBlockingClass[key] || 0) + 1;
    continue;
  }
  eligible.push(id);
  for (const ancestor of ancestry.chain.slice(1)) {
    if (ancestor.className === "ENGINE.SceneNode") eligible.push(ancestor.id);
  }
}

const uniqueEligible = [...new Set(eligible)];

// Root ordering: find one uncapped getTree pass that covers every bridge root.
const bridgeRoots = uniqueEligible.filter((id) => !byId.get(id)?.parentId);
const rootOrderCandidates = [
  "",
  "ENGINE.",
  "GAME.",
  "Node",
  "SceneNode",
  "ModelMeshNode",
  "MeshNode",
  "LightNode",
];
let rootOrder = null;
let rootOrderSource = null;
for (const query of rootOrderCandidates) {
  const tree = await genesys.queryNode({
    operation: "getTree",
    ...(query ? { query } : {}),
    limit: 500,
  });
  const nodes = tree.nodes || [];
  if (nodes.length >= 500) continue;
  // Genesys marks every top-level node with isWorldRoot; there is no synthetic
  // parent holding an ordered childIds list. getTree returns nodes in outliner
  // order, and class filters preserve relative order, so the root sequence is
  // the filtered order of the parentless nodes in this pass.
  const orderedRoots = nodes
    .filter((node) => (node.isWorldRoot || !node.parentId) && bridgeRoots.includes(node.id))
    .map((node) => node.id);
  const covered = new Set(orderedRoots);
  if (bridgeRoots.every((id) => covered.has(id))) {
    rootOrder = orderedRoots;
    rootOrderSource = query || "(unfiltered)";
    break;
  }
}
if (!rootOrder) {
  throw new Error(
    `Unable to resolve uncapped root order covering ${bridgeRoots.length} bridge roots`,
  );
}

const rootIndex = new Map(rootOrder.map((id, index) => [id, index]));

function siblingIndexOf(node) {
  if (!node.parentId) {
    return rootIndex.has(node.id) ? rootIndex.get(node.id) : Number.MAX_SAFE_INTEGER;
  }
  const parent = byId.get(node.parentId);
  const childIds = parent?.childIds || [];
  const index = childIds.indexOf(node.id);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function outlinePathOf(node) {
  const path = [];
  let current = node;
  const guard = new Set();
  while (current) {
    if (guard.has(current.id)) break;
    guard.add(current.id);
    path.push(siblingIndexOf(current));
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return path.reverse();
}

const sortedEligible = uniqueEligible
  .map((id) => byId.get(id))
  .filter(Boolean)
  .sort((left, right) => {
    const lp = outlinePathOf(left);
    const rp = outlinePathOf(right);
    const n = Math.max(lp.length, rp.length);
    for (let i = 0; i < n; i += 1) {
      const a = lp[i] ?? -1;
      const b = rp[i] ?? -1;
      if (a !== b) return a - b;
    }
    return left.id.localeCompare(right.id);
  });

const total = sortedEligible.length;
if (OFFSET < 0 || COUNT <= 0 || OFFSET > total) {
  throw new Error(`Invalid extraction range OFFSET=${OFFSET} COUNT=${COUNT} total=${total}`);
}
const slice = sortedEligible.slice(OFFSET, OFFSET + COUNT);
const sliceIds = slice.map((node) => node.id);
const detailMap = await detailsFor(sliceIds);
const editableMap = await editableFor(
  sliceIds.filter((id) => {
    const cls = byId.get(id)?.className;
    return cls === "ENGINE.ModelMeshNode" || cls === "ENGINE.MeshNode";
  }),
);

const ancestorIds = new Set();
for (const node of slice) {
  let current = node;
  while (current?.parentId) {
    ancestorIds.add(current.parentId);
    current = byId.get(current.parentId);
  }
}
const ancestorDetails = await detailsFor([...ancestorIds]);

const records = [];
for (let index = 0; index < slice.length; index += 1) {
  const node = slice[index];
  const details = detailMap.get(node.id);
  if (!details) throw new Error(`Missing details for ${node.id}`);
  const transform = worldTransform(details);
  const parent = node.parentId ? byId.get(node.parentId) : null;
  const parentDetails = node.parentId
    ? ancestorDetails.get(node.parentId) || detailMap.get(node.parentId)
    : null;

  let modelUrl = null;
  let geometry = null;
  let material = null;
  if (node.className === "ENGINE.ModelMeshNode") {
    modelUrl = propertyValue(editableMap.get(node.id), "modelUrl");
    if (typeof modelUrl !== "string" || !modelUrl) {
      throw new Error(`Missing modelUrl for ${node.id} (${node.name})`);
    }
  } else if (node.className === "ENGINE.MeshNode") {
    const editable = editableMap.get(node.id);
    geometry = propertyValue(editable, "geometry") ?? details.geometry ?? null;
    material = propertyValue(editable, "material") ?? details.material ?? null;
    if (!geometry) throw new Error(`Missing geometry for ${node.id} (${node.name})`);
  }

  // Under the actor-ancestry rule, every mirrored parent is itself mirrored,
  // so bridgeParentId equals parentId (or null at root).
  const bridgeParentId =
    parent && isMirrorableAncestorClass(parent.className) ? parent.id : null;

  records.push({
    id: node.id,
    name: node.name,
    className: node.className,
    parentId: node.parentId || null,
    bridgeParentId,
    siblingIndex: siblingIndexOf(node),
    outlinePath: outlinePathOf(node),
    outlineOrder: OFFSET + index,
    group: parent?.name || node.name,
    groupId: parent?.id || node.id,
    position: transform.position,
    rotation: transform.rotation,
    scale: transform.scale,
    parentTransform: parentDetails ? worldTransform(parentDetails) : null,
    visible: details.visible !== false,
    modelUrl,
    geometry,
    material,
  });
}

const inventoryHash = hashInventory(sortedEligible.map((node) => node.id));
const chunk = {
  format: "genesys-blender-bridge-chunk",
  version: 1,
  sourceScene: state.activeScenePath,
  totalNodes: byId.size,
  total,
  offset: OFFSET,
  count: records.length,
  inventoryHash,
  rootOrderSource,
  skippedCount: Object.values(skippedByBlockingClass).reduce((a, b) => a + b, 0),
  skippedByBlockingClass,
  records,
};

// Compact transfer: gzip+base64 keeps large primitive payloads under MCP limits.
function toBase64(bytes) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? alphabet[triplet & 63] : "=";
  }
  return output;
}

const encoded = new TextEncoder().encode(JSON.stringify(chunk));
const stream = new CompressionStream("gzip");
const writer = stream.writable.getWriter();
writer.write(encoded);
writer.close();
const compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());

return {
  format: "genesys-blender-bridge-chunk-compressed",
  version: 1,
  encoding: "gzip+base64",
  sourceScene: state.activeScenePath,
  offset: OFFSET,
  count: records.length,
  total,
  inventoryHash,
  payload: toBase64(compressed),
};
