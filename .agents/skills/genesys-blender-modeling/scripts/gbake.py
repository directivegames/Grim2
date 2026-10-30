"""gbake — opt-in helpers for DETAILED assets: model a high-poly source, build a low-poly game
mesh, and bake the detail (colour, normal, AO) from high to low. Preloaded into every step script
next to gkit; nothing here runs unless a step calls it.

The default flat-palette workflow (gkit only) stays the right choice for most assets. Use this only
when the creator asks for realistic / painterly / textured detail. See references/high-to-low-bake.md.

  proc_mat(...)            weathered procedural Cycles material (grain, patches, per-piece tone, grime)
  BoxBatch                 thousands of boxes in one mesh (shingles, bricks, planks), each its own island
  low_copy(objs)           copy silhouette pieces into the low mesh (no bevels, keeps materials)
  drop_faces(obj, dir)     delete faces that point one way (hidden undersides that waste UV space)
  bake_high_to_low(...)    UV the low mesh, bake high → low, one baked material, high removed
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

import gkit

__all__ = ['proc_mat', 'BoxBatch', 'low_copy', 'drop_faces', 'bake_high_to_low']


def _hex(c):
    return (*gkit._rgb(c), 1.0)


def proc_mat(name, base, dark, light, grain=(2.0, 2.0, 30.0), grain_amt=0.35, patch=0.35, island=0.25,
             dirt=None, dirt_h=0.9, rough=0.8, brick=None):
    """Procedural Cycles material for the HIGH model (it only shows through a bake).
    base/dark/light: '#hex'. grain: Object-space noise stretch — (2, 2, 30) streaks horizontally on
    walls, (30, 2, 2) runs along X (boards). island: per-piece tone shift (each board, shingle, brick
    differs). dirt: '#hex' grime that rises from z = 0 to dirt_h metres. brick: mortar '#hex' adds a
    brick pattern. Returns the material (cached by name)."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    bsdf = N.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough
    tc = N.new('ShaderNodeTexCoord')
    mp = N.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = grain
    L.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = N.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.0
    nz.inputs['Detail'].default_value = 8.0
    nz.inputs['Roughness'].default_value = 0.6
    L.new(mp.outputs['Vector'], nz.inputs['Vector'])
    ramp = N.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.3, _hex(dark)
    els[1].position, els[1].color = 0.75, _hex(light)
    els.new(0.52).color = _hex(base)
    L.new(nz.outputs['Fac'], ramp.inputs['Fac'])

    def mix(blend, fac, a, b=None, b_val=None):
        node = N.new('ShaderNodeMix')
        node.data_type = 'RGBA'
        node.blend_type = blend
        if isinstance(fac, float):
            node.inputs['Factor'].default_value = fac
        else:
            L.new(fac, node.inputs['Factor'])
        if isinstance(a, tuple):
            node.inputs['A'].default_value = a
        else:
            L.new(a, node.inputs['A'])
        if b is not None:
            L.new(b, node.inputs['B'])
        else:
            node.inputs['B'].default_value = b_val
        return node.outputs['Result']

    col = mix('MIX', grain_amt, _hex(base), ramp.outputs['Color'])
    pz = N.new('ShaderNodeTexNoise')
    pz.inputs['Scale'].default_value = 0.6
    pz.inputs['Detail'].default_value = 3.0
    L.new(tc.outputs['Object'], pz.inputs['Vector'])
    col = mix('OVERLAY', patch, col, pz.outputs['Color'])
    if island > 0:
        geo = N.new('ShaderNodeNewGeometry')
        rng = N.new('ShaderNodeMapRange')
        rng.inputs['To Min'].default_value = 1.0 - island
        rng.inputs['To Max'].default_value = 1.0 + island * 0.6
        L.new(geo.outputs['Random Per Island'], rng.inputs['Value'])
        comb = N.new('ShaderNodeCombineColor')
        for ch in ('Red', 'Green', 'Blue'):
            L.new(rng.outputs['Result'], comb.inputs[ch])
        col = mix('MULTIPLY', 1.0, col, comb.outputs['Color'])
    if brick is not None:
        bt = N.new('ShaderNodeTexBrick')
        bt.inputs['Color1'].default_value = _hex(base)
        bt.inputs['Color2'].default_value = _hex(dark)
        bt.inputs['Mortar'].default_value = _hex(brick)
        bt.inputs['Scale'].default_value = 4.0
        bt.inputs['Mortar Size'].default_value = 0.02
        bt.inputs['Brick Width'].default_value = 0.5
        bt.inputs['Row Height'].default_value = 0.25
        bm = N.new('ShaderNodeMapping')
        bm.inputs['Rotation'].default_value = (math.radians(90), 0, 0)
        L.new(tc.outputs['Object'], bm.inputs['Vector'])
        L.new(bm.outputs['Vector'], bt.inputs['Vector'])
        col = mix('MULTIPLY', 0.85, col, bt.outputs['Color'])
    if dirt is not None:
        sep = N.new('ShaderNodeSeparateXYZ')
        L.new(tc.outputs['Object'], sep.inputs['Vector'])
        mr = N.new('ShaderNodeMapRange')
        mr.inputs['From Max'].default_value = dirt_h
        mr.inputs['To Min'].default_value = 0.75
        mr.inputs['To Max'].default_value = 0.0
        L.new(sep.outputs['Z'], mr.inputs['Value'])
        sm = N.new('ShaderNodeMapping')
        sm.inputs['Scale'].default_value = (6.0, 6.0, 0.6)
        L.new(tc.outputs['Object'], sm.inputs['Vector'])
        sz = N.new('ShaderNodeTexNoise')
        sz.inputs['Scale'].default_value = 6.0
        L.new(sm.outputs['Vector'], sz.inputs['Vector'])
        fac = N.new('ShaderNodeMath')
        fac.operation = 'MULTIPLY'
        L.new(mr.outputs['Result'], fac.inputs[0])
        L.new(sz.outputs['Fac'], fac.inputs[1])
        col = mix('MULTIPLY', fac.outputs['Value'], col, b_val=_hex(dirt))
    L.new(col, bsdf.inputs['Base Color'])
    m.diffuse_color = _hex(base)
    return m


class BoxBatch:
    """Many boxes in ONE mesh object — fast where thousands of gkit.box calls would crawl
    (roof shingles, brick courses, planks). Each box stays its own island, so proc_mat's
    per-piece tone still varies box to box.

        b = BoxBatch()
        b.add((w, d, h), center=(x, y, z), rot=Matrix.Rotation(a, 3, 'X'))
        b.build('roof_tabs', m)
    """
    def __init__(self):
        self.v, self.f = [], []

    def add(self, size, center, rot=None):
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        M = rot if rot is not None else Matrix.Identity(3)
        b = len(self.v)
        for (x, y, z) in [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
                          (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]:
            q = M @ Vector((x, y, z))
            self.v.append((q.x + center[0], q.y + center[1], q.z + center[2]))
        self.f += [(b, b + 3, b + 2, b + 1), (b + 4, b + 5, b + 6, b + 7), (b, b + 1, b + 5, b + 4),
                   (b + 1, b + 2, b + 6, b + 5), (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]

    def build(self, name, m=None):
        return gkit.mesh(name, self.v, self.f, m=m)


def low_copy(objs, prefix='low_kept_'):
    """Copy silhouette pieces (posts, rails, stairs, trims) into the low mesh: modifiers (bevels)
    dropped, procedural materials kept — bake_high_to_low bakes them from themselves. Pass the
    ORIGINALS to bake_high_to_low(discard=...) so they are not also used as shell bake sources."""
    out = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        c.modifiers.clear()
        c.name = prefix + o.name
        bpy.context.scene.collection.objects.link(c)
        out.append(c)
    return out


def drop_faces(obj, direction, threshold=0.95):
    """Delete faces whose world normal points along `direction` (e.g. a roof slab's underside that
    faces the attic). Hidden faces still take UV space and bake garbage; remove them."""
    import bmesh
    bpy.context.view_layer.update()
    d = Vector(direction).normalized()
    q = obj.matrix_world.to_quaternion()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if (q @ f.normal).dot(d) > threshold], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def _select(objs, active):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def _ray_visible(objs, on):
    for o in objs:
        o.visible_diffuse = o.visible_glossy = o.visible_shadow = o.visible_transmission = on


def bake_high_to_low(high, shell, kept=(), discard=(), name='SM_Asset', size=2048, ao=0.6, cage=0.15,
                     ray=0.35, angle=40.0, margin=0.004, roughness=0.85, quality=88):
    """Bake the HIGH model's detail onto the LOW game mesh and leave only the low mesh.

    high    objects that carry the detail (bake source; removed afterwards)
    shell   low objects that receive the detail by ray-casting (walls, roof slabs, a crate's box)
    kept    low silhouette copies (low_copy) that bake from their OWN materials (no ray-cast, so they
            never hit their own high twin); they still occlude AO on the shell
    discard high originals of the kept pieces (removed, never a bake source)
    cage    how far outside the shell rays start (m) — must clear the deepest high detail
    ray     max ray length (m); ao: 0 = none … 1 = full baked occlusion multiplied into the colour

    Writes .scratch/blender/<name>-albedo.jpg and -normal.png, packs both, assigns one Principled
    material (base colour + tangent normal map). Returns the joined low object, named `name`.
    The runner exports tangents for it automatically."""
    import numpy as np
    scene = bpy.context.scene
    high = [o for o in high if o is not None]
    for o in discard:
        bpy.data.objects.remove(o, do_unlink=True)
    src = gkit.join(name + '_HIGH', high)
    _select([src], src)
    for mod in list(src.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)

    shell_m = bpy.data.materials.new(name + '_shell')
    for o in shell:
        o.data.materials.clear()
        o.data.materials.append(shell_m)
    low = gkit.join(name, list(shell) + list(kept))
    _select([low], low)
    for mod in list(low.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=margin)
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(name) and o is not src]
    shell_obj = next(o for o in parts if o.data.materials[0] == shell_m)
    kept_objs = [o for o in parts if o is not shell_obj]

    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False

    def bake(img_name, bake_type, samples, colorspace='sRGB', **kw):
        img = bpy.data.images.new(img_name, size, size, alpha=False)
        img.colorspace_settings.name = colorspace
        for o in parts:
            nt = o.data.materials[0].node_tree if o.data.materials[0].use_nodes else None
            if nt is None:
                o.data.materials[0].use_nodes = True
                nt = o.data.materials[0].node_tree
            node = nt.nodes.get('gbake_target') or nt.nodes.new('ShaderNodeTexImage')
            node.name = 'gbake_target'
            node.image = img
            nt.nodes.active = node
        scene.cycles.samples = samples
        _ray_visible(parts, True)
        _ray_visible([shell_obj], False)
        src.hide_render = False
        _select([src, shell_obj], shell_obj)
        bpy.ops.object.bake(type=bake_type, use_selected_to_active=True, cage_extrusion=cage,
                            max_ray_distance=ray, use_clear=True, margin=8, **kw)
        if kept_objs:
            _ray_visible(parts, True)
            src.hide_render = True
            _select(kept_objs, kept_objs[0])
            bpy.ops.object.bake(type=bake_type, use_selected_to_active=False, use_clear=False, margin=8, **kw)
            src.hide_render = False
        a = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        return img, a.reshape(size, size, 4)

    _, col = bake(name + '_col', 'DIFFUSE', 1, pass_filter={'COLOR'})
    occ = None
    if ao > 0:
        _, occ = bake(name + '_ao', 'AO', 24)
    nrm, _ = bake(name + '_normal', 'NORMAL', 1, colorspace='Non-Color', normal_space='TANGENT')

    scratch = gkit.SCRATCH
    os.makedirs(scratch, exist_ok=True)
    final = col.copy()
    if occ is not None:
        final[..., :3] = np.clip(col[..., :3] * ((1.0 - ao) + ao * occ[..., :3]), 0, 1)
    albedo = bpy.data.images.new(name + '_albedo', size, size, alpha=False)
    albedo.pixels.foreach_set(final.ravel())
    scene.render.image_settings.quality = quality
    # Save in the run's temp folder, pack from there, then publish a copy for inspection:
    # two runs baking the same name never write the same file.
    for img, fname, fmt in ((albedo, f'{name}-albedo.jpg', 'JPEG'), (nrm, f'{name}-normal.png', 'PNG')):
        tmp = gkit._tmp_path(fname)
        img.filepath_raw = tmp
        img.file_format = fmt
        img.save()
        img.pack()
        import shutil
        shutil.copyfile(tmp, tmp + '.pub')
        gkit._publish(tmp + '.pub', os.path.join(scratch, fname))

    low = gkit.join(name, parts)
    mt = bpy.data.materials.new(name + '_baked')
    mt.use_nodes = True
    nt = mt.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = roughness
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = albedo
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    mt.diffuse_color = (*[min(1.0, c) for c in final[..., :3].reshape(-1, 3).mean(axis=0)], 1.0)
    low.data.materials.clear()
    low.data.materials.append(mt)
    for poly in low.data.polygons:
        poly.material_index = 0
    _ray_visible([low], True)
    bpy.data.objects.remove(src, do_unlink=True)
    used = {mt}
    for m in list(bpy.data.materials):
        if m not in used and m.users == 0:
            bpy.data.materials.remove(m)
    print(f'PRINT baked {name}: low {len(low.data.polygons)} faces  '
          f'albedo {os.path.getsize(albedo.filepath_raw) / 1024:.0f} KB  normal {os.path.getsize(nrm.filepath_raw) / 1024:.0f} KB')
    return low
