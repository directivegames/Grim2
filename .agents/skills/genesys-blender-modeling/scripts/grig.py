"""grig — rigging helpers for characters on the engine mannequin rig, preloaded into every step.

The engine's character animations (Idle, Walk, Run, RunBackward, StrafeLeft, StrafeRight, Jump)
live in @engine/assets/character/mannequinG.glb. Animation configs load them as
`externalAnimationSources` and bind them BY BONE NAME. A model plays them when it carries the
same armature: the same `mixamorig:*` bone names, hierarchy, rest pose (T-pose) and root
transform. So: import the mannequin's armature, model in its rest pose, weight every vertex
to its bones, and export armature + skinned mesh (the runner does this when the scene has an
armature, and `"rig": "mannequin"` in asset.json validates the result).

Weights:
  bind_rigid(obj, bone)            every vertex 100 % on one bone — bony or armoured pieces,
                                   heads, hands, hair, props carried on the body.
  bind_nearest(obj, bones, k=2)    soft parts (sleeves, legs, torso cloth): each vertex follows
                                   the k nearest bone segments, chosen ONLY from `bones`, so a
                                   strap never follows an arm and one leg never pulls the other.
  region('arm', 'Left')            the usual bone list for a body region.
Bone heat (Blender's automatic weights) is not used: on low-poly, multi-part meshes it leaves
vertices unweighted and lets parts follow the wrong limb.

Coordinates are Blender's (Z up, front −Y), the same as gkit. Joint positions: joint('LeftHand').
"""
import math
import os

import bpy
from mathutils import Vector

import gkit

__all__ = ['mannequin_rig', 'rig', 'joint', 'bone_segment', 'region', 'apply_all',
           'bind_rigid', 'bind_nearest', 'skin', 'pose_check']

MANNEQUIN = '@engine/assets/character/mannequinG.glb'
P = 'mixamorig:'
_state = {'rig': None, 'actions': {}}

# Main deform chain: each bone's segment runs from its head to the next joint's head.
_CHILD = {'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck', 'Neck': 'Head', 'Head': 'HeadTop_End'}
for _s in ('Left', 'Right'):
    _CHILD.update({f'{_s}Shoulder': f'{_s}Arm', f'{_s}Arm': f'{_s}ForeArm', f'{_s}ForeArm': f'{_s}Hand',
                   f'{_s}Hand': f'{_s}HandMiddle2', f'{_s}UpLeg': f'{_s}Leg', f'{_s}Leg': f'{_s}Foot',
                   f'{_s}Foot': f'{_s}ToeBase', f'{_s}ToeBase': f'{_s}Toe_End'})

_REGIONS = {
    'torso': ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder'],
    'chest': ['Spine1', 'Spine2', 'Neck'],
    'spine': ['Hips', 'Spine', 'Spine1', 'Spine2'],
    'neck': ['Spine2', 'Neck', 'Head'],
    'pelvis': ['Hips', 'LeftUpLeg', 'RightUpLeg'],
    'arm': ['Spine2', '{s}Shoulder', '{s}Arm', '{s}ForeArm', '{s}Hand'],
    'forearm': ['{s}ForeArm', '{s}Hand'],
    'leg': ['Hips', '{s}UpLeg', '{s}Leg', '{s}Foot'],
    'foot': ['{s}Foot', '{s}ToeBase'],
}


def _name(b):
    return b if b.startswith(P) else P + b


def mannequin_rig():
    """Import the mannequin, keep only its armature at rest pose. Returns the armature object.
    Its clips stay in bpy.data.actions for pose_check()."""
    holder = gkit.import_glb(MANNEQUIN)
    for o in list(holder.children):
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.data.objects.remove(holder, do_unlink=True)
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    assert len(arms) == 1, [o.name for o in arms]
    r = arms[0]
    r.name = 'Armature'
    for o in list(bpy.context.scene.objects):        # the mannequin body and the importer's bone shape
        if o.type == 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    _rest(r)
    _state['rig'] = r
    _state['actions'] = {a.name: a for a in bpy.data.actions}
    d = (joint('LeftHand') - joint('LeftArm')).normalized()
    print(f'PRINT rig bones {len(r.data.bones)}  clips {sorted(_state["actions"])}  '
          f'rest {"T-pose" if abs(d.z) < 0.2 else "A-pose"}  height {joint("HeadTop_End").z:.2f} m')
    return r


def rig():
    assert _state['rig'] is not None, 'call mannequin_rig() in the first step'
    return _state['rig']


def _rest(r):
    ad = r.animation_data
    if ad:
        ad.action = None
        for t in list(ad.nla_tracks):
            ad.nla_tracks.remove(t)
    for pb in r.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()


def joint(b):
    """World-space rest position (Blender coords) of a bone's head, e.g. joint('LeftForeArm')."""
    r = rig()
    return r.matrix_world @ r.data.bones[_name(b)].head_local


def bone_segment(b):
    short = _name(b)[len(P):]
    if short in _CHILD and _name(_CHILD[short]) in rig().data.bones:
        return joint(short), joint(_CHILD[short])
    r = rig()
    bb = r.data.bones[_name(b)]
    return r.matrix_world @ bb.head_local, r.matrix_world @ bb.tail_local


def region(name, side=''):
    """Bone list for a body region: torso, chest, spine, neck, pelvis, arm, forearm, leg, foot.
    Limb regions need side='Left' or 'Right' (the character's own left is +X)."""
    return [_name(b.format(s=side)) for b in _REGIONS[name]]


def apply_all(o):
    """Bake transforms and modifiers so vertex positions are final world positions."""
    gkit._active(o)
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def _group(o, b):
    return o.vertex_groups.get(b) or o.vertex_groups.new(name=b)


def bind_rigid(o, b):
    """Every vertex of o follows bone b at weight 1."""
    apply_all(o)
    b = _name(b)
    assert b in rig().data.bones, b
    _group(o, b).add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    return o


def _seg_dist(p, a, b):
    ab = b - a
    t = 0.0 if ab.length_squared < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def bind_nearest(o, bones, k=2, power=4):
    """Each vertex follows its k nearest bone segments among `bones`, inverse-distance^power."""
    apply_all(o)
    bones = [_name(b) for b in bones]
    segs = {b: bone_segment(b) for b in bones}
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        ds = sorted((_seg_dist(p, *segs[b]), b) for b in bones)[:k]
        if ds[0][0] < 1e-5 or len(ds) == 1:
            ws = {ds[0][1]: 1.0}
        else:
            ws = {b: 1.0 / (d ** power) for d, b in ds}
        tot = sum(ws.values())
        for b, w in ws.items():
            if w / tot > 1e-3:
                _group(o, b).add([v.index], w / tot, 'REPLACE')
    return o


def skin(name, parts, max_influences=4):
    """Join bound parts, bind to the rig (Armature modifier, mesh in armature space as an
    untransformed child — the same layout as mannequinG), clean and verify the weights."""
    r = rig()
    for o in parts:
        assert o.vertex_groups, f'{o.name} has no weights: call bind_rigid/bind_nearest on it'
    obj = gkit.join(name, parts)
    obj.data.transform(r.matrix_world.inverted() @ obj.matrix_world)
    obj.matrix_world = r.matrix_world
    obj.parent = r
    obj.matrix_parent_inverse.identity()
    obj.matrix_basis.identity()
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = r
    names = {g.index: g.name for g in obj.vertex_groups}
    infl, zero = [], 0
    for v in obj.data.vertices:
        gs = sorted(((g.weight, g.group) for g in v.groups if g.weight > 0), reverse=True)
        drop, keep = gs[max_influences:], gs[:max_influences]
        for _, gi in drop:
            obj.vertex_groups[names[gi]].remove([v.index])
        tot = sum(w for w, _ in keep)
        if tot < 1e-6:
            zero += 1
            continue
        for w, gi in keep:
            obj.vertex_groups[names[gi]].add([v.index], w / tot, 'REPLACE')
        infl.append(len(keep))
    used = {obj.vertex_groups[g.group].name for v in obj.data.vertices for g in v.groups if g.weight > 0}
    for g in [g.name for g in obj.vertex_groups if g.name not in used]:
        obj.vertex_groups.remove(obj.vertex_groups[g])
    unknown = used - set(r.data.bones.keys())
    print(f'PRINT skin {name}: verts {len(obj.data.vertices)}  bones {len(used)}  influences '
          f'{min(infl) if infl else 0}-{max(infl) if infl else 0} avg {sum(infl) / max(1, len(infl)):.2f}  unweighted {zero}')
    assert zero == 0, f'{zero} vertices have no weight'
    assert not unknown, f'vertex groups that are not rig bones: {sorted(unknown)}'
    return obj


def pose_check(name, clips=(('Walk', 0.3), ('Run', 0.25), ('Jump', 0.45)), lens=45):
    """Play the mannequin's own clips on the rig and render 3 views per clip to
    .scratch/blender/<name>-<clip>.png (tiles render in the run's private temp folder). OPEN them: limbs follow, nothing stretches, nothing
    stays behind at the origin. Returns the rig to rest pose."""
    r = rig()
    scene = bpy.context.scene
    out_dir = gkit.SCRATCH
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    w = bpy.data.worlds.get('pose_bg') or bpy.data.worlds.new('pose_bg')
    w.color = (0.32, 0.33, 0.36)
    scene.world = w
    scene.render.resolution_x = scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    ad = r.animation_data or r.animation_data_create()
    skinned = [o for o in scene.objects if o.type == 'MESH' and o.parent == r]
    for clip, frac in clips:
        act = _state['actions'].get(clip)
        if act is None:
            print(f'PRINT pose_check: no clip {clip}')
            continue
        ad.action = act
        if hasattr(ad, 'action_slot') and ad.action_slot is None and len(getattr(act, 'slots', [])):
            ad.action_slot = act.slots[0]
        f0, f1 = act.frame_range
        f = f0 + (f1 - f0) * frac
        scene.frame_set(int(f), subframe=f - int(f))
        bpy.context.view_layer.update()
        hips = r.matrix_world @ r.pose.bones[P + 'Hips'].head
        target = Vector((hips.x, hips.y, 0.9))
        dg = bpy.context.evaluated_depsgraph_get()
        moved = total = 0
        for o in skinned:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            moved += sum(1 for a, b in zip(o.data.vertices, me.vertices) if (a.co - b.co).length > 1e-4)
            total += len(o.data.vertices)
            ev.to_mesh_clear()
        tiles = []
        for i, d in enumerate((Vector((-0.75, -1.0, 0.3)), Vector((1.0, 0.0, 0.2)), Vector((0.5, 1.0, 0.35)))):
            cd = bpy.data.cameras.new('pose_cam')
            cd.lens = lens
            cam = bpy.data.objects.new('pose_cam', cd)
            scene.collection.objects.link(cam)
            cam.location = target + d.normalized() * 5.0
            cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
            scene.camera = cam
            p = gkit._tmp_path(f'pose-{clip}-{i}.png')
            scene.render.filepath = p
            bpy.ops.render.render(write_still=True)
            tiles.append(p)
            bpy.data.objects.remove(cam, do_unlink=True)
        out = os.path.join(out_dir, f'{name}-{clip.lower()}.png')
        _stitch(tiles, out, 480)
        print(f'PRINT POSE {clip} frame {f:.1f} of {f0:.0f}-{f1:.0f}: verts moved {moved}/{total}  '
              f'→ .scratch/blender/{name}-{clip.lower()}.png')
    _rest(r)
    scene.frame_set(0)
    scene.camera = None


def _stitch(paths, out, res):
    img = bpy.data.images.new('pose_sheet', res * len(paths), res, alpha=False)
    px = [0.0] * (res * len(paths) * res * 4)
    for i, p in enumerate(paths):
        t = bpy.data.images.load(p)
        tp = list(t.pixels)
        for row in range(res):
            dst = (row * res * len(paths) + i * res) * 4
            px[dst:dst + res * 4] = tp[row * res * 4:(row + 1) * res * 4]
        bpy.data.images.remove(t)
        os.remove(p)
    img.pixels = px
    gkit._save_image(img, out)
    bpy.data.images.remove(img)
