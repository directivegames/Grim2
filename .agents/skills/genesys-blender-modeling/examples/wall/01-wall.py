# Modular dungeon wall: 4 m wide × 4 m tall × 0.5 m deep, on the 4 m grid. Running-bond
# ashlar blocks with jitter and three stone shades; a plinth and a cap. Front faces -Y.
stone = shades('wall_stone', '#6b665f', n=3, spread=0.18)
dark = mat('wall_dark', '#3d3a36')
seed(11)
W, H, D = 4.0, 4.0, 0.5
box('wall_core', (W, D * 0.6, H), m=dark)                      # mortar / backing
box('wall_plinth', (W, D + 0.08, 0.3), m=dark, bevel=0.02)
row_h, z, row = 0.5, 0.3, 0
blocks = []
while z < H - 0.25:
    x = -W / 2 + (0.0 if row % 2 == 0 else -0.4)
    while x < W / 2:
        w = rnd(0.7, 1.0)
        x0, x1 = max(x, -W / 2), min(x + w, W / 2)
        if x1 - x0 > 0.15:
            b = box('wall_block', (x1 - x0 - 0.04, D, min(row_h, H - 0.25 - z) - 0.04),
                    at=((x0 + x1) / 2, rnd(-0.02, 0.02), z + 0.02), m=stone[int(rnd(0, 3))], bevel=0.025)
            jitter(b, 0.015)                                   # chipped, hand-cut edges
            blocks.append(b)
        x += w
    z += row_h
    row += 1
box('wall_cap', (W, D + 0.1, 0.25), at=(0, 0, H - 0.25), m=dark, bevel=0.03)
wall = join('SM_Wall_4m', [o for o in bpy.context.scene.objects if o.type == 'MESH'])
