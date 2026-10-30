"""gkit — modelling helpers preloaded into every Blender step script.

Coordinates are Blender's: metres, X right, Y depth (back), Z up. The front of an
asset faces Blender -Y, which exports as glTF +Z. Blender (x, y, z) lands in the
engine at (x, z, -y).

`at` is the centre of the BOTTOM face for box/cyl/cone, so pieces stack on z.
Pass center=True to place by the geometric centre instead.

Every helper returns the new object. Materials are cached by name.
"""
import contextlib
import math
import os
import random

import bpy
from mathutils import Vector

PROJECT_ROOT = os.environ.get('GKIT_PROJECT_ROOT', os.getcwd())
ENGINE_ROOT = os.path.join(PROJECT_ROOT, 'node_modules', '@gnsx', 'genesys.js')

_rng = random.Random(1)


def seed(n):
    """Reseed the shared RNG so a step script rebuilds identically."""
    _rng.seed(n)
    return _rng


def rnd(a=0.0, b=1.0):
    return _rng.uniform(a, b)


# ---------------------------------------------------------------- materials

def mat(name, color, rough=0.8, metal=0.0, emit=None, emit_strength=4.0, alpha=None):
    """Principled material. Sets BSDF base colour AND diffuse_color (the contact
    sheet reads the second). color / emit are (r, g, b) in 0..1, or '#rrggbb'.
    alpha < 1 makes it see-through (glass, ghosts, slime); exports as glTF BLEND."""
    rgb = _rgb(color)
    if name in bpy.data.materials:
        m = bpy.data.materials[name]
        have = tuple(m.diffuse_color)[:3]
        if max(abs(a - b) for a, b in zip(have, rgb)) > 2e-3 or abs(m.roughness - rough) > 1e-3 \
                or abs(m.metallic - metal) > 1e-3:
            print(f"WARN mat '{name}' already exists as {_hex(have)} rough {m.roughness:.2f} metal {m.metallic:.2f}; "
                  f"returned it unchanged, not {_hex(rgb)} rough {rough:.2f} metal {metal:.2f} — "
                  f"give a different colour a different name")
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*_rgb(emit), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        else:
            m.blend_method = 'BLEND'
    m.diffuse_color = (*rgb, 1.0 if alpha is None else alpha)
    m.roughness = rough
    m.metallic = metal
    return m


def shades(name, color, n=3, spread=0.12, **kw):
    """n slightly different materials around one colour — breaks up repeated
    stones or planks without textures. Returns a list."""
    rgb = _rgb(color)
    out = []
    for i in range(n):
        f = 1.0 + spread * (i - (n - 1) / 2) / max(1, (n - 1) / 2)
        out.append(mat(f'{name}_{i}', tuple(min(1.0, c * f) for c in rgb), **kw))
    return out


def _hex(rgb):
    """Linear (r, g, b) → '#rrggbb' (sRGB), for messages."""
    out = ''
    for v in rgb[:3]:
        v = max(0.0, min(1.0, v))
        v = v * 12.92 if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        out += f'{round(v * 255):02x}'
    return '#' + out


def mix(a, b, t=0.5):
    """Blend two colours ('#hex' or linear tuples) in sRGB; t=0 gives a, t=1 gives b. Returns '#hex'.
    Use it for in-between palette shades (a darker trim, a sun-faded roof) instead of new hexes."""
    ha = a.lstrip('#') if isinstance(a, str) else _hex(a)[1:]
    hb = b.lstrip('#') if isinstance(b, str) else _hex(b)[1:]
    ca = [int(ha[i:i + 2], 16) for i in (0, 2, 4)]
    cb = [int(hb[i:i + 2], 16) for i in (0, 2, 4)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(ca, cb))


def _rgb(c):
    if isinstance(c, str):
        c = c.lstrip('#')
        srgb = [int(c[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in srgb)
    return tuple(c)


# ---------------------------------------------------------------- primitives

def _finish(obj, name, m, at, rot, center, height):
    obj.name = name
    obj.data.name = name
    if m is not None:
        obj.data.materials.clear()
        obj.data.materials.append(m)
    x, y, z = at
    obj.location = (x, y, z if center else z + height / 2)
    obj.rotation_euler = tuple(math.radians(r) for r in rot)
    return obj


def box(name, size, at=(0, 0, 0), m=None, rot=(0, 0, 0), center=False, bevel=0.0):
    """size = (width X, depth Y, height Z). rot in degrees."""
    w, d, h = size
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)
    _finish(obj, name, m, at, rot, center, h)
    if bevel > 0:
        add_bevel(obj, bevel)
    return obj


def cyl(name, r, h, at=(0, 0, 0), m=None, seg=12, r2=None, rot=(0, 0, 0), center=False):
    """Cylinder along Z. r2 = top radius (cone / taper); r2=0 makes a cone."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r2, depth=h)
    return _finish(bpy.context.active_object, name, m, at, rot, center, h)


def sphere(name, r, at=(0, 0, 0), m=None, seg=12, rings=8, scale=(1, 1, 1)):
    """UV sphere placed by its centre. scale squashes it (rocks, bushes)."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r)
    obj = bpy.context.active_object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return _finish(obj, name, m, at, (0, 0, 0), True, 0)


def ico(name, r, at=(0, 0, 0), m=None, subdiv=1, scale=(1, 1, 1)):
    """Icosphere placed by its centre — the best base for rocks and rubble."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=r)
    obj = bpy.context.active_object
    obj.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return _finish(obj, name, m, at, (0, 0, 0), True, 0)


def torus(name, R, r, at=(0, 0, 0), m=None, seg=16, minor_seg=8, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r,
                                     major_segments=seg, minor_segments=minor_seg)
    return _finish(bpy.context.active_object, name, m, at, rot, True, 0)


def plane(name, size, at=(0, 0, 0), m=None, rot=(0, 0, 0)):
    """size = (width X, depth Y), lying flat at height at.z."""
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj = bpy.context.active_object
    obj.scale = (size[0], size[1], 1)
    bpy.ops.object.transform_apply(scale=True)
    return _finish(obj, name, m, at, rot, True, 0)


def mesh(name, verts, faces, at=(0, 0, 0), m=None):
    """Arbitrary mesh from vertex and face lists (profiles, wedges, blades)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if m is not None:
        me.materials.append(m)
    obj.location = at
    return obj


def sweep(name, pts, radii, m=None, seg=10, cap=True, ref=None):
    """Tube through pts with elliptical cross-sections radii[i] = (ru, rv): limbs, sleeves,
    hair locks, straps, cables, pipes. `ref` fixes the cross-section's u axis (default: X, or Z
    for near-vertical runs)."""
    pts = [Vector(p) for p in pts]
    verts, faces = [], []
    for i, p in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        t = (b - a).normalized()
        r = Vector(ref) if ref else (Vector((1, 0, 0)) if abs(t.z) > 0.7 else Vector((0, 0, 1)))
        u = (r - t * r.dot(t)).normalized()
        v = t.cross(u)
        ru, rv = radii[i]
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            verts.append(p + u * ru * math.cos(ang) + v * rv * math.sin(ang))
    for i in range(len(pts) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            faces.append((i * seg + k, i * seg + k2, (i + 1) * seg + k2, (i + 1) * seg + k))
    if cap:
        faces.append(tuple(range(seg))[::-1])
        faces.append(tuple((len(pts) - 1) * seg + k for k in range(seg)))
    obj = mesh(name, verts, faces, m=m)
    _recalc_normals(obj)
    return obj


def _recalc_normals(obj):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def rod(name, a, b, r, m=None, seg=8):
    """Straight round bar from point a to point b (posts, rungs, handles, chains, poles)."""
    return sweep(name, [a, b], [(r, r), (r, r)], m=m, seg=seg)


def lathe(name, profile, m=None, seg=16, at=(0, 0, 0), closed=False):
    """Revolve a profile of (radius, z) points around the Z axis: bottles, vases, lamp shades,
    columns, mushrooms, bowls. Radius 0 at an end closes it with a single pole vertex.
    closed=True joins the last point back to the first (a solid shell with wall thickness)."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((0.0, 0.0, z))
            continue
        ring = []
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            ring.append(len(verts))
            verts.append((r * math.cos(ang), r * math.sin(ang), z))
        rings.append(ring)
    pairs = list(zip(rings[:-1], rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for A, B in pairs:
        for k in range(seg):
            k2 = (k + 1) % seg
            if len(A) == 1 and len(B) == 1:
                continue
            if len(A) == 1:
                faces.append((A[0], B[k], B[k2]))
            elif len(B) == 1:
                faces.append((A[k], A[k2], B[0]))
            else:
                faces.append((A[k], A[k2], B[k2], B[k]))
    obj = mesh(name, verts, faces, at=at, m=m)
    _recalc_normals(obj)
    return obj


def blob(name, r, at=(0, 0, 0), m=None, scale=(1, 1, 1), lumpy=0.06, subdiv=2):
    """Soft, lumpy icosphere placed by its centre: foliage puffs, clouds, bushes, slime drops.
    lumpy is the jitter as a fraction of r. Smooth-shaded."""
    o = ico(name, r, at=at, m=m, subdiv=subdiv, scale=scale)
    jitter(o, r * lumpy, keep_bottom=False)
    smooth(o, 80)
    return o


def marker(name, at=(0, 0, 0), rot=(0, 0, 0)):
    """Empty that exports as a named node: spawn points, sockets, light spots.
    The game finds it by name."""
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'ARROWS'
    obj.empty_display_size = 0.3
    obj.location = at
    obj.rotation_euler = tuple(math.radians(r) for r in rot)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------------------------------------------------------------- operations

def _active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def add_bevel(obj, width, segments=1):
    """Bevelled edges catch light — the cheapest way to stop a box reading as a box."""
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    return obj


def cut(obj, cutter, op='DIFFERENCE'):
    """Boolean, applied at once; the cutter is deleted. Keep counts low (slow)."""
    mod = obj.modifiers.new('Bool', 'BOOLEAN')
    mod.object = cutter
    mod.operation = op
    mod.solver = 'EXACT'
    _active(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return obj


def jitter(obj, amount=0.02, keep_bottom=True):
    """Random vertex offsets — hand-made, chipped, stylised look. Applies modifiers
    first. keep_bottom leaves vertices at the object's lowest z flat."""
    _active(obj)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    zmin = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        if keep_bottom and abs(v.co.z - zmin) < 1e-4:
            v.co.x += rnd(-amount, amount)
            v.co.y += rnd(-amount, amount)
            continue
        v.co += Vector((rnd(-amount, amount), rnd(-amount, amount), rnd(-amount, amount)))
    obj.data.update()
    return obj


def join(name, objs):
    """Merge objects into one (keeps per-face materials). One draw call per material."""
    objs = [o for o in objs if o is not None]
    for o in objs:                       # join keeps only the active object's modifiers
        if o.modifiers:
            _active(o)
            for mod in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    obj.data.name = name
    return obj


def meshes(prefix=''):
    """Every mesh object in the scene whose name starts with prefix."""
    return [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith(prefix)]


def ground(objs=None):
    """Move objects (default: all meshes and markers) so the lowest vertex sits on z = 0."""
    objs = objs or [o for o in bpy.context.scene.objects if o.type in ('MESH', 'EMPTY') and o.parent is None]
    dg = bpy.context.evaluated_depsgraph_get()
    zmin = 1e9
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        zmin = min(zmin, min((ev.matrix_world @ v.co).z for v in ev.data.vertices))
    if zmin < 1e9:
        for o in objs:
            o.location.z -= zmin
    return objs


def decimate(obj, tris):
    """Collapse-decimate a dense mesh (a generated or downloaded model) to about `tris`
    triangles, applied. Do it before binding or UV work; check the silhouette on the sheet."""
    obj.data.calc_loop_triangles()
    have = len(obj.data.loop_triangles)
    if have <= tris:
        return obj
    mod = obj.modifiers.new('Decimate', 'DECIMATE')
    mod.ratio = tris / have
    _active(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.calc_loop_triangles()
    print(f'PRINT decimate {obj.name}: {have} → {len(obj.data.loop_triangles)} tris')
    return obj


def shrink_textures(px=1024):
    """Downscale every image texture in the scene to at most px on its long edge (imported and
    generated models often carry 2048–4096 px maps that blow the role's file budget)."""
    for img in bpy.data.images:
        w, h = img.size[:2]
        if img.type != 'IMAGE' or max(w, h) <= px or not w or not h:
            continue
        f = px / max(w, h)
        img.scale(max(1, round(w * f)), max(1, round(h * f)))
        print(f'PRINT shrink_textures {img.name}: {w}×{h} → {img.size[0]}×{img.size[1]}')


def clamp_metal(objs=None, metal=0.85, rough=0.2):
    """Generated models often arrive as mirror metal (metalness > 0.85 and roughness < 0.2), which
    renders black or chrome without a reflection probe. Clamp to metal 0.6 / rough 0.35. Values
    driven by a texture are reported, not changed: judge them on the --look tile."""
    objs = objs or [o for o in bpy.context.scene.objects if o.type == 'MESH']
    seen = set()
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or m in seen or not m.node_tree:
                continue
            seen.add(m)
            b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not b:
                continue
            mi, ri = b.inputs['Metallic'], b.inputs['Roughness']
            if mi.is_linked or ri.is_linked:
                print(f"WARN clamp_metal: '{m.name}' takes metal/roughness from a texture — check the --look tile")
                continue
            if mi.default_value > metal and ri.default_value < rough:
                print(f"PRINT clamp_metal '{m.name}': metal {mi.default_value:.2f} → 0.60, rough {ri.default_value:.2f} → 0.35")
                mi.default_value, ri.default_value = 0.6, 0.35
                m.metallic, m.roughness = 0.6, 0.35
    return objs


def smooth(obj, angle=35):
    """Smooth shading up to angle degrees; sharper edges stay flat."""
    _active(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    return obj


def parent(child, par):
    child.parent = par
    return child


def mirror_x(obj):
    """Duplicate mirrored across X=0 (left/right symmetric parts)."""
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.location.x = -obj.location.x
    dup.scale.x = -obj.scale.x
    bpy.context.scene.collection.objects.link(dup)
    _active(dup)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode='OBJECT')
    return dup


_BLENDER_UNSUPPORTED = {'KHR_texture_basisu', 'EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization'}


def resolve(path):
    """'@engine/...' / '@project/...' / relative → absolute file path."""
    if path.startswith('@engine/'):
        return os.path.join(ENGINE_ROOT, path[len('@engine/'):])
    if path.startswith('@project/'):
        return os.path.join(PROJECT_ROOT, path[len('@project/'):])
    return path if os.path.isabs(path) else os.path.join(PROJECT_ROOT, path)


@contextlib.contextmanager
def _exclusive_lock(lock_path):
    """Hold an exclusive lock on lock_path across processes until the block exits.
    fcntl is POSIX-only, so Windows locks the file's first byte through msvcrt."""
    with open(lock_path, 'a') as f:
        if os.name == 'nt':
            import msvcrt
            f.seek(0)
            while True:
                try:
                    msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
                    break
                except OSError:                   # LK_LOCK gives up after ~10 s; keep waiting
                    pass
            try:
                yield
            finally:
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX)         # released when the file closes
            yield


def importable(path):
    """Engine and compressed GLBs use KTX2 / Meshopt / WebP, which Blender cannot
    read. Convert once through plain-glb.mjs into .scratch/blender/cache. Safe when several
    Blender runs convert the same file at once: one converts under a lock, writes a temp file
    and renames it into place; the others wait and reuse it."""
    import json
    import struct
    import subprocess
    with open(path, 'rb') as f:
        head = f.read(20)
        if head[:4] != b'glTF':
            return path
        length = struct.unpack('<I', head[12:16])[0]
        used = set(json.loads(f.read(length)).get('extensionsUsed', []))
    if not used & _BLENDER_UNSUPPORTED:
        return path
    cache = os.path.join(SCRATCH, 'cache')
    os.makedirs(cache, exist_ok=True)
    key = os.path.relpath(path, PROJECT_ROOT).replace(os.sep, '__').replace('@', '')
    out = os.path.join(cache, key)

    def fresh():
        return os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(path)

    if fresh():
        return out
    with _exclusive_lock(out + '.lock'):
        if fresh():                               # another run converted it while we waited
            return out
        tmp = f'{out}.{os.getpid()}.tmp.glb'
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plain-glb.mjs')
        res = subprocess.run(['node', script, path, tmp], cwd=PROJECT_ROOT, capture_output=True, text=True)
        err = (res.stderr or '').strip()
        if res.returncode != 0 or not os.path.exists(tmp):
            if os.path.exists(tmp):
                os.remove(tmp)
            raise RuntimeError(f'plain-glb.mjs could not convert {os.path.relpath(path, PROJECT_ROOT)} '
                               f'(exit {res.returncode}): {err or "no output"} — run from the project root '
                               f'with node and node_modules installed')
        for line in err.splitlines():
            print(f'WARN plain-glb: {line}')
        os.replace(tmp, out)
    return out


def _drop_import_helpers(new_objs):
    """The glTF importer adds a bone-shape mesh (in a hidden 'glTF_not_exported' collection) for
    skinned files. It never renders in the engine; remove it so numbers and sheets measure only
    what ships."""
    shapes = set()
    for o in new_objs:
        if o.type == 'ARMATURE':
            for pb in o.pose.bones:
                if pb.custom_shape:
                    shapes.add(pb.custom_shape)
                    pb.custom_shape = None
    for o in list(new_objs):
        colls = o.users_collection
        if o in shapes or (colls and all(c.hide_render for c in colls)):
            bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        if c.name.startswith('glTF_not_exported') and not c.objects:
            bpy.data.collections.remove(c)


def import_glb(path, at=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    """Import an existing model ('@engine/...', '@project/...' or a file path) —
    to compose a title still or to measure something next to a reference."""
    src = resolve(path)
    path = importable(src)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    _drop_import_helpers(new)
    new = [o for o in bpy.context.scene.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    holder = bpy.data.objects.new(os.path.basename(src).split('.')[0], None)
    bpy.context.scene.collection.objects.link(holder)
    for o in roots:
        o.parent = holder
    holder.location = at
    holder.rotation_euler = tuple(math.radians(r) for r in rot)
    holder.scale = (scale, scale, scale)
    return holder


# ---------------------------------------------------------------- scratch files (parallel-safe)

SCRATCH = os.path.join(PROJECT_ROOT, '.scratch', 'blender')
_run = {'tmp': None, 'files': []}   # files: scratch outputs of this run (prune keeps them)


def _tmp_path(name):
    """A file path inside this run's private temp folder (.scratch/blender/tmp/<run>/). Every
    intermediate render goes here, so parallel runs never share a file name. The runner
    deletes the folder when the run ends."""
    if _run['tmp'] is None:
        import tempfile
        base = os.path.join(SCRATCH, 'tmp')
        os.makedirs(base, exist_ok=True)
        _run['tmp'] = tempfile.mkdtemp(prefix=f'run-{os.getpid()}-', dir=base)
    return os.path.join(_run['tmp'], name)


def _publish(tmp, final):
    """Move a finished file into place in one step (readers never see half a file)."""
    os.makedirs(os.path.dirname(final), exist_ok=True)
    try:
        os.replace(tmp, final)
    except OSError:                       # different filesystem: copy beside it, then rename
        import shutil
        side = f'{final}.{os.getpid()}.part'
        shutil.copyfile(tmp, side)
        os.replace(side, final)
        os.remove(tmp)
    if os.path.abspath(final).startswith(os.path.abspath(SCRATCH) + os.sep):
        _run['files'].append(os.path.relpath(final, SCRATCH))
    return final


def _save_image(img, final, fmt='PNG'):
    """Save a bpy image to `final` through a temp file + rename."""
    tmp = _tmp_path('img-' + os.path.basename(final))
    img.filepath_raw = tmp
    img.file_format = fmt
    img.save()
    return _publish(tmp, final)


# ---------------------------------------------------------------- stills (title art)

def camera(name, at, look_at=(0, 0, 0), lens=35):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = at
    cam.rotation_euler = (Vector(look_at) - Vector(at)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def sun(strength=3.0, rot=(50, 0, 30), color=(1, 0.95, 0.85)):
    data = bpy.data.lights.new('sun', 'SUN')
    data.energy = strength
    data.color = _rgb(color)
    obj = bpy.data.objects.new('sun', data)
    obj.rotation_euler = tuple(math.radians(r) for r in rot)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def point_light(name, at, power=200.0, color=(1, 0.6, 0.3), radius=0.1):
    data = bpy.data.lights.new(name, 'POINT')
    data.energy = power
    data.color = _rgb(color)
    data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    obj.location = at
    bpy.context.scene.collection.objects.link(obj)
    return obj


def world(color=(0.05, 0.05, 0.07), strength=1.0):
    w = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*_rgb(color), 1.0)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w
    return w


__all__ = [n for n in dir() if not n.startswith('_')] + ['_rgb']
