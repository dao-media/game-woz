# Reskin — true-scale normalization

- Source copy from: `models/wingedmonkey/working/Monkey_reskin_gargoyle_decimated.blend`
- Working: `models/wingedmonkey/working/Monkey_reskin_gargoyle_normalized.blend`
- Studio GLB: `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` (37.43 MB, Draco off)

## Scales

- Before: {'mesh_scale': [1.0, 1.0, 1.0], 'mesh_local_scale': [99.999977, 99.999977, 100.0], 'mesh_parent': 'ARM_GargoyleNative', 'arm_scale': [0.01, 0.01, 0.01], 'arm_location': [0.0, 1.5, 0.0], 'mesh_world_size': [0.58018, 0.35922, 1.00078], 'mesh_world_height': 1.00078, 'bone_world_size': [0.01566, 0.00603, 0.0104], 'bone_world_height': 0.0104, 'weighted': 7486, 'verts': 7486, 'faces': 15000}
- After: {'mesh_scale': [1.0, 1.0, 1.0], 'mesh_local_scale': [1.0, 1.0, 1.0], 'mesh_parent': 'ARM_GargoyleNative', 'arm_scale': [1.0, 1.0, 1.0], 'arm_location': [0.0, 0.0, -4.7e-05], 'mesh_world_size': [0.58018, 0.35922, 1.00078], 'mesh_world_height': 1.00078, 'bone_world_size': [1.56566, 0.60271, 1.04049], 'bone_world_height': 1.04049, 'weighted': 7486, 'verts': 7486, 'faces': 15000}

## Action note

Baked actions remain bone-local (same rest armature data). Armature object scale 0.01→1 carries animation into true-meter world uniformly with the mesh; no location-key rewrite required.

## Verify

- **FlyIdleLoop**: stable=True rest_h=1.0008 ratios=[0.8329, 0.796, 0.8323] travel=0.3994
- **FlyForward**: stable=True rest_h=1.0008 ratios=[0.8606, 0.6713, 0.8599] travel=0.48
- **Idle**: stable=True rest_h=1.0008 ratios=[0.7563, 0.7389, 0.7559] travel=0.0409
- **Walk**: stable=True rest_h=1.0008 ratios=[0.8139, 0.8549, 0.8161] travel=0.0677
