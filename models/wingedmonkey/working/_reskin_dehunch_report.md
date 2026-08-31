# Reskin — de-hunch (−37.3°) + 5 extra clips

- Source: `models/wingedmonkey/working/Monkey_reskin_gargoyle_feet_flyidle.blend`
- Working: `models/wingedmonkey/working/Monkey_reskin_gargoyle_dehunch.blend`
- GLB: `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` (38.30 MB)

## Pitch (mid-frame)
- Before (existing 5): `{'Idle': 37.28, 'Walk': 48.12, 'FlyIdleLoop': 29.28, 'FlyForward': 52.08, 'Attack01': 38.43}`
- After (all 10): `{'Idle': -0.02, 'Walk': 10.82, 'FlyIdleLoop': -8.02, 'FlyForward': 14.78, 'Attack01': 1.13, 'IdleToFly': 37.74, 'FlyToIdle': 16.28, 'FlyAttack02': 1.65, 'FlyHit': 5.56, 'Hit': -0.97}`
- FlyFwd − FlyIdle gap: **22.8°** (target ~23°)

## Verify
- Idle upright (~0°): True (-0.02°)
- Fly Idle level hover: True (-8.02°)
- Fly Forward still pitched: True (14.78°)
- Hover-vs-dive gap: True (22.8°)
- Weights unchanged: True
- Rest height: 1.001 m

## New clips
- **IdleToFly**: donor 1330-1390 → 61 frames
- **FlyToIdle**: donor 1240-1300 → 61 frames
- **FlyAttack02**: donor 1520-1600 → 81 frames
- **FlyHit**: donor 1990-2065 → 76 frames
- **Hit**: donor 800-885 → 86 frames
