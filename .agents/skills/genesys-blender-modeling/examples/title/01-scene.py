# Title still: the game's own models, staged and lit like key art.
# Uses @project paths of models other Blender folders already exported.
stone = mat('floor', '#3d3a36')
box('floor', (12, 12, 0.2), at=(0, 0, -0.2), m=stone)
for x in (-4, 0, 4):
    import_glb('@project/assets/models/kit/SM_Wall_4m.glb', at=(x, 3, 0))
import_glb('@project/assets/models/props/SM_Chest.glb', at=(0, 1.2, 0), rot=(0, 0, 0))
import_glb('@project/assets/models/creatures/SM_Slime.glb', at=(-1.5, -1.2, 0), rot=(0, 0, 20))
import_glb('@project/assets/models/creatures/SM_Slime.glb', at=(1.7, -0.6, 0), rot=(0, 0, -25), scale=0.8)
for x in (-2.2, 2.2):
    import_glb('@project/assets/models/props/SM_Torch.glb', at=(x, 2.7, 1.6))
    point_light('torch', (x, 2.5, 2.4), power=120, color='#ff9a40', radius=0.2)
point_light('key', (-2.5, -5.0, 3.0), power=900, color='#ffc890', radius=1.0)   # warm key from camera side
point_light('glint', (0, 0.2, 1.6), power=60, color='#ffd27a', radius=0.2)      # the chest glows
world('#05060a', 0.25)
sun(0.6, rot=(60, 0, 150), color='#7d8cff')               # cool moon rim against warm torches
camera('title_cam', (0.6, -6.5, 1.6), look_at=(0, 1.2, 1.0), lens=32)
