/**
 * Browser-side measurement: structure counts, scene bounds and ray probes.
 * Everything here is deterministic for a given GLB; interpretation happens later.
 */

import * as THREE from 'three';

import type {
  Base, ClipInfo, FaceProbe, Grid, MaterialInfo, Measurement, Opening, SideCell, Structure, Surface,
  TextureInfo, TopCell, Vec3,
} from './types.js';

/** Cells along the longest axis of each probe grid. */
const GRID_RESOLUTION = 24;
/** A surface whose normal is within this angle of straight up counts as standable. */
const WALKABLE_DEG = 35;
/** Narrowest patch a person can stand on. */
const PERSON_WIDTH = 0.5;
/** Narrowest patch a small prop or creature can sit on. */
const PERCH_WIDTH = 0.3;
/** A perch must be flatter than this, so a creature's back or a leaf is not one. */
const PERCH_MAX_DEG = 15;
/** ...and vary in height by no more than this. */
const PERCH_LEVEL = 0.15;
/** Cells whose underside is within this share of the height of the lowest point make up the base. */
const BASE_BAND = 0.1;
/** A side band must lie in one plane to within this much (scaled by size, capped here). */
const JOIN_MAX_TOL = 0.15;
/** A standable deck that ends within this distance of a side joins there (a lip may stick out past it). */
const DECK_REACH = 0.25;
/** ...and must run along at least this share of that side. */
const DECK_SPAN = 0.7;
/** ...and have at least this much of the model above it (rails, posts, walls), so a model's own top is not a deck. */
const DECK_HEADROOM = 0.85;
/** An axis thinner than this is a card: both of its faces are broad faces, never joins. */
const CARD_THICKNESS = 0.1;
/** An axis thinner than this share of the face width is a slab: its two full faces are broad faces. */
const SLAB_RATIO = 0.35;

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'bumpMap',
] as const;

export function measure(root: THREE.Object3D, clips: THREE.AnimationClip[]): Measurement {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o as THREE.Mesh);
  });

  const structure = measureStructure(root, meshes, clips);
  const box = new THREE.Box3().setFromObject(root, true);
  if (box.isEmpty()) throw new Error('GLB has no visible mesh geometry');
  const min = toVec(box.min);
  const max = toVec(box.max);
  const size = toVec(box.getSize(new THREE.Vector3()));
  const center = toVec(box.getCenter(new THREE.Vector3()));

  // Probe both faces of every triangle; restore the authored sides afterwards for the render.
  const sides = new Map<THREE.Material, THREE.Side>();
  for (const mat of allMaterials(meshes)) {
    sides.set(mat, mat.side);
    mat.side = THREE.DoubleSide;
  }
  const probe = new Prober(meshes);
  const top = probeTop(probe, min, max, size);
  const alongZ = probeSide(probe, 'Z', min, max, size);
  const alongX = probeSide(probe, 'X', min, max, size);
  for (const [mat, side] of sides) mat.side = side;

  const cellArea = top.cell * top.cell;
  let hitCells = 0;
  let contactCells = 0;
  let filled = 0;
  const contactTol = Math.max(0.02, size[1] * 0.02);
  const baseTol = Math.max(contactTol, size[1] * BASE_BAND);
  let base: Base | null = null;
  let footprint = 0;
  for (let r = 0; r < top.rows; r++) {
    for (let col = 0; col < top.cols; col++) {
      const c = top.cells[r][col];
      if (c.top === null) continue;
      hitCells++;
      footprint += clippedArea(top, r, col, min, max);
      if (c.bottom !== null) {
        filled += (c.top - c.bottom) * cellArea;
        if (c.bottom - min[1] <= contactTol) contactCells++;
        if (c.bottom - min[1] <= baseTol) {
          const x = top.colStart + col * top.cell;
          const z = top.rowStart + r * top.cell;
          base ??= { xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity, area: 0 };
          base.xMin = Math.min(base.xMin, x);
          base.xMax = Math.max(base.xMax, x + top.cell);
          base.zMin = Math.min(base.zMin, z);
          base.zMax = Math.max(base.zMax, z + top.cell);
          base.area += cellArea;
        }
      }
    }
  }
  // Clip to the bounds: edge cells overhang them.
  if (base) {
    base.xMin = Math.max(base.xMin, min[0]);
    base.xMax = Math.min(base.xMax, max[0]);
    base.zMin = Math.max(base.zMin, min[2]);
    base.zMax = Math.min(base.zMax, max[2]);
  }
  const boxVolume = Math.max(size[0] * size[1] * size[2], 1e-9);
  const surfaces = findSurfaces(top, min, max);

  return {
    structure,
    min, max, size, center,
    top, alongZ, alongX,
    footprintArea: footprint,
    contactFraction: hitCells ? contactCells / hitCells : 0,
    base,
    volumeFill: Math.min(1, filled / boxVolume),
    surfaces,
    openings: [...findOpenings(alongZ, 'Z'), ...findOpenings(alongX, 'X')],
    faces: markDeckEdges(probeFaces(alongZ, alongX, size), surfaces, min, max, size),
    symmetry: findSymmetry(top, size[1]),
  };
}

// ---------------------------------------------------------------------------
// Structure

function measureStructure(root: THREE.Object3D, meshes: THREE.Mesh[], clips: THREE.AnimationClip[]): Structure {
  let nodes = 0;
  const namedNodes: string[] = [];
  root.traverse((o) => {
    if (o === root) return;
    nodes++;
    if (!(o as THREE.Mesh).isMesh && o.name && !(o as THREE.Bone).isBone && namedNodes.length < 24) {
      namedNodes.push(o.name);
    }
  });

  let drawCalls = 0;
  let triangles = 0;
  let vertices = 0;
  let skinnedMeshes = 0;
  let morphTargets = 0;
  const bones = new Set<THREE.Bone>();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    vertices += pos.count;
    triangles += (geo.index ? geo.index.count : pos.count) / 3;
    drawCalls += Math.max(1, geo.groups.length);
    morphTargets = Math.max(morphTargets, geo.morphAttributes.position?.length ?? 0);
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinnedMeshes++;
      for (const b of skinned.skeleton.bones) bones.add(b);
    }
  }

  const materials: MaterialInfo[] = [];
  const textures = new Map<THREE.Texture, TextureInfo>();
  for (const mat of allMaterials(meshes)) {
    const m = mat as THREE.MeshStandardMaterial;
    const maps: string[] = [];
    for (const slot of TEXTURE_SLOTS) {
      const tex = (m as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
      if (!tex) continue;
      maps.push(slot);
      const img = tex.image as { width?: number; height?: number } | undefined;
      const info = textures.get(tex) ?? { name: tex.name, width: img?.width ?? 0, height: img?.height ?? 0, slots: [] };
      info.slots.push(slot);
      textures.set(tex, info);
    }
    materials.push({
      name: mat.name,
      type: mat.type,
      vertexColors: mat.vertexColors,
      transparent: mat.transparent,
      alphaTest: mat.alphaTest,
      doubleSided: mat.side === THREE.DoubleSide,
      emissive: !!m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b > 0 || !!m.emissiveMap),
      maps,
    });
  }

  return {
    nodes,
    meshes: meshes.length,
    drawCalls,
    triangles: Math.round(triangles),
    vertices,
    skinnedMeshes,
    bones: bones.size,
    morphTargets,
    materials,
    textures: [...textures.values()],
    namedNodes,
    clips: clips.map((c) => describeClip(c, root)),
  };
}

function describeClip(clip: THREE.AnimationClip, root: THREE.Object3D): ClipInfo {
  const targets = new Set<string>();
  let skeletal = false;
  let maxTravel = 0;
  for (const track of clip.tracks) {
    const nodeName = track.name.slice(0, track.name.lastIndexOf('.'));
    targets.add(nodeName);
    const node = root.getObjectByName(nodeName);
    if ((node as THREE.Bone | undefined)?.isBone) skeletal = true;
    if (track.name.endsWith('.position') && track.values.length >= 6) {
      const v = track.values;
      for (let i = 3; i < v.length; i += 3) {
        maxTravel = Math.max(maxTravel, Math.hypot(v[i] - v[0], v[i + 1] - v[1], v[i + 2] - v[2]));
      }
    }
  }
  return {
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.length,
    targets: [...targets],
    skeletal,
    maxTravel,
  };
}

function allMaterials(meshes: THREE.Mesh[]): Set<THREE.Material> {
  const set = new Set<THREE.Material>();
  for (const mesh of meshes) {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) set.add(m);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Ray probes

interface Hit {
  point: THREE.Vector3;
  /** Normal facing back toward the ray origin, world space. */
  normal: THREE.Vector3;
}

class Prober {
  private readonly ray = new THREE.Raycaster();
  private readonly normalMatrix = new THREE.Matrix3();

  constructor(private readonly meshes: THREE.Mesh[]) {}

  first(origin: THREE.Vector3, dir: THREE.Vector3, far: number): Hit | null {
    this.ray.set(origin, dir);
    this.ray.far = far;
    const hit = this.ray.intersectObjects(this.meshes, false)[0];
    if (!hit) return null;
    const normal = new THREE.Vector3(0, 1, 0);
    if (hit.face) {
      this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      normal.copy(hit.face.normal).applyMatrix3(this.normalMatrix).normalize();
      if (normal.dot(dir) > 0) normal.negate();
    }
    return { point: hit.point.clone(), normal };
  }
}

/** Square cells over two axes, centred on the bounds so the grid overhangs evenly. */
function layout(extentA: number, extentB: number, startA: number, startB: number) {
  const longest = Math.max(extentA, extentB, 1e-6);
  const cell = longest / GRID_RESOLUTION;
  const cols = Math.max(1, Math.ceil(extentA / cell - 1e-6));
  const rows = Math.max(1, Math.ceil(extentB / cell - 1e-6));
  return {
    cell, cols, rows,
    colStart: startA - (cols * cell - extentA) / 2,
    rowStart: startB - (rows * cell - extentB) / 2,
  };
}

function probeTop(probe: Prober, min: Vec3, max: Vec3, size: Vec3): Grid<TopCell> {
  // Columns run along X, rows along Z.
  const g = layout(size[0], size[2], min[0], min[2]);
  const far = size[1] + 2;
  const down = new THREE.Vector3(0, -1, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const cells: TopCell[][] = [];
  for (let r = 0; r < g.rows; r++) {
    const row: TopCell[] = [];
    const z = g.rowStart + (r + 0.5) * g.cell;
    for (let c = 0; c < g.cols; c++) {
      const x = g.colStart + (c + 0.5) * g.cell;
      const t = probe.first(new THREE.Vector3(x, max[1] + 1, z), down, far);
      const b = t ? probe.first(new THREE.Vector3(x, min[1] - 1, z), up, far) : null;
      row.push({ top: t ? t.point.y : null, bottom: b ? b.point.y : null, normalUp: t ? t.normal.y : 0 });
    }
    cells.push(row);
  }
  return { ...g, cells };
}

function probeSide(probe: Prober, along: 'X' | 'Z', min: Vec3, max: Vec3, size: Vec3): Grid<SideCell> {
  // Columns run along the crossing horizontal axis, rows along Y.
  const a = along === 'Z' ? 0 : 2;
  const d = along === 'Z' ? 2 : 0;
  const g = layout(size[a], size[1], min[a], min[1]);
  const far = size[d] + 2;
  const neg = new THREE.Vector3();
  const pos = new THREE.Vector3();
  neg.setComponent(d, -1);
  pos.setComponent(d, 1);
  const cells: SideCell[][] = [];
  for (let r = 0; r < g.rows; r++) {
    const row: SideCell[] = [];
    const y = g.rowStart + (r + 0.5) * g.cell;
    for (let c = 0; c < g.cols; c++) {
      const u = g.colStart + (c + 0.5) * g.cell;
      const fromMax = new THREE.Vector3(0, y, 0).setComponent(a, u).setComponent(d, max[d] + 1);
      const fromMin = new THREE.Vector3(0, y, 0).setComponent(a, u).setComponent(d, min[d] - 1);
      const h1 = probe.first(fromMax, neg, far);
      const h2 = h1 ? probe.first(fromMin, pos, far) : null;
      row.push({
        hit: !!h1,
        depthFromMax: h1 ? max[d] - h1.point.getComponent(d) : null,
        depthFromMin: h2 ? h2.point.getComponent(d) - min[d] : null,
      });
    }
    cells.push(row);
  }
  return { ...g, cells };
}

// ---------------------------------------------------------------------------
// Derived shape facts

/** Connected patches of standable top surface: person-wide ones largest first, then perches highest first. */
function findSurfaces(top: Grid<TopCell>, min: Vec3, max: Vec3): Surface[] {
  const minUp = Math.cos(THREE.MathUtils.degToRad(WALKABLE_DEG));
  const maxStep = Math.max(0.25, top.cell * 0.75);
  const seen = top.cells.map((row) => row.map(() => false));
  const walkable = (r: number, c: number) => {
    const cell = top.cells[r][c];
    return cell.top !== null && cell.normalUp >= minUp;
  };
  const cellArea = top.cell * top.cell;
  const footprint = top.cells.flat().filter((c) => c.top !== null).length;
  const surfaces: Surface[] = [];

  for (let r0 = 0; r0 < top.rows; r0++) {
    for (let c0 = 0; c0 < top.cols; c0++) {
      if (seen[r0][c0] || !walkable(r0, c0)) continue;
      const stack: [number, number][] = [[r0, c0]];
      const members: [number, number][] = [];
      seen[r0][c0] = true;
      while (stack.length) {
        const [r, c] = stack.pop()!;
        members.push([r, c]);
        const h = top.cells[r][c].top!;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= top.rows || nc >= top.cols || seen[nr][nc] || !walkable(nr, nc)) continue;
          if (Math.abs(top.cells[nr][nc].top! - h) > maxStep) continue;
          seen[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
      if (members.length < 3) continue;
      const summary = summariseSurface(top, members, cellArea);
      // Edge cells overhang the bounds; a surface never reaches past the model.
      summary.xMin = Math.max(summary.xMin, min[0]);
      summary.xMax = Math.min(summary.xMax, max[0]);
      summary.zMin = Math.max(summary.zMin, min[2]);
      summary.zMax = Math.min(summary.zMax, max[2]);
      // Each cell is within the walkable angle, but a patch of leaves or blades can still tilt more overall.
      const personWide = summary.slopeDeg <= WALKABLE_DEG && hasWideCore(members, top.cell, PERSON_WIDTH);
      // A perch can be small (a wall-top post), so it skips the share-of-footprint rule, but it must be
      // flat and level: a creature's back or a cluster of spike tips is not one.
      const perch = !personWide && summary.slopeDeg <= PERCH_MAX_DEG && summary.maxHeight - summary.minHeight <= PERCH_LEVEL
        && hasWideCore(members, top.cell, PERCH_WIDTH);
      if (!perch && members.length < footprint * 0.02) continue;
      surfaces.push({ ...summary, personWide, perch });
    }
  }
  const rank = (s: Surface) => (s.personWide ? 0 : s.perch ? 1 : 2);
  return surfaces
    .sort((a, b) => rank(a) - rank(b) || (a.perch ? b.maxHeight - a.maxHeight : b.area - a.area))
    .slice(0, 8);
}

/**
 * True when at least one cell of the patch has patch cells all around it out to half of `width`,
 * so rail tops, ridges and strands (long but narrow) do not count as somewhere to stand.
 */
function hasWideCore(members: [number, number][], cell: number, width: number): boolean {
  // The core is 2·reach + 1 cells across; allow 10% for the grid not lining up with the edges, so a
  // 0.45 m cell does not demand a 1.35 m core for a 0.5 m person.
  const reach = Math.max(0, Math.ceil((width * 0.9 / cell - 1) / 2));
  const inPatch = new Set(members.map(([r, c]) => `${r},${c}`));
  // Cells already at least that wide: one ray can hit a strand far thinner than its cell, so ask
  // for a 2 × 2 block instead of a single cell.
  if (reach === 0) {
    return members.some(([r, c]) => inPatch.has(`${r + 1},${c}`) && inPatch.has(`${r},${c + 1}`) && inPatch.has(`${r + 1},${c + 1}`));
  }
  return members.some(([r, c]) => {
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        if (!inPatch.has(`${r + dr},${c + dc}`)) return false;
      }
    }
    return true;
  });
}

function summariseSurface(top: Grid<TopCell>, members: [number, number][], cellArea: number): Omit<Surface, 'personWide' | 'perch'> {
  let minH = Infinity;
  let maxH = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  // Least-squares plane h = a + b·x + c·z.
  let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (const [r, c] of members) {
    const h = top.cells[r][c].top!;
    const x = top.colStart + (c + 0.5) * top.cell;
    const z = top.rowStart + (r + 0.5) * top.cell;
    minH = Math.min(minH, h);
    maxH = Math.max(maxH, h);
    xMin = Math.min(xMin, x - top.cell / 2);
    xMax = Math.max(xMax, x + top.cell / 2);
    zMin = Math.min(zMin, z - top.cell / 2);
    zMax = Math.max(zMax, z + top.cell / 2);
    n++; sx += x; sz += z; sh += h; sxx += x * x; szz += z * z; sxz += x * z; sxh += x * h; szh += z * h;
  }
  const mx = sx / n, mz = sz / n, mh = sh / n;
  const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz;
  const cxh = sxh / n - mx * mh, czh = szh / n - mz * mh;
  const det = cxx * czz - cxz * cxz;
  let b = 0, c = 0;
  if (Math.abs(det) > 1e-9) {
    b = (cxh * czz - czh * cxz) / det;
    c = (czh * cxx - cxh * cxz) / det;
  } else if (cxx > 1e-9) {
    b = cxh / cxx;
  } else if (czz > 1e-9) {
    c = czh / czz;
  }
  const grade = Math.hypot(b, c);
  const flat = maxH - minH < 0.15 || grade < 0.03;
  return {
    area: members.length * cellArea,
    minHeight: minH,
    maxHeight: maxH,
    meanHeight: mh,
    xMin, xMax, zMin, zMax,
    slopeDeg: flat ? 0 : THREE.MathUtils.radToDeg(Math.atan(grade)),
    rises: flat ? null : [b / grade, c / grade],
  };
}

/**
 * A gap at ground level, covered from above and walled on both sides, in the silhouette
 * a body would see when travelling along the probe axis.
 */
function findOpenings(grid: Grid<SideCell>, along: 'X' | 'Z'): Opening[] {
  const lowest: (number | null)[] = [];
  for (let c = 0; c < grid.cols; c++) {
    let row: number | null = null;
    for (let r = 0; r < grid.rows; r++) {
      if (grid.cells[r][c].hit) { row = r; break; }
    }
    lowest.push(row);
  }
  const openings: Opening[] = [];
  let c = 0;
  while (c < grid.cols) {
    if (lowest[c] === 0 || lowest[c] === null) { c++; continue; }
    const start = c;
    let clear = Infinity;
    let high = 0;
    while (c < grid.cols && lowest[c] !== 0 && lowest[c] !== null) {
      clear = Math.min(clear, lowest[c]!);
      high = Math.max(high, lowest[c]!);
      c++;
    }
    // A ledge or jamb can overhang the edge of a passage: also give the tallest part and its width.
    let mainCols = 0;
    for (let k = start; k < c; k++) if (lowest[k] === high) mainCols++;
    const walledLeft = start > 0 && lowest[start - 1] === 0;
    const walledRight = c < grid.cols && lowest[c] === 0;
    if (walledLeft && walledRight && c - start >= 2) {
      openings.push({
        along,
        width: (c - start) * grid.cell,
        clearHeight: clear * grid.cell,
        mainWidth: mainCols * grid.cell,
        mainClear: high * grid.cell,
        from: grid.colStart + start * grid.cell,
        to: grid.colStart + c * grid.cell,
      });
    }
  }
  return openings;
}

/**
 * How much of each vertical bounds face the geometry touches flush. A band across most of a side
 * is a likely join, unless the side is a broad face of a card or slab (a wall's two faces, a
 * plank's long sides).
 */
function probeFaces(alongZ: Grid<SideCell>, alongX: Grid<SideCell>, size: Vec3): FaceProbe[] {
  const face = (grid: Grid<SideCell>, side: FaceProbe['side'], depth: 'depthFromMax' | 'depthFromMin', extent: number) => {
    const tol = Math.min(JOIN_MAX_TOL, Math.max(0.03, extent * 0.03));
    let flush = 0;
    let total = 0;
    const flushCols = new Set<number>();
    let yMin = Infinity, yMax = -Infinity, uMin = Infinity, uMax = -Infinity;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        total++;
        const d = grid.cells[r][c][depth];
        if (d === null || d > tol) continue;
        flush++;
        flushCols.add(c);
        yMin = Math.min(yMin, grid.rowStart + r * grid.cell);
        yMax = Math.max(yMax, grid.rowStart + (r + 1) * grid.cell);
        uMin = Math.min(uMin, grid.colStart + c * grid.cell);
        uMax = Math.max(uMax, grid.colStart + (c + 1) * grid.cell);
      }
    }
    const any = flush > 0;
    return {
      side,
      coverage: total ? flush / total : 0,
      across: grid.cols ? flushCols.size / grid.cols : 0,
      deckEdge: null,
      yMin: any ? yMin : null,
      yMax: any ? yMax : null,
      uMin: any ? uMin : null,
      uMax: any ? uMax : null,
    };
  };

  const pair = (grid: Grid<SideCell>, axis: 'X' | 'Z'): FaceProbe[] => {
    const extent = size[axis === 'X' ? 0 : 2];
    const width = size[axis === 'X' ? 2 : 0];
    const pos = face(grid, `+${axis}`, 'depthFromMax', extent);
    const neg = face(grid, `-${axis}`, 'depthFromMin', extent);
    const broad = extent < CARD_THICKNESS || (extent < width * SLAB_RATIO && pos.across >= 0.8 && neg.across >= 0.8);
    return [{ ...pos, broad }, { ...neg, broad }];
  };
  return [...pair(alongX, 'X'), ...pair(alongZ, 'Z')];
}

/**
 * A walkway joins where its deck runs out to a side, even when a lip, post or rail end sticks
 * out past the deck so the side is not flush (a ramp's low end). Only for modular pieces (some
 * other side already joins flush) and only for decks with rails or walls above them, so a
 * creature's back, a lily pad or an arch's top is never read as a deck.
 */
function markDeckEdges(faces: FaceProbe[], surfaces: Surface[], min: Vec3, max: Vec3, size: Vec3): FaceProbe[] {
  if (!faces.some((f) => f.across >= 0.8 && !f.broad)) return faces;
  return faces.map((f) => {
    if (f.broad) return f;
    const onX = f.side.endsWith('X');
    for (const sf of surfaces) {
      if (!sf.personWide) continue;
      const gap = f.side === '+X' ? max[0] - sf.xMax
        : f.side === '-X' ? sf.xMin - min[0]
          : f.side === '+Z' ? max[2] - sf.zMax
            : sf.zMin - min[2];
      const span = onX ? (sf.zMax - sf.zMin) / size[2] : (sf.xMax - sf.xMin) / size[0];
      if (gap > DECK_REACH || span < DECK_SPAN) continue;
      // Deck height at that edge, from the surface's plane.
      const edge = f.side === '+X' ? sf.xMax : f.side === '-X' ? sf.xMin : f.side === '+Z' ? sf.zMax : sf.zMin;
      const height = deckHeightAt(sf, onX, edge);
      if (max[1] - height < DECK_HEADROOM) continue;
      return { ...f, deckEdge: { height, inset: Math.max(0, gap) } };
    }
    return f;
  });
}

function deckHeightAt(sf: Surface, onX: boolean, edge: number): number {
  if (!sf.rises) return sf.meanHeight;
  const centre = onX ? (sf.xMin + sf.xMax) / 2 : (sf.zMin + sf.zMax) / 2;
  const half = onX ? (sf.xMax - sf.xMin) / 2 : (sf.zMax - sf.zMin) / 2;
  const toward = onX ? sf.rises[0] : sf.rises[1];
  const t = half > 1e-6 ? (edge - centre) / half : 0;
  const mid = (sf.minHeight + sf.maxHeight) / 2;
  return mid + t * toward * (sf.maxHeight - sf.minHeight) / 2;
}

/** Which mirrors and turns leave the top-down height map unchanged. */
function findSymmetry(top: Grid<TopCell>, height: number): string[] {
  const h = (r: number, c: number) => top.cells[r][c].top;
  const score = (map: (r: number, c: number) => [number, number]) => {
    let sum = 0;
    let n = 0;
    for (let r = 0; r < top.rows; r++) {
      for (let c = 0; c < top.cols; c++) {
        const [r2, c2] = map(r, c);
        const a = h(r, c);
        const b = h(r2, c2);
        if (a === null && b === null) continue;
        n++;
        sum += a === null || b === null ? 1 : Math.min(1, Math.abs(a - b) / Math.max(height, 1e-6) * 4);
      }
    }
    return n ? sum / n : 1;
  };
  const R = top.rows - 1;
  const C = top.cols - 1;
  const checks: [string, (r: number, c: number) => [number, number]][] = [
    ['mirror across X (left/right)', (r, c) => [r, C - c]],
    ['mirror across Z (front/back)', (r, c) => [R - r, c]],
    ['turned 180°', (r, c) => [R - r, C - c]],
  ];
  if (top.rows === top.cols) checks.push(['turned 90°', (r, c) => [c, R - r]]);
  return checks.filter(([, map]) => score(map) < 0.08).map(([name]) => name);
}

/** Area of one top-grid cell inside the x/z bounds. */
function clippedArea(top: Grid<TopCell>, r: number, c: number, min: Vec3, max: Vec3): number {
  const x0 = top.colStart + c * top.cell;
  const z0 = top.rowStart + r * top.cell;
  const w = Math.max(0, Math.min(x0 + top.cell, max[0]) - Math.max(x0, min[0]));
  const d = Math.max(0, Math.min(z0 + top.cell, max[2]) - Math.max(z0, min[2]));
  return w * d;
}

function toVec(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}
