// Genesys MCP run_script body for a reviewed Blender bridge delta.
// Replace DELTA with the parsed bridge-delta JSON. Keep APPLY=false for preview.

const DELTA = null;
const APPLY = false;
// Deletions are never inferred. Embed only IDs the user explicitly approved,
// each as { id, name, className }, so a stale ID cannot delete the wrong node.
const DELETIONS = [];
const POSITION_EPSILON = 1e-5;
const SCALE_EPSILON = 1e-5;
const ROTATION_EPSILON = 1e-3;

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

// Quaternion comparison, so equivalent Euler representations of one orientation
// do not register as changes or conflicts.
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
    distance(left.position, right.position) > POSITION_EPSILON ||
    distance(left.scale, right.scale) > SCALE_EPSILON ||
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
for (let index = 0; index < ids.length; index += 200) {
  const result = await genesys.queryNode({
    operation: "getDetails",
    componentIds: ids.slice(index, index + 200),
  });
  for (const component of result.components || []) {
    detailsById.set(component.id, component);
  }
}

const conflicts = [];
const approvedChanges = [];
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
  const result = await genesys.queryNode({
    operation: "getEditableProperties",
    componentIds: approvedChanges
      .slice(index, index + 20)
      .map((change) => change.id),
  });
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

const approvedDeletions = [];
for (const deletion of DELETIONS) {
  const current = detailsById.get(deletion.id);
  if (!current || current.error) {
    conflicts.push({ id: deletion.id, reason: "delete target already gone" });
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
  updates: approvedChanges.length,
  additions: approvedAdditions.length,
  deletions: approvedDeletions.map((deletion) => deletion.name),
  conflicts,
  unsupported: DELTA.unsupported || [],
  missingBaselineIds: DELTA.missingBaselineIds || [],
  updateSamples: approvedChanges.slice(0, 20).map((change) => change.name),
  additionSamples: approvedAdditions
    .slice(0, 20)
    .map((addition) => addition.name),
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
    const result = await genesys.queryNode({ operation: "find", query: stem });
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
for (let index = 0; index < verifyIds.length; index += 200) {
  const result = await genesys.queryNode({
    operation: "getDetails",
    componentIds: verifyIds.slice(index, index + 200),
  });
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
  created,
  deleted,
  verifiedTransforms: verifyIds.length,
  verifiedDeletions: deleted.length,
  saved:
    approvedChanges.length > 0 || created.length > 0 || deleted.length > 0,
};
