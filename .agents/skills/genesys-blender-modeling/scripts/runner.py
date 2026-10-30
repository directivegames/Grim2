"""Blender-side runner for blender.sh. Not called directly.

  build <asset-dir> [--look]  fresh scene → run every step script in name order → numbers
                      → role budget + expectation check → contact sheet → export GLB (skinned
                      when the scene has an armature; "rig": "mannequin" validates it) → still
  sheet <file.glb> [out] [--look]  import a GLB → numbers (skinned: rest pose) → contact sheet
  preview <file.glb> [out]  Cycles beauty render from four 3/4 angles (sun + sky) — the look check
                      for textured / baked assets the Workbench sheet cannot judge

Parallel-safe: every intermediate render goes to a private temp folder under
.scratch/blender/tmp/ (removed at the end), and every final file (sheet, GLB, still) is written
to a temp name and renamed into place. Exit code 1 when a step raises, an expectation or a role
budget fails. The contact sheet is written either way, so a half-built scene can be looked at.
"""
import glob
import json
import math
import os
import re
import shutil
import sys
import traceback

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # no __pycache__ inside the skill folder
sys.path.insert(0, HERE)
import gkit  # noqa: E402
import grig  # noqa: E402
import gbake  # noqa: E402
import garch  # noqa: E402

ROOT = gkit.PROJECT_ROOT
SCRATCH = gkit.SCRATCH
SHEET_PX = 512
MIN_BLENDER = (4, 1, 0)

# ---------------------------------------------------------------- role budgets
# The single weight table lives in genesys-assets/SKILL.md (the rows under the
# "budget-table" comment). This fallback is used only when that file cannot be read.
_FALLBACK_BUDGETS = {
    'hero': (1536, 12000, 10), 'creature': (1536, 8000, 8), 'prop': (300, 4000, 6),
    'pickup': (150, 1500, 4), 'kit': (150, 3000, 4), 'building': (600, 8000, 8),
    'scatter': (100, 1500, 2), 'title': (600, None, None), 'icon': (60, None, None),
}
STILL_ROLES = ('title', 'icon')


def _kb(cell):
    m = re.search(r'([\d.]+)\s*(KB|MB)', cell, re.I)
    if not m:
        return None
    v = float(m.group(1))
    return round(v * 1024) if m.group(2).upper() == 'MB' else round(v)


def _int(cell):
    m = re.search(r'\d[\d,]*', cell.replace(' ', ''))
    return int(m.group(0).replace(',', '')) if m else None


def load_budgets():
    path = os.path.join(HERE, '..', '..', 'genesys-assets', 'SKILL.md')
    try:
        lines = open(path, encoding='utf-8').read().split('\n')
        i = next(k for k, l in enumerate(lines) if 'budget-table' in l)
    except (OSError, StopIteration):
        print('WARN role budgets: genesys-assets/SKILL.md budget table not found — using built-in values')
        return dict(_FALLBACK_BUDGETS)
    out = {}
    for l in lines[i + 1:]:
        l = l.strip()
        if not l.startswith('|'):
            if out:
                break
            continue
        cells = [c.strip() for c in l.strip('|').split('|')]
        role = re.match(r'`([a-z]+)`', cells[0])
        if not role or len(cells) < 4:
            continue
        out[role.group(1)] = (_kb(cells[1]), _int(cells[2]), _int(cells[3]))
    if not out:
        print('WARN role budgets: budget table empty — using built-in values')
        return dict(_FALLBACK_BUDGETS)
    return out


# Blender roles: rows with a triangle cap, plus the still roles (the music row is not a Blender role).
BUDGETS = {r: v for r, v in load_budgets().items() if v[1] or r in STILL_ROLES}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    gkit.seed(1)


def set_engine(scene, *ids):
    """Render engine identifiers changed across versions (EEVEE ↔ EEVEE_NEXT); try each."""
    for i in ids:
        try:
            scene.render.engine = i
            return i
        except TypeError:
            continue
    raise RuntimeError(f'none of the render engines {ids} exist in Blender {bpy.app.version_string}')


def set_view(scene, *names):
    for n in names:
        try:
            scene.view_settings.view_transform = n
            return n
        except TypeError:
            continue
    return scene.view_settings.view_transform


# ---------------------------------------------------------------- numbers

def ships(o):
    """Objects that render (and so export): not render-hidden, not only in render-hidden collections."""
    if o.hide_render:
        return False
    colls = o.users_collection
    return not (colls and all(c.hide_render for c in colls))


def meshify():
    """Curves and text export as nothing through the selection exporter. Convert them to meshes
    so signage and curve pipes ship and are counted."""
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type in ('CURVE', 'FONT', 'SURFACE', 'META') and ships(o)]
    if not objs:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    empty = [o for o in bpy.context.selected_objects if o.type == 'MESH' and not o.data.polygons]
    for o in empty:
        bpy.data.objects.remove(o, do_unlink=True)
    print(f'NOTE converted {len(objs)} curve/text object(s) to meshes so they export'
          + (f' ({len(empty)} had no faces and were dropped)' if empty else ''))


def numbers():
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    mats = set()
    meshes = 0
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or not ships(o):
            continue
        meshes += 1
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for slot in o.material_slots:
            if slot.material:
                mats.add(slot.material.name)
        mw = ev.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    if meshes == 0:
        lo = hi = Vector((0, 0, 0))
    markers = sorted(o.name for o in bpy.context.scene.objects if o.type == 'EMPTY' and o.parent is None and not o.children)
    size = hi - lo
    # glTF axes: width = X, height = Blender Z, depth = Blender Y
    return {
        'objects': len(bpy.context.scene.objects),
        'meshes': meshes,
        'tris': tris,
        'materials': len(mats),
        'size': [round(size.x, 3), round(size.z, 3), round(size.y, 3)],
        'min_up': round(lo.z, 3),
        'markers': markers,
        'lo': lo, 'hi': hi,
    }


def print_numbers(n):
    w, h, d = n['size']
    print(f"NUMBERS objects {n['objects']}  meshes {n['meshes']}  tris {n['tris']}  "
          f"materials {n['materials']}  size w{w} h{h} d{d} (m)  bottom {n['min_up']}")
    if n['markers']:
        print('MARKERS ' + ' '.join(n['markers']))


def check(n, expect):
    fails = []
    if not expect:
        return fails
    tol = expect.get('tolerance', 0.15)
    if 'tris' in expect:
        a, b = expect['tris']
        if not a <= n['tris'] <= b:
            fails.append(f"tris {n['tris']} outside [{a}, {b}]")
    if 'size' in expect:
        for axis, want, got in zip('whd', expect['size'], n['size']):
            if want and abs(got - want) > tol * want:
                fails.append(f'{axis} {got} m, expected {want} m ±{int(tol * 100)}%')
    if 'materials' in expect and n['materials'] > expect['materials']:
        fails.append(f"materials {n['materials']} > {expect['materials']}")
    for name in expect.get('markers', []):
        if name not in n['markers']:
            fails.append(f'marker {name} missing')
    if 'bottom' in expect and abs(n['min_up'] - expect['bottom']) > 0.02:
        fails.append(f"bottom at {n['min_up']}, expected {expect['bottom']}")
    return fails


def budget_line(role):
    kb, tris, mats = BUDGETS[role]
    parts = []
    if tris:
        parts.append(f'tris ≤ {tris}')
    if mats:
        parts.append(f'materials ≤ {mats}')
    if kb:
        parts.append(f'file ≤ {kb} KB')
    print(f'BUDGET {role}  ' + '  '.join(parts) + '  (genesys-assets weight table; expect cannot raise it)')


def check_budget(n, role):
    kb, tris, mats = BUDGETS[role]
    fails = []
    if tris and n['tris'] > tris:
        fails.append(f"tris {n['tris']} over the {role} budget {tris} — simplify (fewer segments, join, drop hidden faces)")
    if mats and n['materials'] > mats:
        fails.append(f"materials {n['materials']} over the {role} budget {mats} — merge colours that read the same at play distance")
    return fails


def palette_warnings():
    """Albedo (linear luminance) above 0.85 (lighter than about #ededed) or below 0.02 (darker than
    about #272727) on 15 % or more of the surface washes out or reads as a hole once the engine's sun
    and tone mapping hit it (a #f6f1e5 path clipped to white in Play). Saturated colours pass:
    luminance, not the brightest channel, decides."""
    area = {}
    total = 0.0
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or not ships(o) or not o.data.polygons:
            continue
        s = abs(o.matrix_world.to_3x3().determinant()) ** (2 / 3)
        for p in o.data.polygons:
            a = p.area * s
            total += a
            if p.material_index < len(o.material_slots):
                m = o.material_slots[p.material_index].material
                if m:
                    area[m] = area.get(m, 0.0) + a
    warns = []
    for m, a in area.items():
        share = a / total if total else 0
        if share < 0.15:
            continue
        rgb = tuple(m.diffuse_color)[:3]
        b = next((x for x in m.node_tree.nodes if x.type == 'BSDF_PRINCIPLED'), None) if m.node_tree else None
        if b:
            if b.inputs['Base Color'].is_linked:
                continue                      # textured: judge it with --look / preview
            rgb = tuple(b.inputs['Base Color'].default_value)[:3]
            es, ec = b.inputs.get('Emission Strength'), b.inputs.get('Emission Color')
            if es is not None and ec is not None and es.default_value > 0 and max(ec.default_value[:3]) > 0.01:
                continue                      # glows on purpose
        lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        hexc = gkit._hex(rgb)
        if lum > 0.85:
            warns.append(f"palette: '{m.name}' {hexc} covers {share:.0%} of the surface and is near-white "
                         f"(albedo {lum:.2f} > 0.85) — it clips to white under the engine sun; try {gkit.mix(hexc, '#808080', 0.25)}")
        elif lum < 0.02:
            warns.append(f"palette: '{m.name}' {hexc} covers {share:.0%} of the surface and is near-black "
                         f"(albedo {lum:.3f} < 0.02) — it reads as a hole; try {gkit.mix(hexc, '#808080', 0.3)}")
    return warns


# ---------------------------------------------------------------- contact sheet / look tile

def _camera(scene, name, kind, at, look, span, lens=50):
    cd = bpy.data.cameras.new(name)
    cd.type = kind
    cd.clip_end = span * 20
    if kind == 'ORTHO':
        cd.ortho_scale = span * 1.1
    else:
        cd.lens = lens
    cam = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(cam)
    cam.location = at
    cam.rotation_euler = (look - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    return cam


def _compose(tiles, cols, rows, W, H, out):
    """Stitch rendered tiles (row-major from the top-left) into one PNG, written atomically."""
    sheet = bpy.data.images.new('sheet', W * cols, H * rows, alpha=False)
    px = [0.0] * (W * cols * H * rows * 4)
    for k, tile in enumerate(tiles):
        cx, cy = k % cols, rows - 1 - k // cols       # image rows go bottom-up
        img = bpy.data.images.load(tile)
        tp = list(img.pixels)
        for row in range(H):
            src = row * W * 4
            dst = ((cy * H + row) * W * cols + cx * W) * 4
            px[dst:dst + W * 4] = tp[src:src + W * 4]
        bpy.data.images.remove(img)
    sheet.pixels = px
    gkit._save_image(sheet, out)
    bpy.data.images.remove(sheet)


def contact_sheet(n, out_path):
    """2×2 sheet: front (glTF +Z) | side (+X) / top | hero 3/4. Workbench, so it is fast and
    shows material colours (diffuse_color) or textures — not emission, alpha or tone mapping
    (look_tile shows those)."""
    scene = bpy.context.scene
    set_engine(scene, 'BLENDER_WORKBENCH')
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = 'WORLD'
    scene.display.render_aa = '8'
    scene.render.resolution_x = SHEET_PX
    scene.render.resolution_y = SHEET_PX
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('sheet_bg')
    w.color = (0.32, 0.33, 0.36)
    old_world, old_cam = scene.world, scene.camera
    scene.world = w

    center = (n['lo'] + n['hi']) / 2
    span = max((n['hi'] - n['lo']).length, 0.1)
    views = [
        ('front', Vector((0, -1, 0)), 'ORTHO'),
        ('side', Vector((1, 0, 0)), 'ORTHO'),
        ('top', Vector((0, 0, 1)), 'ORTHO'),
        ('hero', Vector((-0.75, -1.0, 0.7)).normalized(), 'PERSP'),
    ]
    tiles = []
    for name, d, kind in views:
        dist = span * (3.0 if kind == 'ORTHO' else 2.2)
        cam = _camera(scene, 'sheet_' + name, kind, center + d * dist, center, span)
        tile = gkit._tmp_path(f'sheet-{name}.png')
        scene.render.filepath = tile
        bpy.ops.render.render(write_still=True)
        tiles.append(tile)
        bpy.data.objects.remove(cam, do_unlink=True)
    _compose(tiles, 2, 2, SHEET_PX, SHEET_PX, out_path)
    scene.world, scene.camera = old_world, old_cam
    print(f'SHEET {os.path.relpath(out_path, ROOT)}  (top-left front · top-right side · bottom-left top · bottom-right hero)')


def look_tile(n, out_path):
    """Engine-look check: EEVEE, a sun and a sky, a filmic view transform, a ground plane. Shows
    what Workbench hides: emission, transparency, and colours that clip under tone mapping."""
    scene = bpy.context.scene
    old_world, old_cam = scene.world, scene.camera
    eng = set_engine(scene, 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE')
    view = set_view(scene, 'ACES 2.0', 'ACES 1.3', 'Filmic', 'AgX')
    scene.render.resolution_x = scene.render.resolution_y = SHEET_PX
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.new('look_sky')
    w.use_nodes = True
    bg = next(x for x in w.node_tree.nodes if x.type == 'BACKGROUND')
    try:
        sky = w.node_tree.nodes.new('ShaderNodeTexSky')
        w.node_tree.links.new(sky.outputs[0], bg.inputs[0])
        bg.inputs[1].default_value = 0.35
        sky_kind = 'sky'
    except Exception:                                   # noqa: BLE001 — sky node API differs by version
        bg.inputs[0].default_value = (0.45, 0.6, 0.85, 1)
        bg.inputs[1].default_value = 1.0
        sky_kind = 'flat sky'
    scene.world = w
    span = max((n['hi'] - n['lo']).length, 0.1)
    center = (n['lo'] + n['hi']) / 2
    added = [gkit.plane('look_ground', (span * 30, span * 30), at=(center.x, center.y, n['lo'].z - 0.001),
                        m=gkit.mat('look_ground', '#6b6b66', rough=0.9))]
    sd = bpy.data.lights.new('look_sun', 'SUN')
    sd.energy = 3.0
    sd.angle = math.radians(2)
    so = bpy.data.objects.new('look_sun', sd)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(45), 0, math.radians(-30))
    added.append(so)
    tiles = []
    for i, d in enumerate((Vector((-0.8, -1.0, 0.45)), Vector((0.8, 1.0, 0.45)))):
        cam = _camera(scene, f'look_{i}', 'PERSP', center + d.normalized() * span * 1.9, center, span, lens=45)
        tile = gkit._tmp_path(f'look-{i}.png')
        scene.render.filepath = tile
        bpy.ops.render.render(write_still=True)
        tiles.append(tile)
        bpy.data.objects.remove(cam, do_unlink=True)
    _compose(tiles, 2, 1, SHEET_PX, SHEET_PX, out_path)
    for o in added:
        bpy.data.objects.remove(o, do_unlink=True)
    scene.world, scene.camera = old_world, old_cam
    print(f'LOOK {os.path.relpath(out_path, ROOT)}  ({eng}, sun + {sky_kind}, {view}; front-left · back-right)')


# ---------------------------------------------------------------- export / still

def _has_normal_map(objs):
    """True when a material on these objects feeds a Normal Map node (a gbake bake, or a hand-wired one)."""
    for o in objs:
        for slot in getattr(o, 'material_slots', ()):
            mat = slot.material
            if mat and mat.use_nodes and any(
                    n.type == 'NORMAL_MAP' and n.inputs['Color'].is_linked for n in mat.node_tree.nodes):
                return True
    return False


def _export_tangents(cfg, objs):
    """cfg "tangents" when set; otherwise on whenever a normal map ships, which shades wrong without them."""
    if 'tangents' in cfg:
        return bool(cfg['tangents'])
    return _has_normal_map(objs)


def export(cfg):
    """Export to a temp file and return it; the caller publishes it after the checks.
    Static assets: rendered meshes + markers, modifiers applied. A scene with an armature exports
    as a skinned model instead: armature + its meshes, modifiers NOT applied (applying the Armature
    modifier would bake the pose and drop the skin), clips only when cfg "animations" is true."""
    tmp = gkit._tmp_path('export.glb')
    scene = bpy.context.scene
    rigs = [o for o in scene.objects if o.type == 'ARMATURE']
    bpy.ops.object.select_all(action='DESELECT')
    if rigs:
        for o in scene.objects:
            if o.type == 'ARMATURE' or (o.type in ('MESH', 'EMPTY') and o.parent in rigs and ships(o)):
                o.select_set(True)
        for r in rigs:                       # rest pose, no active clip
            if r.animation_data:
                r.animation_data.action = None
            for pb in r.pose.bones:
                pb.matrix_basis.identity()
        bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(
            filepath=tmp, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
            export_skins=True, export_animations=bool(cfg.get('animations', False)), export_def_bones=False,
            export_image_format='AUTO', export_tangents=_export_tangents(cfg, bpy.context.selected_objects),
        )
    else:
        for o in scene.objects:
            if (o.type == 'MESH' and ships(o)) or o.type == 'EMPTY':
                o.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=tmp,
            export_format='GLB',
            use_selection=True,
            export_apply=True,
            export_yup=True,
            export_image_format='AUTO',
            export_tangents=_export_tangents(cfg, bpy.context.selected_objects),   # normal maps need them
        )
    return tmp


def _glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    n = int.from_bytes(data[12:16], 'little')
    return json.loads(data[20:20 + n])


def check_rig(glb_file):
    """Compare an exported skinned GLB with the engine mannequin: every joint the engine's clips
    animate must exist with the same parent and rest transform, the root must match, and every
    skinned primitive must carry JOINTS_0/WEIGHTS_0. Returns a list of failures."""
    ref = _glb_json(os.path.join(gkit.ENGINE_ROOT, 'assets', 'character', 'mannequinG.glb'))
    got = _glb_json(glb_file)

    def index(j):
        par = {}
        for i, nd in enumerate(j['nodes']):
            for c in nd.get('children', []):
                par[c] = i
        return {nd.get('name'): (nd, j['nodes'][par[i]].get('name') if i in par else None) for i, nd in enumerate(j['nodes'])}

    R, G = index(ref), index(got)
    targets = {ref['nodes'][c['target']['node']]['name'] for a in ref.get('animations', []) for c in a['channels']}
    targets |= {ref['nodes'][i]['name'] for i in ref['skins'][0]['joints']}
    fails = []
    if not got.get('skins'):
        return ['no skin in the export (was the mesh parented to the armature with an Armature modifier?)']
    for name in sorted(targets):
        if name not in G:
            fails.append(f'missing bone {name}')
            continue
        (rn, rp), (gn, gp) = R[name], G[name]
        if rp != gp:
            fails.append(f'bone {name} parent {gp}, expected {rp}')
        t = max(abs(a - b) for a, b in zip(rn.get('translation', [0, 0, 0]), gn.get('translation', [0, 0, 0])))
        q = abs(sum(a * b for a, b in zip(rn.get('rotation', [0, 0, 0, 1]), gn.get('rotation', [0, 0, 0, 1]))))
        if t > 0.01 or q < 0.99999:
            fails.append(f'bone {name} rest pose differs (Δt {t:.4f}, qdot {q:.6f}) — do not move or re-pose the rig')
    for root in ('Armature',):
        if root in R and root in G:
            rn, gn = R[root][0], G[root][0]
            for k, d in (('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1]), ('translation', [0, 0, 0])):
                if max(abs(a - b) for a, b in zip(rn.get(k, d), gn.get(k, d))) > 1e-4:
                    fails.append(f'root {root} {k} {gn.get(k, d)}, expected {rn.get(k, d)}')
    for m in got.get('meshes', []):
        for prim in m['primitives']:
            if 'JOINTS_0' not in prim['attributes'] or 'WEIGHTS_0' not in prim['attributes']:
                fails.append(f'mesh {m.get("name")} has a primitive without JOINTS_0/WEIGHTS_0 (not skinned)')
                break
    joints = len(got['skins'][0]['joints'])
    print(f'RIG mannequin: {len(targets)} animated bones checked, export has {joints} joints, '
          f'{len(got.get("meshes", []))} meshes, {len(fails)} problems')
    return fails


def still(cfg):
    """Render the still to a temp file and return it (the caller checks the size, then publishes)."""
    scene = bpy.context.scene
    cam = cfg.get('camera')
    if cam:
        scene.camera = bpy.data.objects[cam]
    if scene.camera is None:
        raise RuntimeError('still needs a camera: call camera(...) in a step or set still.camera')
    if cfg.get('engine', 'EEVEE') == 'EEVEE':
        set_engine(scene, 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE')
    else:
        set_engine(scene, 'CYCLES')
        scene.cycles.samples = cfg.get('samples', 64)
    scene.render.resolution_x = cfg.get('width', 1920)
    scene.render.resolution_y = cfg.get('height', 1080)
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = cfg.get('transparent', False)
    set_view(scene, cfg.get('view_transform', 'AgX'), 'AgX', 'Filmic', 'Standard')
    out = cfg['out']
    fmt = 'JPEG' if out.lower().endswith(('.jpg', '.jpeg')) else 'PNG'
    scene.render.image_settings.file_format = fmt
    if fmt == 'JPEG':
        scene.render.image_settings.quality = cfg.get('quality', 88)
    tmp = gkit._tmp_path('still' + os.path.splitext(out)[1].lower())
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    return tmp


# ---------------------------------------------------------------- gate tracking

def _state_path(name):
    return os.path.join(SCRATCH, 'state', f'{name}.json')


def _load_state(name):
    try:
        with open(_state_path(name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _write_state(name, state):
    os.makedirs(os.path.dirname(_state_path(name)), exist_ok=True)
    tmp = gkit._tmp_path('state.json')
    with open(tmp, 'w') as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, _state_path(name))


def _diff(a, b, prefix=''):
    out = []
    for k in sorted(set(a or {}) | set(b or {})):
        va, vb = (a or {}).get(k), (b or {}).get(k)
        if isinstance(va, dict) or isinstance(vb, dict):
            out += _diff(va, vb, prefix + k + '.')
        elif va != vb:
            out.append(f'{prefix}{k} {va}→{vb}')
    return out


def gate_change(state, cfg):
    """The parent owns role + expect. The first build records them; a later change needs a new
    "why" in asset.json and is printed as an EXPECT line for the parent to read. Returns fails."""
    cur = {'role': cfg.get('role'), 'expect': cfg.get('expect')}
    old = state.get('gate')
    if old is None or old == cur:
        state['gate'] = cur
        return []
    changes = ', '.join(_diff(old, cur)) or 'changed'
    why = (cfg.get('why') or '').strip()
    if why and why != state.get('why'):
        print(f'EXPECT changed since the last build: {changes} — why: {why}  (report this to the parent)')
        state['gate'], state['why'] = cur, why
        return []
    return [f'role/expect changed since the last build ({changes}) with no new "why" in asset.json — the parent '
            f'owns these gates: restore them, or add "why": "<reason>" and report the change']


# ---------------------------------------------------------------- commands

def cmd_build(asset_dir, look=False):
    asset_dir = os.path.join(ROOT, asset_dir) if not os.path.isabs(asset_dir) else asset_dir
    name = os.path.basename(os.path.normpath(asset_dir))
    cfg_path = os.path.join(asset_dir, 'asset.json')
    cfg = json.load(open(cfg_path)) if os.path.exists(cfg_path) else {}
    steps = sorted(p for p in glob.glob(os.path.join(asset_dir, '*.py')) if not os.path.basename(p).startswith('_'))
    if not steps:
        print(f'FAIL no step scripts (*.py) in {asset_dir}')
        print('RESULT fail')
        return 1
    state = _load_state(name)
    role = cfg.get('role')
    fails = []
    if role not in BUDGETS:
        fails.append(f'asset.json "role" is {role!r} — set one of {"|".join(BUDGETS)} '
                     f'(it picks the weight budget in genesys-assets)')
    else:
        budget_line(role)
        fails += gate_change(state, cfg)      # tracked from the first build that names a valid role
    reset()
    ns = {k: getattr(gkit, k) for k in gkit.__all__}
    ns.update({k: getattr(grig, k) for k in grig.__all__})
    ns.update({k: getattr(gbake, k) for k in gbake.__all__})
    ns.update({k: getattr(garch, k) for k in garch.__all__})
    ns.update(bpy=bpy, math=math, Vector=Vector)
    failed = False
    for step in steps:
        print(f'STEP {os.path.relpath(step, ROOT)}')
        try:
            exec(compile(open(step).read(), step, 'exec'), ns)
        except Exception:
            traceback.print_exc()
            print(f'FAIL step {os.path.basename(step)} raised — sheet shows the half-built scene')
            failed = True
            break
    if not failed:
        meshify()
    n = numbers()
    print_numbers(n)
    fails += check(n, cfg.get('expect'))
    if role in BUDGETS and role not in STILL_ROLES and cfg.get('export'):
        fails += check_budget(n, role)
        for w in palette_warnings():
            print('WARN ' + w)
    for f in fails:
        print('FAIL ' + f)
    contact_sheet(n, os.path.join(SCRATCH, f'{name}.png'))
    if look or cfg.get('look'):
        look_tile(n, os.path.join(SCRATCH, f'{name}-look.png'))
    state['folder'] = os.path.relpath(asset_dir, ROOT)

    def done(code, msg):
        state['files'] = sorted(set(gkit._run['files']))
        _write_state(name, state)
        print(msg)
        return code

    if failed or fails:
        return done(1, 'RESULT fail — nothing exported')
    if cfg.get('export'):
        tmp = export(cfg)
        kb = os.path.getsize(tmp) / 1024
        cap = BUDGETS[role][0] if role not in STILL_ROLES else None
        print(f"EXPORT {cfg['export']}  {kb:.0f} KB" + (f' ({role} budget {cap} KB)' if cap else '')
              + f"  →  @project/{cfg['export']}")
        bad = []
        if cap and kb > cap:
            bad.append(f'file {kb:.0f} KB over the {role} budget {cap} KB — fewer tris, smaller baked '
                       f'textures (bake size 1024), or enable asset compiler texture/mesh compression on build')
        if cfg.get('rig') == 'mannequin':
            bad += check_rig(tmp)
        for f in bad:
            print('FAIL ' + f)
        if bad:
            return done(1, 'RESULT fail — nothing exported (the file in assets/ was left as it was)')
        gkit._publish(tmp, os.path.join(ROOT, cfg['export']))
    if cfg.get('still'):
        sc = cfg['still']
        srole = sc.get('role') or (role if role in STILL_ROLES else ('title' if sc.get('width', 1920) >= 1000 else 'icon'))
        tmp = still(sc)
        kb = os.path.getsize(tmp) / 1024
        cap = BUDGETS.get(srole, (None,))[0]
        print(f"STILL {sc['out']}  {kb:.0f} KB" + (f' ({srole} budget {cap} KB)' if cap else '') + f"  →  @project/{sc['out']}")
        if cap and kb > cap:
            print(f'FAIL still {kb:.0f} KB over the {srole} budget {cap} KB — JPEG for opaque images, lower '
                  f'quality, or render smaller')
            return done(1, 'RESULT fail — still not written')
        gkit._publish(tmp, os.path.join(ROOT, sc['out']))
    return done(0, 'RESULT ok')


def _sheet_name(glb):
    """Model sheets live in .scratch/blender/sheets/ with their source in the name, so a sheet of
    @engine/.../Chest.glb never overwrites the build sheet of blender/chest or a project Chest."""
    base = os.path.basename(glb).split('.')[0]
    ns = 'engine' if glb.startswith('@engine/') else 'project' if glb.startswith('@project/') else 'file'
    return f'{ns}.{base}'


def cmd_sheet(glb, out=None, look=False):
    reset()
    gkit.import_glb(glb)
    skinned = False
    for o in bpy.context.scene.objects:          # skinned models: measure and draw the rest pose
        if o.type == 'ARMATURE':
            o.data.pose_position = 'REST'
            skinned = True
    bpy.context.view_layer.update()
    n = numbers()
    print_numbers(n)
    if skinned:
        print('NOTE skinned model: sizes are the rest pose (what the engine shows before a clip plays)')
    base = _sheet_name(glb)
    contact_sheet(n, os.path.join(ROOT, out) if out else os.path.join(SCRATCH, 'sheets', f'{base}.png'))
    if look:
        look_tile(n, os.path.join(SCRATCH, 'sheets', f'{base}-look.png'))
    print('RESULT ok')
    return 0


def cmd_preview(glb, out=None):
    """Cycles beauty render of a GLB from four 3/4 angles with a sun, sky and ground — for judging
    textured or baked assets (the Workbench contact sheet shows flat colour only)."""
    reset()
    gkit.import_glb(glb)
    n = numbers()
    print_numbers(n)
    scene = bpy.context.scene
    set_engine(scene, 'CYCLES')
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 900, 680
    set_view(scene, 'AgX', 'Filmic', 'Standard')
    w = bpy.data.worlds.new('preview_sky')
    scene.world = w
    w.use_nodes = True
    bg = next(x for x in w.node_tree.nodes if x.type == 'BACKGROUND')
    bg.inputs[0].default_value = (0.13, 0.22, 0.38, 1)
    bg.inputs[1].default_value = 0.9
    span = max((n['hi'] - n['lo']).length, 0.1)
    center = (n['lo'] + n['hi']) / 2
    gkit.plane('preview_ground', (span * 20, span * 20), at=(center.x, center.y, n['lo'].z),
               m=gkit.mat('preview_ground', (0.35, 0.3, 0.25)))
    sun = bpy.data.lights.new('preview_sun', 'SUN')
    sun.energy = 3.5
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('preview_sun', sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    tiles = []
    for i, d in enumerate([Vector((-0.9, -1.0, 0.25)), Vector((0.9, -1.0, 0.25)),
                           Vector((-0.9, 1.0, 0.18)), Vector((0.9, 1.0, 0.18))]):
        cam = _camera(scene, f'preview_{i}', 'PERSP', center + d.normalized() * span * 1.15, center, span, lens=40)
        tile = gkit._tmp_path(f'preview-{i}.png')
        scene.render.filepath = tile
        bpy.ops.render.render(write_still=True)
        tiles.append(tile)
        bpy.data.objects.remove(cam, do_unlink=True)
    path = os.path.join(ROOT, out) if out else os.path.join(SCRATCH, 'sheets', f'{_sheet_name(glb)}-preview.png')
    _compose(tiles, 2, 2, scene.render.resolution_x, scene.render.resolution_y, path)
    print(f'SHEET {os.path.relpath(path, ROOT)}  (front-left · front-right / back-left · back-right, Cycles)')
    print('RESULT ok')
    return 0


def main():
    print(f'BLENDER {bpy.app.version_string}')
    if tuple(bpy.app.version) < MIN_BLENDER:
        print(f'FAIL Blender {bpy.app.version_string} is too old — this pipeline needs 4.1 or newer '
              f'(shade_smooth_by_angle, current glTF exporter options). Install a current Blender or set BLENDER=')
        print('RESULT fail')
        return 1
    argv = sys.argv[sys.argv.index('--') + 1:]
    look = '--look' in argv
    argv = [a for a in argv if a not in ('--look', '')]
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == 'build' and len(argv) >= 2:
        return cmd_build(argv[1], look)
    if argv[0] == 'sheet' and len(argv) >= 2:
        return cmd_sheet(argv[1], argv[2] if len(argv) > 2 else None, look)
    if argv[0] == 'preview' and len(argv) >= 2:
        return cmd_preview(argv[1], argv[2] if len(argv) > 2 else None)
    print(__doc__)
    return 2


code = 1
try:
    code = main()
except Exception:                                   # noqa: BLE001 — always end with a RESULT line
    traceback.print_exc()
    print('FAIL the runner raised (see the traceback above)')
    print('RESULT fail')
finally:
    if gkit._run['tmp']:
        shutil.rmtree(gkit._run['tmp'], ignore_errors=True)
sys.exit(code)
