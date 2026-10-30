// Genesys MCP run_script body for a reviewed Blender bridge delta (one batch of it).
// Generate the bodies with `python3 <this-skill>/scripts/make_bridge_scripts.py apply ...`
// (it splits the delta into batches under the code-size and time limits and injects DELTA,
// APPLY and DELETIONS), or paste the parsed delta into DELTA by hand. APPLY=false previews.
// Re-running a batch is safe: transforms already at their target and additions that already
// exist (same model, parent and world transform) are reported and skipped, never duplicated.

const DELTA = null;
const APPLY = false;
// Deletions are never inferred. Embed only IDs the user explicitly approved,
// each as { id, name, className }, so a stale ID cannot delete the wrong node.
const DELETIONS = [];
// max(1e-4, 1e-6 * |value|): MCP values are rounded decimals, so a fixed 1e-5 sat in the noise.
const POSITION_EPSILON = 1e-4;
const SCALE_EPSILON = 1e-4;
const RELATIVE_EPSILON = 1e-6;
const ROTATION_EPSILON = 1e-3;
const SAMPLE = 20; // arrays in the response stay short; counts carry the totals

if (!DELTA || DELTA.format !== "genesys-blender-bridge-delta") {
  throw new Error("Embed a valid genesys-blender-bridge-delta in DELTA");
}

const state = await genesys.queryEditor({ operation: "getState" });
if (!state.editorReady) {
  throw new Error(
    `Editor not ready: ${(state.blockingReasons || []).join("; ")}`,
  );
}
if (state.documentType !== "scene" || state.activeScenePath !== DELTA.sourceScene) {
  throw new Error(
    `Open ${DELTA.sourceScene} before applying this Blender delta`,
  );
}
if (state.playMode?.isActive || state.playMode?.isStarting) {
  throw new Error("Stop play mode before applying a Blender delta");
}

function vector3(value, fallback) {
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

function transform(component) {
  return {
    position: vector3(component?.transform?.position, [0, 0, 0]),
    rotation: vector3(component?.transform?.rotation, [0, 0, 0]),
    scale: vector3(component?.transform?.scale, [1, 1, 1]),
  };
}

function distance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function epsilonFor(base, ...vectors) {
  const magnitude = Math.max(0, ...vectors.flat().map((value) => Math.abs(Number(value) || 0)));
  return Math.max(base, RELATIVE_EPSILON * magnitude);
}

// A result over the MCP response limit comes back cut to 100 items with a _meta block.
function assertComplete(label, result) {
  if (result?._meta || result?.truncated === true) {
    throw new Error(`${label} result was truncated by the MCP response limit; use smaller batches`);
  }
  return result;
}

function quaternionXYZ(rotation) {
  const [x, y, z] = rotation;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// Genesys rotations are three.js Euler 'XYZ' (radians); quaternionXYZ is three's own
// Quaternion.setFromEuler for that order. Comparing quaternions means equivalent Euler
// representations of one orientation do not register as changes or conflicts.
function rotationError(left, right) {
  const a = quaternionXYZ(left);
  const b = quaternionXYZ(right);
  const dot = Math.min(
    1,
    Math.max(
      0,
      Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]),
    ),
  );
  return 2 * Math.acos(dot);
}

function transformChanged(left, right) {
  return (
    distance(left.position, right.position) > epsilonFor(POSITION_EPSILON, left.position, right.position) ||
    distance(left.scale, right.scale) > epsilonFor(SCALE_EPSILON, left.scale, right.scale) ||
    rotationError(left.rotation, right.rotation) > ROTATION_EPSILON
  );
}

function propertyTransform(value) {
  return {
    position: { x: value.position[0], y: value.position[1], z: value.position[2] },
    rotation: { x: value.rotation[0], y: value.rotation[1], z: value.rotation[2] },
    scale: { x: value.scale[0], y: value.scale[1], z: value.scale[2] },
  };
}

function supportedTransformClass(className) {
  return (
    className === "ENGINE.SceneNode" ||
    className === "ENGINE.MeshNode" ||
    className === "ENGINE.ModelMeshNode" ||
    /^ENGINE\..*LightNode$/.test(className)
  );
}

const changes = DELTA.changes || [];
const additions = DELTA.additions || [];
const requestedIds = new Set();
for (const change of changes) {
  requestedIds.add(change.id);
  if (change.parentId) requestedIds.add(change.parentId);
}
for (const addition of additions) {
  const parentId = addition.parentId || null;
  if (parentId) requestedIds.add(parentId);
}
for (const deletion of DELETIONS) {
  requestedIds.add(deletion.id);
}

const detailsById = new Map();
const ids = [...requestedIds];
for (let index = 0; index < ids.length; index += 50) {
  const result = assertComplete(
    "getDetails",
    await genesys.queryNode({
      operation: "getDetails",
      componentIds: ids.slice(index, index + 50),
    }),
  );
  for (const component of result.components || []) {
    detailsById.set(component.id, component);
  }
}

const conflicts = [];
const approvedChanges = [];
const alreadyApplied = [];
for (const change of changes) {
  if (!supportedTransformClass(change.className)) {
    conflicts.push({ id: change.id, reason: "unsupported class" });
    continue;
  }
  const current = detailsById.get(change.id);
  if (!current || current.error) {
    conflicts.push({ id: change.id, reason: "node no longer exists" });
    continue;
  }
  if (
    current.name !== change.name ||
    current.className !== change.className ||
    (current.parentId || null) !== (change.parentId || null)
  ) {
    conflicts.push({ id: change.id, reason: "node identity or parent changed" });
    continue;
  }
  if (!transformChanged(transform(current), change.desiredWorld)) {
    // Already at the target: an earlier run of this batch got here. Nothing to write.
    alreadyApplied.push(change.name);
    continue;
  }
  if (transformChanged(transform(current), change.baselineWorld)) {
    conflicts.push({ id: change.id, reason: "node changed in Sandbox" });
    continue;
  }
  if (change.parentId && change.baselineParentWorld) {
    const parent = detailsById.get(change.parentId);
    if (
      !parent ||
      transformChanged(transform(parent), change.baselineParentWorld)
    ) {
      conflicts.push({ id: change.id, reason: "parent changed in Sandbox" });
      continue;
    }
  }
  approvedChanges.push(change);
}

const editableById = new Map();
for (let index = 0; index < approvedChanges.length; index += 20) {
  const result = assertComplete(
    "getEditableProperties",
    await genesys.queryNode({
      operation: "getEditableProperties",
      componentIds: approvedChanges
        .slice(index, index + 20)
        .map((change) => change.id),
    }),
  );
  for (const component of result.components || []) {
    editableById.set(
      component.id,
      new Set((component.editableProperties || []).map((property) => property.path)),
    );
  }
}
for (const change of approvedChanges) {
  const paths = editableById.get(change.id) || new Set();
  for (const required of ["position", "rotation", "scale"]) {
    if (!paths.has(required)) {
      throw new Error(`${change.id} has no editable ${required} property`);
    }
  }
}

const approvedAdditions = [];
for (const addition of additions) {
  if (
    typeof addition.modelUrl !== "string" ||
    !/^@(project|engine)\//.test(addition.modelUrl)
  ) {
    conflicts.push({ name: addition.name, reason: "invalid modelUrl" });
    continue;
  }
  // A null parent is expected for library-grid instances and means "scene root".
  const parentId = addition.parentId || null;
  if (parentId) {
    const parent = detailsById.get(parentId);
    if (!parent || parent.className !== "ENGINE.SceneNode") {
      conflicts.push({
        name: addition.name,
        reason: "addition parent is not an exact ENGINE.SceneNode",
      });
      continue;
    }
  }
  approvedAdditions.push({ ...addition, targetParentId: parentId });
}

// Idempotent re-apply: an addition whose model already sits under the same parent at the same
// world transform was created by an earlier run of this batch. Skip it instead of duplicating.
const existingAdditions = [];
if (approvedAdditions.length) {
  const tree = assertComplete(
    "getTree(ModelMeshNode)",
    await genesys.queryNode({ operation: "getTree", query: "ENGINE.ModelMeshNode", limit: 500 }),
  );
  if ((tree.nodes || []).length >= 500) {
    throw new Error("500+ ModelMeshNodes: cannot prove additions are not already applied");
  }
  const parents = new Set(approvedAdditions.map((addition) => addition.targetParentId));
  const candidates = (tree.nodes || []).filter(
    (node) => node.className === "ENGINE.ModelMeshNode" && parents.has(node.parentId || null),
  );
  const candidateDetails = new Map();
  for (let index = 0; index < candidates.length; index += 50) {
    const result = assertComplete(
      "getDetails",
      await genesys.queryNode({
        operation: "getDetails",
        componentIds: candidates.slice(index, index + 50).map((node) => node.id),
      }),
    );
    for (const component of result.components || []) {
      if (component?.id && !component.error) candidateDetails.set(component.id, component);
    }
  }
  const usedCandidates = new Set();
  const stillNeeded = [];
  for (const addition of approvedAdditions) {
    const near = candidates.filter(
      (node) =>
        !usedCandidates.has(node.id) &&
        (node.parentId || null) === addition.targetParentId &&
        candidateDetails.has(node.id) &&
        !transformChanged(transform(candidateDetails.get(node.id)), addition.desiredWorld),
    );
    let match = null;
    if (near.length) {
      const editable = assertComplete(
        "getEditableProperties",
        await genesys.queryNode({ operation: "getEditableProperties", componentIds: near.slice(0, 20).map((node) => node.id) }),
      );
      for (const component of editable.components || []) {
        const url = (component.editableProperties || []).find((property) => property.path === "modelUrl")?.value;
        if (url === addition.modelUrl && !usedCandidates.has(component.id)) {
          match = component.id;
          break;
        }
      }
    }
    if (match) {
      usedCandidates.add(match);
      existingAdditions.push({ blenderName: addition.name, componentId: match });
    } else {
      stillNeeded.push(addition);
    }
  }
  approvedAdditions.length = 0;
  approvedAdditions.push(...stillNeeded);
}

const approvedDeletions = [];
for (const deletion of DELETIONS) {
  const current = detailsById.get(deletion.id);
  if (!current || current.error) {
    // Gone already: an earlier run of this batch deleted it (re-running is safe).
    alreadyApplied.push(deletion.name);
    continue;
  }
  if (current.name !== deletion.name || current.className !== deletion.className) {
    conflicts.push({ id: deletion.id, reason: "delete target identity mismatch" });
    continue;
  }
  if (!supportedTransformClass(current.className)) {
    conflicts.push({ id: deletion.id, reason: "delete target class unsupported" });
    continue;
  }
  if ((current.childIds || []).length) {
    conflicts.push({ id: deletion.id, reason: "delete target has children" });
    continue;
  }
  approvedDeletions.push({ id: deletion.id, name: current.name });
}

const preview = {
  scenePath: DELTA.sourceScene,
  batch: DELTA.batch ?? null,
  updates: approvedChanges.length,
  additions: approvedAdditions.length,
  alreadyApplied: alreadyApplied.length + existingAdditions.length,
  deletions: approvedDeletions.map((deletion) => deletion.name).slice(0, SAMPLE),
  deletionCount: approvedDeletions.length,
  conflictCount: conflicts.length,
  conflicts: conflicts.slice(0, SAMPLE),
  unsupportedCount: (DELTA.unsupported || []).length,
  unsupported: (DELTA.unsupported || []).slice(0, SAMPLE),
  missingBaselineIdCount: (DELTA.missingBaselineIds || []).length,
  updateSamples: approvedChanges.slice(0, SAMPLE).map((change) => change.name),
  additionSamples: approvedAdditions
    .slice(0, SAMPLE)
    .map((addition) => addition.name),
  alreadyAppliedSamples: [...alreadyApplied, ...existingAdditions.map((entry) => entry.blenderName)].slice(0, SAMPLE),
  wouldSave:
    APPLY &&
    (approvedChanges.length > 0 ||
      approvedAdditions.length > 0 ||
      approvedDeletions.length > 0),
};
if (!APPLY) return preview;
if (conflicts.length) {
  throw new Error(`Resolve ${conflicts.length} bridge conflicts before applying`);
}

for (const change of approvedChanges) {
  await genesys.actionNode({
    action: "setProperties",
    componentId: change.id,
    properties: propertyTransform(change.desiredLocal),
  });
}

const namesByStem = new Map();

async function uniqueName(modelUrl) {
  const stem = (modelUrl.split("/").pop() || "Model").replace(/\.glb$/i, "");
  let usedNames = namesByStem.get(stem);
  if (!usedNames) {
    const result = assertComplete(
      "find",
      await genesys.queryNode({ operation: "find", query: stem, limit: 500 }),
    );
    if ((result.nodes || []).length >= 500) {
      throw new Error(`Cannot prove a unique node name for asset stem ${stem}`);
    }
    usedNames = new Set((result.nodes || []).map((node) => node.name));
    namesByStem.set(stem, usedNames);
  }
  let index = 1;
  let candidate = `${stem}_${String(index).padStart(2, "0")}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${stem}_${String(index).padStart(2, "0")}`;
  }
  usedNames.add(candidate);
  return candidate;
}

const created = [];
for (const addition of approvedAdditions) {
  const added = await genesys.actionNode({
    action: "add",
    className: "ENGINE.ModelMeshNode",
    parentComponentId: addition.targetParentId,
  });
  const componentId =
    added.componentId ||
    added.createdComponentId ||
    added.affectedComponentIds?.[0];
  if (!componentId) throw new Error(`Add returned no id for ${addition.name}`);
  const additionTransform = addition.targetParentId
    ? addition.desiredLocal
    : addition.desiredWorld;
  await genesys.actionNode({
    action: "setProperties",
    componentId,
    properties: {
      modelUrl: addition.modelUrl,
      ...propertyTransform(additionTransform),
    },
  });
  // Naming is cosmetic; a rejected `name` path must not abort the batch.
  const name = await uniqueName(addition.modelUrl);
  let named = false;
  try {
    await genesys.actionNode({
      action: "setProperties",
      componentId,
      properties: { name },
    });
    named = true;
  } catch {
    named = false;
  }
  created.push({ blenderName: addition.name, componentId, name, named });
}

const verifyIds = [
  ...approvedChanges.map((change) => change.id),
  ...created.map((entry) => entry.componentId),
];
const verifiedById = new Map();
for (let index = 0; index < verifyIds.length; index += 50) {
  const result = assertComplete(
    "getDetails",
    await genesys.queryNode({
      operation: "getDetails",
      componentIds: verifyIds.slice(index, index + 50),
    }),
  );
  for (const component of result.components || []) {
    if (component?.id && !component.error) verifiedById.set(component.id, component);
  }
}
const verificationFailures = [];
for (const change of approvedChanges) {
  const current = verifiedById.get(change.id);
  if (!current || transformChanged(transform(current), change.desiredWorld)) {
    verificationFailures.push(change.name);
  }
}
for (let index = 0; index < created.length; index += 1) {
  const entry = created[index];
  const addition = approvedAdditions[index];
  const current = verifiedById.get(entry.componentId);
  if (!current || transformChanged(transform(current), addition.desiredWorld)) {
    verificationFailures.push(entry.name);
  }
}
if (verificationFailures.length) {
  throw new Error(
    `Transform verification failed for: ${verificationFailures.join(", ")}`,
  );
}

const deleted = [];
if (approvedDeletions.length) {
  await genesys.actionNode({
    action: "delete",
    componentIds: approvedDeletions.map((deletion) => deletion.id),
  });
  deleted.push(...approvedDeletions.map((deletion) => deletion.name));
  const result = await genesys.queryNode({
    operation: "getDetails",
    componentIds: approvedDeletions.map((deletion) => deletion.id),
  });
  const stillPresent = (result.components || []).filter(
    (component) => component && !component.error,
  );
  if (stillPresent.length) {
    throw new Error(
      `Deletion verification failed for: ${stillPresent
        .map((component) => component.name || component.id)
        .join(", ")}`,
    );
  }
}

if (approvedChanges.length || created.length || deleted.length) {
  await genesys.actionScene({ action: "save" });
}
return {
  ...preview,
  applied: true,
  createdCount: created.length,
  created: created.slice(0, SAMPLE),
  deleted: deleted.slice(0, SAMPLE),
  verifiedTransforms: verifyIds.length,
  verifiedDeletions: deleted.length,
  saved:
    approvedChanges.length > 0 || created.length > 0 || deleted.length > 0,
};
