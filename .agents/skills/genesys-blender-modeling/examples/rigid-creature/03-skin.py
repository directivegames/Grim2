# One skinned mesh (every vertex on exactly one bone), then the engine's own clips played on it.
# OPEN .scratch/blender/rigid-creature-walk.png and -run.png after every build.
creature = skin('SKM_Skeleton', PARTS)
smooth(creature, 30)
pose_check('rigid-creature', clips=(('Walk', 0.3), ('Run', 0.25)))
