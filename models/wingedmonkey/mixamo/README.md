# Winged Monkey — Mixamo upload pack

Derived from `masters/wingedmonkey/meshes/WingedMonkey.glb` (master untouched).

## Files

| File | Use |
|------|-----|
| `WingedMonkey_mixamo.fbx` | Preferred Mixamo upload |
| `WingedMonkey_mixamo.obj` | Fallback if FBX fails |

Current mesh: **38,143 verts / 31,999 faces**, ~1.75 m tall, mesh-only, feet on origin.

## Upload steps

1. Open [Mixamo](https://www.mixamo.com) → **Upload Character**
2. Drop `WingedMonkey_mixamo.fbx`
3. Place markers (chin, wrists, elbows, knees, groin, hips)
4. Download **FBX Binary**, Skin: **With Skin** (first pack)

## Rebuild

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/export_winged_monkey_mixamo.py
```

## Notes

- Arms are nudged toward a T/A pose for easier marker placement.
- Wings stay in the silhouette (folded on this mesh). If Mixamo mis-detects limbs,
  try the OBJ, or ask for a body-only variant.
- After Mixamo rigs it, drop the downloaded FBX into `models/wingedmonkey/` (derived)
  — never overwrite `masters/`.
