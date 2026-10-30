/**
 * Shared shapes between the browser page (measure + render) and the Node runner (describe + write).
 * All lengths are metres in the asset's own frame: +Y up, the GLB root origin is the pivot.
 */

export type Vec3 = [number, number, number];

export interface MaterialInfo {
  name: string;
  type: string;
  vertexColors: boolean;
  transparent: boolean;
  alphaTest: number;
  doubleSided: boolean;
  emissive: boolean;
  maps: string[];
}

export interface TextureInfo {
  name: string;
  width: number;
  height: number;
  slots: string[];
}

export interface ClipInfo {
  name: string;
  duration: number;
  tracks: number;
  targets: string[];
  skeletal: boolean;
  /** Largest translation of any animated node from its first key, metres. */
  maxTravel: number;
}

export interface Structure {
  nodes: number;
  meshes: number;
  drawCalls: number;
  triangles: number;
  vertices: number;
  skinnedMeshes: number;
  bones: number;
  morphTargets: number;
  materials: MaterialInfo[];
  textures: TextureInfo[];
  /** Named non-mesh nodes (groups, pivots), first few only. */
  namedNodes: string[];
  clips: ClipInfo[];
}

/** A regular probe grid. `cells[row][col]`, row 0 is the lowest coordinate of the row axis. */
export interface Grid<T> {
  cell: number;
  /** World coordinate of the first column / row edge. */
  colStart: number;
  rowStart: number;
  cols: number;
  rows: number;
  cells: T[][];
}

export interface TopCell {
  /** Height of the topmost surface, or null when the ray missed. */
  top: number | null;
  /** Height of the lowest surface seen from below, or null. */
  bottom: number | null;
  /** Up component of the top surface normal (1 = flat floor). */
  normalUp: number;
}

export interface SideCell {
  hit: boolean;
  /** Distance from the bounds face on the positive side to the first hit, or null. */
  depthFromMax: number | null;
  /** Distance from the bounds face on the negative side to the first hit, or null. */
  depthFromMin: number | null;
}

export interface Surface {
  area: number;
  minHeight: number;
  maxHeight: number;
  meanHeight: number;
  /** World x/z extent of the surface. */
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  slopeDeg: number;
  /** Direction the surface rises toward, as a unit x/z vector, or null when flat. */
  rises: [number, number] | null;
  /** True when some part of the patch is wide enough for a person to stand on (not a rail top or strand). */
  personWide: boolean;
  /** True when the patch is too narrow for a person but flat and wide enough for a small prop or creature. */
  perch: boolean;
}

/** The x/z extent of the cells whose underside is near the lowest point: what the model stands on. */
export interface Base {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  area: number;
}

export interface Opening {
  /** Axis a body would travel along to pass through. */
  along: 'X' | 'Z';
  width: number;
  clearHeight: number;
  /** Width and clear height of the tallest part of the passage (equal to the above when it is straight-sided). */
  mainWidth: number;
  mainClear: number;
  /** Range on the crossing axis (x for a passage along Z, z for one along X). */
  from: number;
  to: number;
}

export interface FaceProbe {
  side: '+X' | '-X' | '+Z' | '-Z';
  /** Fraction of face cells whose first hit is flush with the bounds face. */
  coverage: number;
  /** Fraction of columns across the face that contain at least one flush cell. */
  across: number;
  /** A standable deck that runs out to this side: its height there and how far inside the bounds it ends. */
  deckEdge: { height: number; inset: number } | null;
  /** True when this side is a broad face of a thin slab or card, not an end that joins. */
  broad: boolean;
  yMin: number | null;
  yMax: number | null;
  uMin: number | null;
  uMax: number | null;
}

export interface Measurement {
  structure: Structure;
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
  top: Grid<TopCell>;
  /** Rays along Z over an X (cols) by Y (rows) grid. */
  alongZ: Grid<SideCell>;
  /** Rays along X over a Z (cols) by Y (rows) grid. */
  alongX: Grid<SideCell>;
  footprintArea: number;
  contactFraction: number;
  base: Base | null;
  volumeFill: number;
  surfaces: Surface[];
  openings: Opening[];
  faces: FaceProbe[];
  symmetry: string[];
}

export interface RenderOptions {
  size: number;
  quality: number;
}

export interface RenderInfo {
  jpegDataUrl: string;
  gridCell: number;
  humanShown: boolean;
  cameraElevationDeg: number;
  fovDeg: number;
}

export interface ClassifyResult {
  measurement: Measurement;
  render: RenderInfo;
}
