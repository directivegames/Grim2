# The engine mannequin's armature, untouched: same bone names, hierarchy, T-pose rest and root
# transform, so the engine's clips (Idle, Walk, Run, Jump, strafes) drive this model by bone name.
mannequin_rig()
for n in ('Hips', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'):
    p = joint(n)
    print(f'PRINT joint {n:12s} ({p.x:.3f}, {p.y:.3f}, {p.z:.3f})')
