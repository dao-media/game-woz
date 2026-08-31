# Reskin polish — facing + ground + torso/head weights

- Source: `models/wingedmonkey/working/Monkey_reskin_gargoyle_normalized.blend`
- Working: `models/wingedmonkey/working/Monkey_reskin_gargoyle_polished.blend`
- Studio GLB: `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` (37.43 MB, Draco off)

## Weights (head / torso region share)
- Before head: {'wing': 0.556, 'head': 0.4, 'torso': 0.0, 'other': 0.043, 'n': 1880}
- After head:  {'wing': 0.0, 'head': 0.946, 'torso': 0.054, 'other': 0.0, 'n': 1880}
- Before torso: {'wing': 0.178, 'head': 0.033, 'torso': 0.02, 'other': 0.769, 'n': 1945}
- After torso:  {'wing': 0.018, 'head': 0.0, 'torso': 0.974, 'other': 0.008, 'n': 1945}
- Wing verts locked: 1696

## Actions (pre → post mid-frame)
- **Idle**: yaw 179.08→-179.84, min_z 0.0046→-0.0, h 0.7373→0.7373
- **Walk**: yaw 178.28→-179.84, min_z -0.0294→0.0, h 0.8504→0.8504
- **FlyIdleLoop**: yaw 177.85→-179.84, min_z 1.9146→0.0, h 0.6938→0.6938
- **FlyForward**: yaw 176.86→-179.84, min_z 1.9389→0.0, h 0.6535→0.6535
- **Attack01**: yaw -68.56→-179.84, min_z -0.1017→0.0, h 0.9043→0.9043

## Verify
- **FlyIdleLoop**: facing_ok=True grounded_ok=True stable=True max_yaw_err=0.0 max_min_z=0.0
- **FlyForward**: facing_ok=True grounded_ok=True stable=True max_yaw_err=0.0 max_min_z=-0.0
- **Attack01**: facing_ok=True grounded_ok=True stable=True max_yaw_err=0.0 max_min_z=-0.0
