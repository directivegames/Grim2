# Cottage (building role): walls, door, windows and a gable roof from garch, a railed porch.
# Front faces -Y. The walls are solid boxes; windows and doors stand proud of them (no cuts).
CREAM, ROOF, WOOD, GLASS, LEAF, INK = '#efe6d2', '#b4553e', '#8a5a36', '#7ec8f0', '#4f9a3a', '#2b2d42'
wall = mat('wall', mix(CREAM, '#9a8f7a', 0.25))          # keep large surfaces under albedo 0.85
roof = mat('roof', ROOF, rough=0.7)
wood = mat('wood', WOOD)
trim = mat('trim', mix(CREAM, WOOD, 0.15))
glass = mat('glass', GLASS, rough=0.15, metal=0.0)

W, D, H = 4.0, 3.2, 2.6                                  # walls: 4 m wide, 3.2 m deep, 2.6 m to the eaves
box('walls', (W, D, H), at=(0, 0, 0), m=wall, bevel=0.03)
box('plinth', (W + 0.12, D + 0.12, 0.25), at=(0, 0, 0), m=trim, bevel=0.02)
front = -D / 2
door('door', 0.0, 0.0, 0.95, 2.05, wood, trim, face='-y', plane=front, knob=trim)
for x in (-1.3, 1.3):
    window(f'win_f{x:+.0f}', x, 0.95, 0.9, 1.0, trim, glass, face='-y', plane=front, sill=wood)
window('win_side', 0.0, 0.95, 1.0, 1.0, trim, glass, face='+x', plane=W / 2, sill=wood)
gable_roof('roof', (-W / 2, W / 2), (-D / 2, D / 2), H, H + 1.3, roof, wall, overhang=0.35, cap=wood)
box('chimney', (0.5, 0.5, 1.6), at=(1.1, 0.5, H + 0.5), m=trim, bevel=0.02)

# Porch: a deck in front of the door with a rail on each side of the steps
box('deck', (3.0, 1.2, 0.18), at=(0, front - 0.6, 0), m=wood, bevel=0.02)
rail_run('rail_l', (-1.45, front - 1.15), (-0.7, front - 1.15), 0.18, 0.75, wood, trim, spacing=0.2)
rail_run('rail_r', (0.7, front - 1.15), (1.45, front - 1.15), 0.18, 0.75, wood, trim, spacing=0.2)
marker('entrance', at=(0, front - 1.4, 0))
