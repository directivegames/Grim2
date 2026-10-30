/**
 * Node-side: turns a measurement into the asset's files, and builds the folder index.
 *
 * Three levels, each read only when the one above is not enough:
 *   ASSETS.md          one row per asset, to choose from (~40 tokens a row)
 *   <Name>.md          the card: front matter, placement rules, key facts (~400 tokens)
 *   <Name>.detail.md   full measurements: height map, silhouettes, every surface and edge
 * Interpretation fields are left pending for an agent to fill after it looks at the render.
 */

import type { ClassifyResult, FaceProbe, Grid, Measurement, SideCell, Surface, TopCell } from './types.js';

export const CLASSIFIER_VERSION = 4;
export const PENDING = '_pending_';
/** The fixed values the `collision` field takes. `trunk` is followed by its footprint and offset. */
export const COLLISION_VALUES = ['walk-mesh', 'box', 'trunk', 'none'];
export const ROLE_VALUES = ['collectible', 'hazard', 'landmark', 'stepping-platform', 'scatter', 'blocker'];

export interface AssetContext {
  name: string;
  glbFile: string;
  jpgFile: string;
  detailFile: string;
  assetPath: string;
  sha256: string;
  bytes: number;
}

export interface AssetDocs {
  card: string;
  detail: string;
  sits: SitsGuess;
}

/** The measured placement guess: the v3 form and the notes v4 adds to it. */
export interface SitsGuess {
  bare: string;
  /** Pivot offset from the footprint centre, or null when it is near the middle. */
  pivot: string | null;
  /** A large one-sided overhang past the base, or null. Means nothing for hanging or attached pieces. */
  overhang: string | null;
}

export function describe(ctx: AssetContext, result: ClassifyResult): AssetDocs {
  const m = result.measurement;
  const pivot = pivotWords(m);
  const placement = placementGuess(m, pivot);
  const collision = collisionGuess(m, pivot);
  const named = parseName(ctx.name);
  const warnings = findWarnings(m, named);
  return {
    card: card(ctx, m, pivot, placement, collision, warnings),
    detail: detail(ctx, result, pivot, placement, collision, named, warnings),
    sits: { bare: placement.bare, pivot: placement.pivot, overhang: placement.overhang },
  };
}

// ---------------------------------------------------------------------------
// Card

function card(
  ctx: AssetContext, m: Measurement, pivot: PivotWords, placement: Placement, collision: CollisionGuess, warnings: string[],
): string {
  const s = m.structure;
  const joins = joinSides(m);
  const lines = [
    '---',
    `asset: ${q(ctx.name)}`,
    `path: ${q(ctx.assetPath)}`,
    'interpretation: pending  # agent: set to done when every pending field is filled',
    `category: ${PENDING}`,
    `summary: ${PENDING}`,
    `front: ${PENDING}  # -Z, +Z, -X, +X, none, along Z, along X or unknown`,
    `style: ${PENDING}`,
    `collision: ${PENDING}  # measured: ${collision.value}; one of walk-mesh, box, trunk W×D at ..., none`,
    `role: ${PENDING}  # ${ROLE_VALUES.join(', ')}, or empty`,
    `goes_with: ${PENDING}`,
    `sits: ${q(placement.short)}  # guess; agent: correct if the render disagrees, keep the numbers`,
    `size_m: [${m.size.map(f2).join(', ')}]  # x, y (height), z`,
    `pivot: ${q(pivot.text)}`,
    `stand_on: ${q(standCell(m))}`,
    `perch: ${q(perchCell(m))}`,
    `joins: [${joins.map((f) => f.side).join(', ')}]`,
    `tris: ${s.triangles}`,
    `draw_calls: ${s.drawCalls}`,
    `clips: ${s.clips.length}`,
    `warnings: ${warnings.length}`,
    `classifier: mesh-classifier v${CLASSIFIER_VERSION}`,
    '---',
    '',
    `# ${ctx.name}`,
    '',
    '## Use it',
    '',
    `- ${PENDING}`,
    '',
    '## Facts',
    '',
    `- Bounds x ${range(m.min[0], m.max[0])}, y ${range(m.min[1], m.max[1])}, z ${range(m.min[2], m.max[2])}. `
      + `Pivot ${pivot.text}; ${pct(m.contactFraction)} of the footprint reaches the lowest point. (m)`,
    `- Sits: ${placement.long} (g)`,
    `- Stand on: ${standLine(m)} (m)`,
    `- Perch: ${perchLine(m)} (m)`,
    `- Collision (measured): ${collision.value}, ${collision.why}. (g)`,
    `- Walk through: ${openingLine(m)} (m)`,
    `- Joins: ${joins.length ? joins.map(joinWords).join('; ') : 'no side looks like a joint'}. (m)`,
    `- Shape: ${proportions(m)}; fills ${pct(m.volumeFill)} of its box; symmetry: ${m.symmetry.length ? m.symmetry.join(', ') : 'none'}. (m)`,
    `- Cost: ${s.triangles} tris, ${s.drawCalls} draw call${s.drawCalls === 1 ? '' : 's'}, ${s.materials.length} material${s.materials.length === 1 ? '' : 's'}`
      + `${s.textures.length ? `, textures ${s.textures.map((t) => `${t.width}×${t.height}`).join(', ')}` : ''}`
      + `${s.skinnedMeshes ? `, skinned (${s.bones} bones)` : ''}. (m)`,
  ];
  if (s.clips.length) {
    const names = s.clips.slice(0, 12).map((c) => `${c.name || '(unnamed)'} ${c.duration.toFixed(1)}s`).join(', ');
    lines.push(`- Clips: ${names}${s.clips.length > 12 ? `, +${s.clips.length - 12} more` : ''}. (m)`);
  }
  for (const w of warnings) lines.push(`- ⚠ ${w}`);
  lines.push(
    '',
    `Render ${ctx.jpgFile}; full measurements in ${ctx.detailFile}. `
      + 'Tags: (m) measured, (g) guessed from measurements; front matter fields above `size_m` are the agent\'s reading of the render.',
    '',
  );
  return lines.join('\n');
}

function standLine(m: Measurement): string {
  const fits = m.surfaces.filter((sf) => sf.personWide);
  if (!fits.length) return 'nothing a person fits on.';
  return fits.slice(0, 3).map((sf) => {
    const slope = sf.rises ? `, rising toward ${dirWord(sf.rises)} at ${sf.slopeDeg.toFixed(0)}°` : '';
    return `${heightWords(sf)}${slope}, ${f2(sf.xMax - sf.xMin)} × ${f2(sf.zMax - sf.zMin)} m`;
  }).join('; ') + '.';
}

/** Flat tops too narrow for a person that a small prop or creature can sit on, highest first. */
function perchLine(m: Measurement): string {
  const perches = m.surfaces.filter((sf) => sf.perch);
  if (!perches.length) return 'no narrower flat top.';
  return perches.slice(0, 3).map((sf) => `${heightWords(sf)}, ${f2(sf.xMax - sf.xMin)} × ${f2(sf.zMax - sf.zMin)} m ${centreWords(sf)}`).join('; ') + '.';
}

/** Index cell: the largest person-wide surface, as `0.93 m 4.0×4.8`, plus how many more there are. */
function standCell(m: Measurement): string {
  const fits = m.surfaces.filter((sf) => sf.personWide);
  if (!fits.length) return '—';
  const sf = fits[0];
  const more = fits.length > 1 ? ` +${fits.length - 1}` : '';
  return `${heightWords(sf)} ${f1(sf.xMax - sf.xMin)}×${f1(sf.zMax - sf.zMin)}${more}`;
}

/** Front matter: the highest perch with its size and centre. */
function perchCell(m: Measurement): string {
  const sf = m.surfaces.find((s) => s.perch);
  if (!sf) return '—';
  return `${heightWords(sf)} ${f1(sf.xMax - sf.xMin)}×${f1(sf.zMax - sf.zMin)} ${centreWords(sf)}`;
}

/** A patch that varies by less than 0.15 m is given as its mean height; otherwise as a range. */
function heightWords(sf: Surface): string {
  return sf.maxHeight - sf.minHeight < 0.15 ? `${f2(sf.meanHeight)} m` : `${f2(sf.minHeight)}–${f2(sf.maxHeight)} m`;
}

function centreWords(sf: Surface): string {
  return `at x ${f2((sf.xMin + sf.xMax) / 2)} z ${f2((sf.zMin + sf.zMax) / 2)}`;
}

function openingLine(m: Measurement): string {
  const fits = m.openings.filter(personFits);
  if (!fits.length) return 'no gap a person fits through.';
  return fits.map((o) => `along ${o.along}, ${f2(o.width)} m wide × ${f2(o.clearHeight)} m clear at ${o.along === 'Z' ? 'x' : 'z'} ${range(o.from, o.to)}${mainWords(o)}`).join('; ') + '.';
}

function mainWords(o: Measurement['openings'][number]): string {
  return o.mainClear - o.clearHeight >= 0.3 ? ` (${f2(o.mainWidth)} m of it ${f2(o.mainClear)} m clear)` : '';
}

function personFits(o: Measurement['openings'][number]): boolean {
  return (o.width >= 0.6 && o.clearHeight >= 1.9) || (o.mainWidth >= 0.6 && o.mainClear >= 1.9);
}

function joinSides(m: Measurement): FaceProbe[] {
  return m.faces.filter((f) => (f.across >= 0.8 && !f.broad) || f.deckEdge);
}

function joinWords(f: FaceProbe): string {
  if (f.deckEdge && !(f.across >= 0.8 && !f.broad)) {
    const inset = f.deckEdge.inset >= 0.05 ? `, ${f2(f.deckEdge.inset)} m inside the bounds` : '';
    return `${sideWord(f.side)} deck edge at y ${f2(f.deckEdge.height)}${inset}`;
  }
  const deck = f.deckEdge ? `, deck ${f2(f.deckEdge.height)}` : '';
  return `${sideWord(f.side)} band at y ${range(f.yMin!, f.yMax!)}${deck}`;
}

// ---------------------------------------------------------------------------
// Detail

function detail(
  ctx: AssetContext, result: ClassifyResult, pivot: PivotWords, placement: Placement, collision: CollisionGuess,
  named: ReturnType<typeof parseName>, warnings: string[],
): string {
  const m = result.measurement;
  const s = m.structure;
  return [
    `# ${ctx.name}: full measurements`,
    '',
    `Card: ${ctx.name}.md. All values measured from the geometry unless marked. Axes: +Y up, metres, the GLB origin is the pivot.`,
    '',
    `- File: ${ctx.glbFile}, ${(ctx.bytes / 1024).toFixed(0)} KB, sha256 ${ctx.sha256}`,
    `- Size: ${f2(m.size[0])} (X) × ${f2(m.size[1])} (Y) × ${f2(m.size[2])} (Z) m`,
    `- Bounds: x ${range(m.min[0], m.max[0])}, y ${range(m.min[1], m.max[1])}, z ${range(m.min[2], m.max[2])}`,
    `- Pivot: ${pivot.text}; footprint centre is ${f2(Math.hypot(m.center[0], m.center[2]))} m from it`,
    `- Ground contact: ${pct(m.contactFraction)} of the footprint reaches y = ${f2(m.min[1])}`,
    `- Base (underside within ${f2(Math.max(0.02, m.size[1] * 0.1))} m of the lowest point): `
      + `${m.base ? `x ${range(m.base.xMin, m.base.xMax)}, z ${range(m.base.zMin, m.base.zMax)}, ${f2(m.base.area)} m²` : 'none'}`,
    `- Sits (guessed): ${placement.long}`,
    `- Footprint: ${f2(m.footprintArea)} m², ${pct(m.footprintArea / Math.max(m.size[0] * m.size[2], 1e-9))} of its x/z bounds; volume fill ${pct(m.volumeFill)}`,
    `- Collision (guessed): ${collision.value}, ${collision.why}`,
    `- Name words: ${named.words.join(' ')}${named.variant ? `; variant ${named.variant}` : ''}${named.dims ? `; claims ${named.dims[0]} × ${named.dims[1]}` : ''}`,
    ...warnings.map((w) => `- ⚠ ${w}`),
    '',
    `## Top-down height map (cell ${f2(m.top.cell)} m)`,
    '',
    `Top row is −Z, columns run −X → +X. \`.\` empty, \`0\`–\`9\` top height in tenths of ${f2(m.size[1])} m above the lowest point.`,
    '',
    '```',
    ...topMap(m.top, m.min[1], m.size[1]),
    '```',
    '',
    `## Silhouette along Z (cell ${f2(m.alongZ.cell)} m)`,
    '',
    'What a body moving along Z would hit. Columns run −X → +X, top row is highest.',
    '',
    '```',
    ...silhouette(m.alongZ),
    '```',
    '',
    `## Silhouette along X (cell ${f2(m.alongX.cell)} m)`,
    '',
    'Columns run −Z → +Z, top row is highest.',
    '',
    '```',
    ...silhouette(m.alongX),
    '```',
    '',
    '## Upward surfaces (topmost only, within 35° of flat)',
    '',
    'Fits: `person` (stand-on, ≥ 0.5 m wide), `perch` (0.3–0.5 m wide and within 15° of flat: a small prop or creature), `no` (rail top, ridge or strand).',
    '',
    ...surfaceTable(m),
    '',
    '## Openings at ground level',
    '',
    ...(m.openings.length
      ? m.openings.map((o) => `- Along ${o.along}: ${f2(o.width)} m wide, ${f2(o.clearHeight)} m clear, at ${o.along === 'Z' ? 'x' : 'z'} ${range(o.from, o.to)}${mainWords(o)}${personFits(o) ? '; a person fits' : ''}`)
      : ['- None']),
    '',
    '## Sides of the bounding box',
    '',
    'How much of each vertical side the geometry touches flush. A side is listed as a joint on the card when a flush band runs across ≥ 80% of it '
      + '(unless it is a broad face of a card or slab), or when a person-wide deck runs out to it.',
    '',
    '| Side | Touches | Across | Band height | Broad face | Deck edge |',
    '|---|---|---|---|---|---|',
    ...m.faces.map((f) => `| ${sideWord(f.side)} | ${pct(f.coverage)} | ${pct(f.across)} | ${f.yMin === null ? '—' : `y ${range(f.yMin, f.yMax!)}`} | ${f.broad ? 'yes' : 'no'} | `
      + `${f.deckEdge ? `y ${f2(f.deckEdge.height)}, ${f2(f.deckEdge.inset)} m in` : '—'} |`),
    '',
    '## Structure',
    '',
    `- ${s.triangles} triangles, ${s.vertices} vertices, ${s.meshes} meshes, ${s.drawCalls} draw calls, ${s.nodes} nodes`,
    ...s.materials.map((mat) => `- Material ${q(mat.name || '(unnamed)')}: ${mat.type}${materialFlags(mat)}`),
    ...s.textures.map((t) => `- Texture ${q(t.name || '(unnamed)')}: ${t.width}×${t.height}, ${t.slots.join(', ')}`),
    ...(s.skinnedMeshes ? [`- Skinned meshes: ${s.skinnedMeshes}, bones: ${s.bones}`] : []),
    ...(s.morphTargets ? [`- Morph targets: ${s.morphTargets}`] : []),
    ...(s.namedNodes.length ? [`- Named nodes: ${s.namedNodes.join(', ')}`] : []),
    '',
    ...(s.clips.length ? [
      '## Clips',
      '',
      '| Clip | Length | Tracks | Kind | Travel |',
      '|---|---|---|---|---|',
      ...s.clips.map((c) => `| ${c.name || '(unnamed)'} | ${c.duration.toFixed(2)} s | ${c.tracks} on ${c.targets.length} nodes | ${c.skeletal ? 'skeletal' : 'separate parts'} | ${c.maxTravel > 0.1 ? `${f2(c.maxTravel)} m` : 'in place'} |`),
      '',
    ] : []),
    '## Render',
    '',
    `- ${ctx.jpgFile}: camera on the −Z side, offset toward +X, ${result.render.cameraElevationDeg.toFixed(0)}° above, ${result.render.fovDeg}° FOV.`,
    `- Red, green, blue axes at the pivot are +X, +Y, +Z; the yellow floor arrow points −Z; grid cell ${result.render.gridCell} m`
      + `${result.render.humanShown ? '; the orange figure is a 1.8 m person off the +X/+Z corner' : ''}.`,
    '',
  ].join('\n');
}

function surfaceTable(m: Measurement): string[] {
  if (!m.surfaces.length) return ['- None'];
  return [
    '| Height | Area | Extent x × z | Slope | Fits |',
    '|---|---|---|---|---|',
    ...m.surfaces.map((sf) => {
      const slope = sf.rises ? `${sf.slopeDeg.toFixed(0)}° rising toward ${dirWord(sf.rises)}` : 'flat';
      return `| ${heightWords(sf)} | ${f2(sf.area)} m² | ${f2(sf.xMax - sf.xMin)} × ${f2(sf.zMax - sf.zMin)} m (x ${range(sf.xMin, sf.xMax)}, z ${range(sf.zMin, sf.zMax)}) | ${slope} | ${sf.personWide ? 'person' : sf.perch ? 'perch' : 'no'} |`;
    }),
  ];
}

// ---------------------------------------------------------------------------
// Words

interface PivotWords {
  text: string;
  vertical: 'bottom' | 'top' | 'middle' | 'below' | 'above' | 'partway';
  horizontalCentred: boolean;
  horizontalEdge: boolean;
}

interface Placement {
  short: string;
  long: string;
  /** The v3 guess without the notes, to recognise an untouched guess in an older card. */
  bare: string;
  pivot: string | null;
  overhang: string | null;
}

function pivotWords(m: Measurement): PivotWords {
  const t = (axis: number) => (m.size[axis] < 1e-6 ? 0.5 : (0 - m.min[axis]) / m.size[axis]);
  const ty = t(1);
  let vertical: PivotWords['vertical'];
  let yText: string;
  // A gap under 1 cm is export rounding (it would read "0.00 m below"), not a floating model.
  if (ty < -0.01 && m.min[1] >= 0.01) { vertical = 'below'; yText = `${f2(m.min[1])} m below the model`; }
  else if (ty <= 0.03) { vertical = 'bottom'; yText = 'at the bottom'; }
  else if (ty > 1.01 && m.max[1] <= -0.01) { vertical = 'above'; yText = `${f2(-m.max[1])} m above the model`; }
  else if (ty >= 0.97) { vertical = 'top'; yText = 'at the top'; }
  else if (ty >= 0.4 && ty <= 0.6) { vertical = 'middle'; yText = 'at mid-height'; }
  else { vertical = 'partway'; yText = `${pct(ty)} of the way up`; }

  const horiz = (axis: number, label: 'X' | 'Z') => {
    const v = t(axis);
    if (v >= 0.4 && v <= 0.6) return { centred: true, edge: false, text: `centred on ${label}` };
    if (v < -0.01) return { centred: false, edge: true, text: `outside the model on −${label}` };
    if (v > 1.01) return { centred: false, edge: true, text: `outside the model on +${label}` };
    if (v <= 0.05) return { centred: false, edge: true, text: `at the −${label} end` };
    if (v >= 0.95) return { centred: false, edge: true, text: `at the +${label} end` };
    return { centred: false, edge: false, text: `off-centre toward ${v < 0.5 ? '−' : '+'}${label}` };
  };
  const x = horiz(0, 'X');
  const z = horiz(2, 'Z');
  const centred = x.centred && z.centred;
  const hText = centred ? 'centre of the footprint' : `${x.text}, ${z.text}`;
  const text = vertical === 'bottom' && centred ? 'bottom centre' : `${yText}, ${hText}`;
  return { text, vertical, horizontalCentred: centred, horizontalEdge: x.edge || z.edge };
}

function placementGuess(m: Measurement, p: PivotWords): Placement {
  const guess = bareGuess(m, p);
  const pivot = pivotNote(m);
  // An overhang only matters for something standing on its base, not hanging or attached by an end.
  const overhang = p.vertical === 'top' || p.vertical === 'above' || p.horizontalEdge ? null : overhangNote(m);
  const note = [pivot, overhang].filter(Boolean).join('; ');
  if (!note) return { ...guess, bare: guess.short, pivot, overhang };
  // The note says where the pivot is, so "pivot off-centre" adds nothing.
  const lead = guess.short.replace(/, pivot off-centre$/, '');
  return { short: `${lead}; ${note}`, long: `${guess.long} ${capital(note)}.`, bare: guess.short, pivot, overhang };
}

/**
 * Where the pivot sits in the footprint when it is not near the middle: the offset from the
 * footprint centre and how far the body reaches each way, or the corner it is near.
 */
function pivotNote(m: Measurement): string | null {
  const off = (axis: number) => Math.abs(m.center[axis]) > Math.max(0.05, m.size[axis] * 0.1);
  const axes = ([[0, 'X'], [2, 'Z']] as const).filter(([a]) => off(a));
  if (!axes.length) return null;
  const t = (axis: number) => (m.size[axis] < 1e-6 ? 0.5 : -m.min[axis] / m.size[axis]);
  const reach = (axis: number, label: string) => {
    const parts: string[] = [];
    if (-m.min[axis] > 0.05) parts.push(`−${label} ${fm(-m.min[axis])}`);
    if (m.max[axis] > 0.05) parts.push(`+${label} ${fm(m.max[axis])}`);
    return parts;
  };
  const nearEdge = (v: number) => v < 0.15 || v > 0.85;
  if (axes.length === 2 && nearEdge(t(0)) && nearEdge(t(2))) {
    const corner = `${t(0) < 0.5 ? '−' : '+'}X/${t(2) < 0.5 ? '−' : '+'}Z`;
    // Long reaches first; a short reach on the pivot's own side is kept when it is more than a sliver.
    const sliver = (axis: number) => Math.max(0.05, m.size[axis] * 0.05);
    const parts = ([[0, 'X'], [2, 'Z']] as const).flatMap(([a, label]) => {
      const [far, near] = t(a) < 0.5 ? [`+${label} ${fm(m.max[a])}`, -m.min[a]] : [`−${label} ${fm(-m.min[a])}`, m.max[a]];
      const nearText = near > sliver(a) ? `${t(a) < 0.5 ? '−' : '+'}${label} ${fm(near)}` : null;
      return [far, nearText];
    });
    return `pivot near ${corner} corner; body ${parts.filter(Boolean).join(', ')}`;
  }
  // The pivot lies on the opposite side of the centre from where the centre is.
  const offsets = axes.map(([a, label]) => `${fm(Math.abs(m.center[a]))} m ${m.center[a] > 0 ? '−' : '+'}${label}`);
  const body = axes.flatMap(([a, label]) => reach(a, label));
  return `pivot ${offsets.join(', ')} of centre; body ${body.join(', ')}`;
}

/** A large one-sided overhang past the base the model stands on (a crown, a lean, a head). */
function overhangNote(m: Measurement): string | null {
  const b = m.base;
  if (!b) return null;
  const out: Record<FaceProbe['side'], number> = {
    '+X': m.max[0] - b.xMax, '-X': b.xMin - m.min[0], '+Z': m.max[2] - b.zMax, '-Z': b.zMin - m.min[2],
  };
  const opposite: Record<FaceProbe['side'], FaceProbe['side']> = { '+X': '-X', '-X': '+X', '+Z': '-Z', '-Z': '+Z' };
  const span = Math.max(m.size[0], m.size[2]);
  let best: FaceProbe['side'] | null = null;
  for (const side of Object.keys(out) as FaceProbe['side'][]) {
    const v = out[side];
    if (v < Math.max(1, span * 0.25) || v < out[opposite[side]] * 2 + 0.5) continue;
    if (!best || v > out[best]) best = side;
  }
  return best ? `overhangs ${sideWord(best)} ${fm(out[best])} m past its base` : null;
}

function bareGuess(m: Measurement, p: PivotWords): { short: string; long: string } {
  const minY = m.min[1];
  if (p.vertical === 'bottom' && p.horizontalCentred) {
    return { short: 'ground', long: 'stands on the ground at its pivot; set its position to the ground point.' };
  }
  if (p.vertical === 'bottom') {
    return { short: 'ground, pivot off-centre', long: 'rests on the ground, but the pivot is not under the middle, so rotating swings it around that point.' };
  }
  if (p.vertical === 'top' || p.vertical === 'above') {
    return { short: 'hangs from pivot', long: 'hangs from its pivot; put the pivot at the attachment point above.' };
  }
  if (p.horizontalEdge) {
    return { short: 'attaches at pivot (end)', long: 'attaches at its pivot, which sits at one end; put the pivot where it joins its parent.' };
  }
  if (p.vertical === 'below') {
    return { short: `floats ${f2(minY)} m above pivot`, long: `floats ${f2(minY)} m above its pivot; at ground level it hovers.` };
  }
  return {
    short: `sinks ${f2(-minY)} m below pivot`,
    long: `the pivot is inside the model with ${f2(-minY)} m below it; raise it by that much to sit on the ground, unless it spans a gap or attaches at its middle.`,
  };
}

function proportions(m: Measurement): string {
  const [sx, sy, sz] = m.size;
  const horiz = Math.max(sx, sz);
  const parts: string[] = [];
  if (sy < horiz * 0.15) parts.push('flat');
  else if (sy > horiz * 2) parts.push('tall and narrow');
  else parts.push('blocky');
  const dims: [string, number][] = [['X', sx], ['Y', sy], ['Z', sz]];
  const sorted = [...dims].sort((a, b) => a[1] - b[1]);
  if (sorted[0][1] < sorted[1][1] * 0.25) parts.push(`thin along ${sorted[0][0]}`);
  if (sx > sz * 3) parts.push('long along X');
  if (sz > sx * 3) parts.push('long along Z');
  return parts.join(', ');
}

interface CollisionGuess {
  value: string;
  why: string;
}

/** A first guess at the `collision` value from the shape; the agent confirms it from the render. */
function collisionGuess(m: Measurement, p: PivotWords): CollisionGuess {
  const stand = m.surfaces.filter((sf) => sf.personWide);
  if (p.vertical === 'top' || p.vertical === 'above') return { value: 'none', why: 'hangs from its pivot' };
  if (!stand.length && m.volumeFill < 0.2) return { value: 'none', why: 'mostly empty space (blades, strands or cards)' };
  const b = m.base;
  const span = Math.max(m.size[0], m.size[2]);
  if (b && m.size[1] >= 2 && Math.min(m.size[0], m.size[2]) >= 1) {
    const w = b.xMax - b.xMin;
    const d = b.zMax - b.zMin;
    if (Math.min(w, d) >= 0.2 && w * d <= m.size[0] * m.size[2] * 0.2 && Math.max(w, d) <= span * 0.35) {
      const cx = (b.xMin + b.xMax) / 2;
      const cz = (b.zMin + b.zMax) / 2;
      const at = Math.hypot(cx, cz) <= Math.max(0.25, Math.max(w, d) * 0.25) ? 'pivot' : `x ${f2(cx)} z ${f2(cz)}`;
      return { value: `trunk ${f1(w)}×${f1(d)} at ${at}`, why: 'a narrow base under a wider top' };
    }
  }
  if (stand.length) {
    if (stand.some((sf) => sf.slopeDeg >= 5)) return { value: 'walk-mesh', why: 'a sloped stand-on surface (a ramp), which a box would turn into a step' };
    if (m.openings.some(personFits)) return { value: 'walk-mesh', why: 'a stand-on surface and an opening to walk through' };
    if (stand.some((sf) => sf.maxHeight < m.max[1] - 0.15)) return { value: 'walk-mesh', why: 'a stand-on surface with higher parts beside it (rails, rims, ledges)' };
    if (m.volumeFill < 0.4) return { value: 'walk-mesh', why: 'a stand-on surface over mostly open space' };
  }
  return { value: 'box', why: m.volumeFill >= 0.55 ? 'fills most of its box' : 'no surface or opening a box would block' };
}

/** True for a value of the `collision` field in the fixed form (walk-mesh, box, trunk W×D at ..., none). */
export function validCollision(value: string): boolean {
  return /^(walk-mesh|box|none|trunk [\d.]+×[\d.]+ at .+)$/.test(value.trim());
}

function findWarnings(m: Measurement, named: ReturnType<typeof parseName>): string[] {
  const out: string[] = [];
  const maxDim = Math.max(...m.size);
  if (maxDim > 100) out.push(`${f2(maxDim)} m across: may be exported in centimetres (×0.01).`);
  if (maxDim < 0.02) out.push(`only ${f2(maxDim)} m across: may be exported at the wrong scale.`);
  if (m.min[1] < -0.02 && m.max[1] > 0.02) out.push(`${f2(-m.min[1])} m of the model is below its pivot.`);
  if (m.min[1] > 0.02) out.push(`the model starts ${f2(m.min[1])} m above its pivot.`);
  if (named.dims) {
    const [a, b] = named.dims;
    const [sx, sz] = [m.size[0], m.size[2]];
    const fits = (x: number, y: number) => Math.abs(x - a) / a < 0.05 && Math.abs(y - b) / b < 0.05;
    if (!fits(sx, sz) && !fits(sz, sx)) out.push(`the name says ${a} × ${b} but it measures ${f2(sx)} × ${f2(sz)} m on x/z.`);
  }
  return out;
}

function parseName(name: string): { words: string[]; variant: string | null; dims: [number, number] | null } {
  const dimsMatch = name.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i);
  const stripped = name.replace(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i, ' ');
  const words = stripped
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  let variant: string | null = null;
  const last = words[words.length - 1];
  if (last && /^[A-Z]$|^\d+$/.test(last)) variant = last;
  else if (last && /^[A-Z][a-z]+[A-Z]$/.test(last)) variant = last.slice(-1);
  return { words, variant, dims: dimsMatch ? [Number(dimsMatch[1]), Number(dimsMatch[2])] : null };
}

function topMap(top: Grid<TopCell>, minY: number, height: number): string[] {
  return top.cells.map((row) => row.map((c) => {
    if (c.top === null) return '.';
    const level = Math.round(((c.top - minY) / Math.max(height, 1e-6)) * 9);
    return String(Math.max(0, Math.min(9, level)));
  }).join(''));
}

function silhouette(grid: Grid<SideCell>): string[] {
  const lines: string[] = [];
  for (let r = grid.rows - 1; r >= 0; r--) lines.push(grid.cells[r].map((c) => (c.hit ? '#' : '.')).join(''));
  return lines;
}

function materialFlags(mat: Measurement['structure']['materials'][number]): string {
  const flags: string[] = [];
  if (mat.maps.length) flags.push(`maps: ${mat.maps.join(', ')}`);
  if (mat.vertexColors) flags.push('vertex colours');
  if (mat.transparent) flags.push('transparent');
  if (mat.alphaTest > 0) flags.push(`alpha cut-out ${mat.alphaTest}`);
  if (mat.doubleSided) flags.push('double-sided');
  if (mat.emissive) flags.push('emissive');
  return flags.length ? ` (${flags.join('; ')})` : '';
}

function sideWord(side: FaceProbe['side']): string {
  return side.replace('-', '−');
}

function dirWord([x, z]: [number, number]): string {
  const parts: string[] = [];
  if (Math.abs(x) > 0.38) parts.push(x > 0 ? '+X' : '−X');
  if (Math.abs(z) > 0.38) parts.push(z > 0 ? '+Z' : '−Z');
  return parts.join(' and ');
}

// ---------------------------------------------------------------------------
// Folder index

export interface IndexRow {
  /** Card path relative to the index, without `.md`. */
  id: string;
  fields: Record<string, string>;
}

/** Reads the flat `key: value` lines of a card's front matter, or null for any other Markdown file. */
export function readFrontMatter(text: string): Record<string, string> | null {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !/^classifier: mesh-classifier/m.test(match[1])) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([a-z_0-9]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].replace(/(^|\s+)#.*$/, '').trim();
    if (value.startsWith('"')) {
      try { value = JSON.parse(value) as string; } catch { /* keep raw */ }
    }
    fields[kv[1]] = value;
  }
  return fields;
}

/** Front matter fields the agent owns, in card order. `sits` starts as the measured guess. */
const AGENT_FIELDS = ['interpretation', 'category', 'summary', 'front', 'style', 'collision', 'role', 'goes_with', 'sits'];

/**
 * Copies the agent's interpretation (its front matter fields and the *Use it* section) from an
 * earlier card into a freshly measured one, including a half-done card's filled fields (but its `sits`
 * only once the card is done, since until then it may be the old guess). Fields that changed meaning since that card's version
 * come back pending so an agent looks again:
 * - `sits` before v3 was the bare measured guess, so the fresh guess replaces it.
 * - before v4, `collision` was free text (kept only when it is already one of the fixed values),
 *   `role` did not exist, and `sits` gains the measured pivot note.
 */
export function carryInterpretation(fresh: string, previous: string, guess: SitsGuess): string {
  const old = previous.match(/^---\n([\s\S]*?)\n---/);
  if (!old) return fresh;
  const version = Number(old[1].match(/^classifier: mesh-classifier v(\d+)/m)?.[1] ?? 0);
  const oldLines = new Map<string, string>();
  for (const line of old[1].split('\n')) {
    const key = line.match(/^([a-z_0-9]+):/)?.[1];
    if (key) oldLines.set(key, line);
  }
  const oldValue = (key: string) => readFrontMatter(`---\n${oldLines.get(key) ?? ''}\nclassifier: mesh-classifier\n---`)?.[key];
  let out = fresh;
  const setLine = (key: string, line: string) => { out = out.replace(new RegExp(`^${key}:.*$`, 'm'), () => line); };
  for (const key of AGENT_FIELDS) {
    const line = oldLines.get(key);
    // A pending line takes the fresh one, so its measured comment stays current.
    if (!line || key === 'sits' || key === 'interpretation' || oldValue(key) === PENDING) continue;
    if (version < 4 && key === 'collision') {
      // Keep an old value only when it is already a fixed value, with the fresh measured comment.
      const value = oldValue(key) ?? '';
      if (validCollision(value)) setLine(key, fresh.match(/^collision:.*$/m)![0].replace(PENDING, () => value));
      continue;
    }
    setLine(key, line);
  }
  const sits = oldValue('sits');
  // An unfinished card's sits may still be the old guess, so only a finished card's is kept.
  const reviewed = /^interpretation: done/m.test(old[1]);
  if (version >= 4 && oldLines.has('sits') && reviewed) {
    setLine('sits', oldLines.get('sits')!);
  } else if (version === 3 && reviewed && sits && sits !== guess.bare) {
    // An agent-written placement keeps its words; the measured notes are added for the agent to trim.
    // An untouched v3 guess is replaced by the fresh one, which already carries them.
    const grounded = !/^(hangs|floats|spans|attaches|on )/.test(sits);
    const notes = [guess.pivot, grounded ? guess.overhang : null].filter((n): n is string => !!n && !sits.includes(n));
    const value = [sits, ...notes].join('; ');
    const comment = fresh.match(/^sits: .*?(\s+#.*)$/m)?.[1] ?? '';
    setLine('sits', `sits: ${q(value)}${comment}`);
  }
  const pending = /^[a-z_]+: _pending_/m.test(out.match(/^---\n([\s\S]*?)\n---/)![1]);
  const freshInterpretation = fresh.match(/^interpretation:.*$/m)![0];
  setLine('interpretation', pending ? freshInterpretation : oldLines.get('interpretation') ?? freshInterpretation);
  const useIt = previous.match(/\n## Use it\n[\s\S]*?(?=\n## )/);
  if (useIt) out = out.replace(/\n## Use it\n[\s\S]*?(?=\n## )/, () => useIt[0]);
  return out;
}

export const PACK_NOTES_START = '<!-- pack-notes -->';
export const PACK_NOTES_END = '<!-- /pack-notes -->';

export function buildIndex(folderName: string, assetPrefix: string, rows: IndexRow[], keptNotes: string | null): string {
  const done = rows.filter((r) => r.fields.interpretation === 'done');
  const pending = rows.filter((r) => r.fields.interpretation !== 'done');
  const groups = new Map<string, IndexRow[]>();
  for (const r of done) {
    const cat = r.fields.category || 'other';
    groups.set(cat, [...(groups.get(cat) ?? []), r]);
  }
  const notes = keptNotes ?? `${PENDING}: shared grid or tile size, which assets join, families and variants, facing convention, repeated heights, typical recipes, perches.`;

  const lines = [
    `# Assets in ${folderName}`,
    '',
    `${rows.length} asset${rows.length === 1 ? '' : 's'}${pending.length ? `, ${pending.length} not interpreted yet` : ''}. Pick here, then read only the cards you need: `
      + '`<Asset>.md` (~400 tokens). `<Asset>.jpg` is a render; `<Asset>.detail.md` has full measurements.',
    `Path \`${assetPrefix}<Asset>.glb\`. +Y up, metres, pivot = GLB origin, Genesys pawns face −Z. Size x×y×z. `
      + 'Sits: how to place the pivot, with its offset when that matters. Joins: sides a modular neighbour attaches to. '
      + 'Collision: walk-mesh (walk on or through), box, trunk W×D (trunk only), none. '
      + 'Stand-on: largest surface a person fits on, height above pivot then x×z (+N more on the card); `perch` = highest top only a small prop or creature fits; `—` if collision is none or trunk.',
    '',
    '## Pack notes',
    '',
    PACK_NOTES_START,
    notes,
    PACK_NOTES_END,
    '',
  ];
  const header = ['| Asset | Size m | Sits | Front | Joins | Collision | Stand-on | Summary |', '|---|---|---|---|---|---|---|---|'];
  for (const cat of [...groups.keys()].sort()) {
    const list = groups.get(cat)!.sort((a, b) => a.id.localeCompare(b.id));
    lines.push(`## ${cat} (${list.length})`, '', ...header, ...list.map(indexRow), '');
  }
  if (pending.length) {
    lines.push(`## not interpreted yet (${pending.length})`, '', ...header, ...pending.sort((a, b) => a.id.localeCompare(b.id)).map(indexRow), '');
  }
  return lines.join('\n');
}

function indexRow(r: IndexRow): string {
  const f = r.fields;
  const pend = (v: string | undefined) => (!v || v === PENDING ? '?' : v);
  const size = (f.size_m ?? '').replace(/[[\]]/g, '').split(',').map((v) => Number(v).toFixed(1)).join('×');
  const joins = (f.joins ?? '').replace(/[[\]\s]/g, '').replace(/-/g, '−') || '—';
  // With no collision, or only a trunk, a measured top (a leaf, a canopy) holds nothing up.
  const solid = !/^(none|trunk)/.test(f.collision ?? '');
  const stand = !solid ? '—'
    : f.stand_on && f.stand_on !== '—' ? f.stand_on
      : f.perch && f.perch !== '—' ? `perch ${f.perch.replace(/ m .*$/, '')}` : '—';
  const clips = Number(f.clips ?? 0);
  const warn = Number(f.warnings ?? 0);
  const tris = Number(f.tris ?? 0);
  const draws = Number(f.draw_calls ?? 0);
  const notes = [
    clips ? `${clips} clip${clips === 1 ? '' : 's'}` : '',
    tris >= 5000 ? `${(tris / 1000).toFixed(0)}k tris` : '',
    draws >= 20 ? `${draws} draws` : '',
    warn ? `⚠${warn}` : '',
  ].filter(Boolean).join(', ');
  const role = f.role && f.role !== PENDING ? `[${f.role}] ` : '';
  const summary = role + pend(f.summary) + (notes ? ` (${notes})` : '');
  return `| ${r.id} | ${size} | ${f.sits ?? ''} | ${pend(f.front)} | ${joins} | ${pend(f.collision)} | ${stand} | ${summary} |`;
}

// ---------------------------------------------------------------------------
// Formatting

/** Two decimals under a metre, one above: enough to place by, short enough for the index. */
function fm(v: number): string {
  return Math.abs(v) < 0.995 ? f2(v) : v.toFixed(1);
}

function f1(v: number): string {
  return v.toFixed(1);
}

function capital(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function f2(v: number): string {
  const r = Math.abs(v) < 0.005 ? 0 : v;
  return r.toFixed(2);
}

function range(a: number, b: number): string {
  return `${f2(a)} to ${f2(b)}`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function q(v: string): string {
  return JSON.stringify(v);
}
