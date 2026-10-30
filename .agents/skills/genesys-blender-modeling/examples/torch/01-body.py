# Wall torch, 0.77 m. The flame is an emissive low-poly crystal; `light_socket` marks where
# the game puts its PointLight and flame VFX.

iron = mat('iron', '#2b2a2e', rough=0.6, metal=0.8)
wood = mat('wood', '#6b4a2f')
flame = mat('flame', '#ffb347', emit='#ff8a2a', emit_strength=6)
seed(3)
handle = cyl('torch_handle', 0.035, 0.45, m=wood, seg=8, r2=0.045)
cup = cyl('torch_cup', 0.06, 0.12, at=(0, 0, 0.45), m=iron, seg=10, r2=0.09)
add_bevel(cup, 0.008)
f = ico('torch_flame', 0.07, at=(0, 0, 0.62), m=flame, subdiv=1, scale=(1, 1, 1.8))
jitter(f, 0.012, keep_bottom=False)
marker('light_socket', at=(0, 0, 0.66))
