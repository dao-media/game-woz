# Winged Monkey — Gargoyle armature transplant

The monkey mesh is skinned to a **proportion-fitted Gargoyle skeleton** (`WingedMonkey_gargoyle.glb`). Clips are visual-baked from `GargoyleHumanoid.FBX` Take 001 onto that same bone naming.

## Pipeline

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python scripts/transplant_gargoyle_armature_to_monkey.py
```

Masters: `masters/wingedmonkey/meshes/`. Do not edit in place.
