# Treasure chest, 0.9 × 0.6 × 0.7 m. Lid is its own object, pivot on the back hinge,
# so the game can rotate `chest_lid` to open it.
wood = shades('chest_wood', '#7a4a2a', n=2)
iron = mat('chest_iron', '#3a3a40', rough=0.45, metal=0.9)
gold = mat('chest_gold', '#e8b440', rough=0.3, metal=1.0)
W, D, H = 0.9, 0.6, 0.42

body = box('chest_body', (W, D, H), m=wood[0], bevel=0.015)
for x in (-W / 2 + 0.04, W / 2 - 0.04):                     # iron corner straps
    box('chest_strap', (0.05, D + 0.02, H + 0.01), at=(x, 0, 0), m=iron)
box('chest_band', (W + 0.02, D + 0.02, 0.05), at=(0, 0, 0.06), m=iron)
box('chest_lock', (0.12, 0.04, 0.14), at=(0, -D / 2 - 0.02, H - 0.16), m=gold, bevel=0.01)
join('chest_base', [o for o in bpy.context.scene.objects if o.name.startswith('chest_') and o.type == 'MESH'])

# lid: half-cylinder planks, pivot at the back hinge (y = +D/2, z = H)
lid_arc = cyl('lid_arc', D / 2, W, at=(0, 0, 0), m=wood[1], seg=12, rot=(0, 90, 0), center=True)
cutter = box('cut', (W + 0.2, D + 0.2, D), at=(0, 0, -D / 2), center=True)
cut(lid_arc, cutter)
for x in (-W / 2 + 0.04, W / 2 - 0.04):
    s = cyl('lid_strap', D / 2 + 0.012, 0.05, at=(x, 0, 0), m=iron, seg=12, rot=(0, 90, 0), center=True)
    cut(s, box('cut', (0.2, D + 0.2, D), at=(x, 0, -D / 2), center=True))
lid = join('chest_lid', [o for o in bpy.context.scene.objects if o.name.startswith(('lid_arc', 'lid_strap'))])
for v in lid.data.vertices:                                  # move geometry so the origin is the hinge
    v.co.y -= D / 2
lid.location = (0, D / 2, H)
marker('loot_spawn', at=(0, 0, H + 0.3))
