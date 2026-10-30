# Dressing from the round helpers: a lathe planter with a blob shrub, a rod lamp post, and a
# text sign (text converts to a mesh at export, so signage ships).
pot = mat('pot', mix(ROOF, INK, 0.3))
leaf = mat('leaf', LEAF, rough=0.85)
for x in (-1.75, 1.75):
    lathe(f'planter{x:+.0f}', [(0.0, 0.0), (0.2, 0.0), (0.26, 0.32), (0.22, 0.34), (0.0, 0.3)], m=pot, seg=12,
          at=(x, front - 0.9, 0.18))
    blob(f'shrub{x:+.0f}', 0.3, at=(x, front - 0.9, 0.75), m=leaf, scale=(1, 1, 0.85))
rod('lamp_post', (-2.3, front - 0.9, 0.0), (-2.3, front - 0.9, 1.9), 0.04, m=wood)
box('lamp', (0.18, 0.18, 0.25), at=(-2.3, front - 0.9, 1.9), m=mat('lamp', '#ffd27a', emit='#ffcf3f', emit_strength=3.0))

curve = bpy.data.curves.new('sign_text', type='FONT')
curve.body = 'INN'
curve.align_x = 'CENTER'
curve.size = 0.24
curve.extrude = 0.02
sign = bpy.data.objects.new('sign_text', curve)
bpy.context.scene.collection.objects.link(sign)
sign.location = (0.0, front - 0.08, 2.2)
sign.rotation_euler = (math.radians(90), 0, 0)         # text faces -Y, the front
curve.materials.append(mat('wood', WOOD))
box('sign_board', (0.8, 0.05, 0.3), at=(0.0, front - 0.03, 2.16), m=trim, bevel=0.01)
