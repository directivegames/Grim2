# Bake HIGH → LOW and keep only the low box (colour × AO + tangent normal map, 512 px for a prop).
bake_high_to_low(high=[o for o in meshes('hi_')], shell=[bpy.data.objects['low_box']], name='SM_CrateBaked',
                 size=512, cage=0.06, ray=0.15)
