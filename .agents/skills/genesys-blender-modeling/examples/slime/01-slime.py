# Slime enemy, ~0.9 m wide. Squashed drop with a flat base, glossy body, darker core,
# eyes and a highlight so it reads as a creature, not a ball. Front faces -Y.
body_m = mat('slime_body', '#5fd35a', rough=0.15)
eye_m = mat('slime_eye', '#101418', rough=0.2)
shine_m = mat('slime_shine', '#e9ffe0', rough=0.1, emit='#e9ffe0', emit_strength=0.6)
seed(7)
body = sphere('slime_body', 0.45, at=(0, 0, 0.32), m=body_m, seg=20, rings=12, scale=(1, 1, 0.75))
for v in body.data.vertices:                                  # drop shape: flatten bottom, pull tip up
    if v.co.z < -0.16: v.co.z = -0.16                      # flat base, no overhang
    if v.co.z > 0.2: v.co.z += (v.co.z - 0.2) * 0.8
jitter(body, 0.01, keep_bottom=False)
smooth(body, 80)
for x in (-0.13, 0.13):
    e = sphere('slime_eye', 0.075, at=(x, -0.36, 0.42), m=eye_m, seg=12, rings=8, scale=(1, 0.5, 1.25))
    smooth(e)
    sphere('slime_eye_glint', 0.022, at=(x + 0.025, -0.4, 0.46), m=shine_m, seg=8, rings=6)
sphere('slime_shine', 0.07, at=(-0.18, -0.2, 0.62), m=shine_m, seg=10, rings=6, scale=(1.4, 0.5, 0.8))
ground()
