# A street kid modelled around the mannequin's T-pose joints (front faces -Y; her left arm is +X).
# Joint heights come from 01-rig's PRINT lines. Every part is bound as it is made:
#   soft parts  → bind_nearest(part, region(...))  (cloth and limbs follow only their own region)
#   rigid parts → bind_rigid(part, bone)           (head + hair, hands, carried props)
import bmesh
seed(7)
print(f'PRINT blender {bpy.app.version_string}')
SKIN = mat('girl_skin', '#e0b896', rough=0.7)
HOOD = mat('girl_hoodie', '#b08a3a', rough=0.9)
HOOD2 = mat('girl_hoodie_trim', '#7d6128', rough=0.9)
JEANS = mat('girl_jeans', '#2b2f3f', rough=0.9)
SOLE = mat('girl_sole', '#e6dcc3', rough=0.8)
SHOE = mat('girl_shoe', '#7a2a1f', rough=0.8)
HAIR = mat('girl_hair', '#5a2a2a', rough=0.75)
DARK = mat('girl_eye', '#1a1418', rough=0.4)
BAG = mat('girl_bag', '#ff7518', rough=0.7)

PARTS = []
def soft(o, bones):
    PARTS.append(bind_nearest(o, bones)); return o
def rigid(o, bone):
    PARTS.append(bind_rigid(o, bone)); return o

def surf_y(obj, x, z, ymin=-1.0):
    """Front surface y of obj at (x, z) — places face features on the head."""
    inv = obj.matrix_world.inverted()
    o = inv @ Vector((x, ymin, z)); d = (inv.to_3x3() @ Vector((0, 1, 0))).normalized()
    hit, loc, _, _ = obj.ray_cast(o, d)
    return (obj.matrix_world @ loc).y if hit else None

# ---------------- torso: oversized hoodie
TY = 0.025
rings = [(0.855, 0.205, 0.145), (0.95, 0.20, 0.14), (1.08, 0.19, 0.135), (1.22, 0.195, 0.135),
         (1.35, 0.215, 0.135), (1.43, 0.19, 0.12), (1.48, 0.13, 0.095), (1.51, 0.07, 0.065)]
soft(sweep('hoodie', [(0, TY, z) for z, _, _ in rings], [(rx, ry) for _, rx, ry in rings], HOOD, seg=16), region('torso'))
soft(sweep('hoodie_hem', [(0, TY, 0.825), (0, TY, 0.865)], [(0.212, 0.152)] * 2, HOOD2, seg=16), ['Hips', 'Spine'])
pocket = box('pocket', (0.25, 0.03, 0.13), at=(0, TY - 0.138, 0.93), m=HOOD2, bevel=0.012)
soft(pocket, ['Hips', 'Spine', 'Spine1'])
# hood bunched behind the neck
hood = torus('hood_roll', 0.105, 0.045, at=(0, TY + 0.02, 1.49), m=HOOD, seg=14, minor_seg=7, rot=(-8, 0, 0))
hood.scale = (1.05, 1.05, 0.9)
soft(hood, ['Spine2', 'Neck'])
soft(sphere('hood_back', 1.0, at=(0, TY + 0.12, 1.44), m=HOOD, seg=12, rings=8, scale=(0.14, 0.06, 0.1)), ['Spine2', 'Neck'])
for s in (-1, 1):  # drawstrings
    rigid(sweep('string', [(0.035 * s, TY - 0.13, 1.47), (0.04 * s, TY - 0.15, 1.38), (0.042 * s, TY - 0.15, 1.30)],
                [(0.007, 0.007)] * 3, SOLE, seg=5), 'Spine2')
# ---------------- sleeves + cuffs + hands (left = +X)
AY, AZ = 0.062, 1.436
for s in (-1, 1):
    xs = [0.10, 0.19, 0.33, 0.462, 0.58, 0.685]
    rr = [(0.085, 0.08), (0.08, 0.077), (0.068, 0.066), (0.064, 0.062), (0.066, 0.064), (0.068, 0.066)]
    side = 'Left' if s > 0 else 'Right'
    soft(sweep('sleeve', [(x * s, AY, AZ - (0.01 if x < 0.15 else 0)) for x in xs], rr, HOOD, seg=10), region('arm', side))
    soft(sweep('cuff', [(0.68 * s, AY, AZ), (0.725 * s, AY, AZ)], [(0.058, 0.056)] * 2, HOOD2, seg=10), region('forearm', side))
    hx = [0.705, 0.76, 0.83, 0.885, 0.915]
    hr = [(0.03, 0.034), (0.026, 0.046), (0.024, 0.048), (0.019, 0.042), (0.01, 0.026)]
    hand = sweep('hand', [(x * s, AY, AZ - 0.005) for x in hx], hr, SKIN, seg=8)
    thumb = sweep('thumb', [(0.75 * s, AY - 0.03, AZ - 0.01), (0.79 * s, AY - 0.06, AZ - 0.012), (0.815 * s, AY - 0.075, AZ - 0.012)],
                  [(0.014, 0.016), (0.013, 0.014), (0.009, 0.01)], SKIN, seg=6)
    rigid(join('hand', [hand, thumb]), f'{side}Hand')
# ---------------- legs: jeans
soft(sweep('pelvis', [(0, TY - 0.005, 0.76), (0, TY - 0.005, 0.86), (0, TY - 0.005, 0.96)],
           [(0.165, 0.11), (0.175, 0.12), (0.17, 0.12)], JEANS, seg=14), region('pelvis'))
for s in (-1, 1):
    lp = [(0.095 * s, 0.0, 0.88), (0.096 * s, 0.003, 0.72), (0.094 * s, 0.006, 0.525), (0.093 * s, 0.015, 0.33), (0.092 * s, 0.024, 0.13)]
    lr = [(0.088, 0.088), (0.078, 0.08), (0.063, 0.066), (0.058, 0.06), (0.06, 0.062)]
    soft(sweep('leg', lp, lr, JEANS, seg=10), region('leg', 'Left' if s > 0 else 'Right'))
# ---------------- neck + head
soft(sweep('neck', [(0, 0.03, 1.47), (0, 0.025, 1.6)], [(0.045, 0.043)] * 2, SKIN, seg=10), region('neck'))
HC = Vector((0, -0.005, 1.705))
head = sphere('head', 1.0, at=HC, m=SKIN, seg=20, rings=14, scale=(0.118, 0.123, 0.132))
for v in head.data.vertices:          # narrower chin, rounder cranium
    dz = -v.co.z / 0.132
    if dz > 0:
        f = 1 - 0.22 * dz * dz
        v.co.x *= f; v.co.y *= 1 - 0.1 * dz * dz
smooth(head, 50)
bpy.context.view_layer.update()
face = [head]
for s in (-1, 1):
    ex, ez = 0.045 * s, 1.698
    y = surf_y(head, ex, ez)
    face.append(sphere('eye', 1.0, at=(ex, y + 0.004, ez), m=DARK, seg=10, rings=6, scale=(0.016, 0.01, 0.022)))
    face.append(sphere('glint', 1.0, at=(ex + 0.005, y - 0.004, ez + 0.008), m=SOLE, seg=6, rings=4, scale=(0.005, 0.003, 0.005)))
    by = surf_y(head, 0.047 * s, 1.742)
    face.append(box('brow', (0.042, 0.012, 0.009), at=(0.047 * s, by + 0.001, 1.742), m=HAIR, rot=(0, -8 * s, 0), center=True, bevel=0.003))
    face.append(sphere('ear', 1.0, at=(0.117 * s, 0.0, 1.69), m=SKIN, seg=8, rings=6, scale=(0.018, 0.026, 0.034)))
    face.append(sphere('cheek', 1.0, at=(0.066 * s, surf_y(head, 0.066 * s, 1.655) + 0.004, 1.655), m=SHOE, seg=8, rings=4, scale=(0.016, 0.004, 0.009)))
face.append(sphere('nose', 1.0, at=(0, surf_y(head, 0, 1.668) - 0.006, 1.668), m=SKIN, seg=8, rings=6, scale=(0.012, 0.012, 0.014)))
face.append(box('mouth', (0.036, 0.01, 0.008), at=(0, surf_y(head, 0, 1.628) + 0.002, 1.628), m=SHOE, center=True, bevel=0.003))
# ---------------- hair: cap + bangs + side locks + ponytail
cap = sphere('hair_cap', 1.0, at=HC + Vector((0, 0.008, 0.008)), m=HAIR, seg=20, rings=14, scale=(0.128, 0.133, 0.142))
bm = bmesh.new(); bm.from_mesh(cap.data)
kill = []
for v in bm.verts:
    x, y, z = v.co
    front = -y / 0.133           # 1 at the face, -1 at the back
    thr = -0.03 + 0.3 * max(0.0, front) * 0.142 if front > 0 else -0.06 + 0.75 * front * 0.142
    if z < thr * 1.0 + (0.035 if front > 0.55 else 0.0):
        kill.append(v)
bmesh.ops.delete(bm, geom=kill, context='VERTS')
bm.to_mesh(cap.data); bm.free()
sol = cap.modifiers.new('Sol', 'SOLIDIFY'); sol.thickness = 0.018; sol.offset = -1
hair = [cap]
for x, l in [(-0.075, 0.07), (-0.035, 0.085), (0.005, 0.08), (0.045, 0.085), (0.08, 0.065)]:
    yb = surf_y(head, x, 1.79) or -0.11
    hair.append(sweep('bang', [(x, yb + 0.004, 1.83), (x * 1.04, yb - 0.012, 1.80), (x * 1.08, yb - 0.008, 1.83 - l)],
                      [(0.016, 0.03), (0.014, 0.028), (0.003, 0.004)], HAIR, seg=6, ref=(0, 1, 0)))
for s in (-1, 1):
    lock = sweep('lock', [(0.112 * s, -0.045, 1.76), (0.122 * s, -0.05, 1.66), (0.112 * s, -0.04, 1.585)],
                 [(0.028, 0.02), (0.03, 0.022), (0.012, 0.01)], HAIR, seg=6)
    hair.append(lock)
tail = sweep('ponytail', [(0, 0.12, 1.79), (0, 0.17, 1.77), (0, 0.215, 1.70), (0, 0.235, 1.62), (0, 0.23, 1.55)],
             [(0.035, 0.035), (0.05, 0.045), (0.058, 0.05), (0.048, 0.04), (0.012, 0.012)], HAIR, seg=10)
hair.append(tail)
hair.append(sphere('nape', 1.0, at=(0, 0.045, 1.635), m=HAIR, seg=12, rings=6, scale=(0.105, 0.075, 0.065)))
hair.append(torus('hair_tie', 0.034, 0.012, at=(0, 0.15, 1.785), m=BAG, seg=10, minor_seg=5, rot=(0, 90, 0)))
for o in hair + face:
    apply_all(o)
    for v in o.data.vertices:       # kid-sized head: scale the whole head group up around the neck
        v.co = Vector((0, 0.01, 1.6)) + (v.co - Vector((0, 0.01, 1.6))) * 1.12
rigid(join('head_all', face + hair), 'Head')
# ---------------- sneakers: heel follows Foot, toe follows ToeBase
for s in (-1, 1):
    x = 0.093 * s
    sole = box('sole', (0.105, 0.31, 0.035), at=(x, -0.075, 0.0), m=SOLE, bevel=0.012)
    up = sweep('upper', [(x, 0.06, 0.085), (x, -0.02, 0.085), (x, -0.12, 0.065), (x, -0.19, 0.055), (x, -0.215, 0.05)],
               [(0.055, 0.05), (0.06, 0.052), (0.048, 0.05), (0.035, 0.044), (0.018, 0.03)], SHOE, seg=10)
    up.scale.z = 1.0
    toecap = sphere('toecap', 1.0, at=(x, -0.185, 0.045), m=SOLE, seg=10, rings=6, scale=(0.05, 0.04, 0.025))
    lace = box('laces', (0.04, 0.1, 0.012), at=(x, -0.06, 0.125), m=SOLE, rot=(-14, 0, 0), bevel=0.003)
    shoe = join('shoe', [sole, up, toecap, lace])
    soft(shoe, region('foot', 'Left' if s > 0 else 'Right'))
# ---------------- pumpkin satchel on the right hip + strap over the left shoulder
bag = sphere('bag', 1.0, at=(0, 0, 0), m=BAG, seg=16, rings=8, scale=(0.095, 0.07, 0.08))
for v in bag.data.vertices:
    a = math.atan2(v.co.y / 0.07, v.co.x / 0.095)
    f = 1 + 0.09 * math.cos(8 * a)
    v.co.x *= f; v.co.y *= f
bag.location = (-0.255, -0.02, 0.86)
stem = cyl('stem', 0.014, 0.035, at=(-0.255, -0.02, 0.93), m=HAIR, seg=6, r2=0.009, rot=(0, 15, 0))
rigid(join('bag', [bag, stem]), 'Hips')
strap = sweep('strap', [(-0.24, -0.04, 0.935), (-0.19, -0.135, 1.0), (-0.06, -0.155, 1.17), (0.08, -0.145, 1.36),
                        (0.15, -0.075, 1.50), (0.15, 0.03, 1.535), (0.14, 0.13, 1.46), (0.03, 0.17, 1.25),
                        (-0.13, 0.17, 1.03), (-0.22, 0.08, 0.95)],
              [(0.012, 0.012)] * 10, HOOD2, seg=6, cap=True)
soft(strap, region('spine'))
print(f'PRINT bound parts {len(PARTS)}')
