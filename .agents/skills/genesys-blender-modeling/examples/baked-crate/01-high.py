# HIGH-poly source (bake only, never exported): a 0.8 m planked crate — slats with gaps, a frame,
# diagonal braces, metal corner brackets and nail heads. Materials are procedural (gbake.proc_mat).
from mathutils import Matrix
seed(4)
S = 0.8
wood = proc_mat('crate_wood', '#b07a45', '#6e4524', '#cf9a62', grain=(30.0, 2.0, 2.0), grain_amt=0.6, island=0.25,
                dirt='#4a3a2a', dirt_h=0.25)
frame = proc_mat('crate_frame', '#8f5f34', '#5c3a1d', '#ad7a48', grain=(2.0, 2.0, 30.0), grain_amt=0.55, island=0.2)
metal = proc_mat('crate_metal', '#5a5e68', '#33363d', '#7d828e', grain=(8.0, 8.0, 8.0), island=0.1, rough=0.5)
nails = BoxBatch()
for face in range(4):                       # four sides, each built facing -Y then rotated about Z
    R = Matrix.Rotation(math.radians(90 * face), 3, 'Z')
    for k in range(5):                      # horizontal slats with small gaps
        z = 0.04 + k * (S - 0.08) / 5
        c = R @ Vector((0, -S / 2 + 0.01, z + 0.07))
        b = box('hi_slat', (S - 0.1, 0.03, 0.135), at=(c.x, c.y, z), m=wood, rot=(0, 0, 90 * face), bevel=0.006)
        for sx in (-1, 1):
            n = R @ Vector((sx * (S / 2 - 0.09), -S / 2 - 0.006, z + 0.07))
            nails.add((0.016, 0.01, 0.016), (n.x, n.y, n.z), R)
    for sx in (-1, 1):                      # vertical frame boards at the edges
        c = R @ Vector((sx * (S / 2 - 0.05), -S / 2 - 0.012, 0))
        box('hi_frame', (0.09, 0.03, S), at=(c.x, c.y, 0), m=frame, rot=(0, 0, 90 * face), bevel=0.006)
    c = R @ Vector((0, -S / 2 - 0.02, S / 2))   # diagonal brace
    box('hi_brace', (S * 1.12, 0.025, 0.08), at=(c.x, c.y, c.z), m=frame,
        rot=(0, -45 if face % 2 else 45, 90 * face), center=True, bevel=0.005)
for z in (0.0, S - 0.03):                   # top and bottom: planks across
    for k in range(5):
        x = -S / 2 + 0.08 + k * (S - 0.16) / 4
        box('hi_lid', (0.15, S - 0.02, 0.03), at=(x, 0, z), m=wood, bevel=0.006)
for sx in (-1, 1):                          # metal corner brackets
    for sy in (-1, 1):
        for z in (0.0, S - 0.12):
            box('hi_bracket', (0.13, 0.13, 0.12), at=(sx * (S / 2 - 0.055), sy * (S / 2 - 0.055), z), m=metal, bevel=0.01)
nails.build('hi_nails', metal)
