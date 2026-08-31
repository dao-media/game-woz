# Reskin wing extension

- Source: `models/wingedmonkey/working/Monkey_reskin_gargoyle_polished.blend`
- Working: `models/wingedmonkey/working/Monkey_reskin_gargoyle_wingext.blend`
- GLB: `models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb` (37.45 MB)

## Tip weights (wing share)
- Before L: {'wing': 0.0, 'head': 0.0, 'torso': 0.026, 'other': 0.974, 'n': 120}
- After L:  {'wing': 1.0, 'head': 0.0, 'torso': 0.0, 'other': 0.0, 'n': 120}
- Before R: {'wing': 0.0, 'head': 0.0, 'torso': 0.031, 'other': 0.969, 'n': 120}
- After R:  {'wing': 1.0, 'head': 0.0, 'torso': 0.0, 'other': 0.0, 'n': 120}

## Body (unchanged)
- Head before/after: {'wing': 0.0, 'head': 0.913, 'torso': 0.087, 'other': 0.0, 'n': 2097} / {'wing': 0.0, 'head': 0.913, 'torso': 0.087, 'other': 0.0, 'n': 2097}
- Torso before/after: {'wing': 0.0, 'head': 0.022, 'torso': 0.978, 'other': 0.0, 'n': 2058} / {'wing': 0.0, 'head': 0.022, 'torso': 0.978, 'other': 0.0, 'n': 2058}

## Verify
- Inherit flap: {'w2_tail_travel': 0.3273, 'w4_tail_travel': 0.2268, 'w4_tracks_w2': 0.693, 'pass': True}
- **FlyIdleLoop** spread_ratio=1.0 (1.0 = no tip stretch), w4_travel=0.2268
- **FlyForward** spread_ratio=1.0 (1.0 = no tip stretch), w4_travel=0.2425
- **Attack01** spread_ratio=1.0 (1.0 = no tip stretch), w4_travel=0.2391
