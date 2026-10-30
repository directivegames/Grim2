# HUD icon: the potion pickup model, rendered transparent at 256 px.
# Reuses the model's own step script so the icon always matches the pickup.
exec(open(resolve('blender/potion/01-potion.py')).read())
point_light('key', (0.5, -0.8, 0.6), power=40, color='#ffffff', radius=0.3)
point_light('rim', (-0.6, 0.6, 0.5), power=25, color='#ffd0a0', radius=0.3)
world('#000000', 0.6)
camera('icon_cam', (0.0, -1.0, 0.32), look_at=(0, 0, 0.18), lens=85)
