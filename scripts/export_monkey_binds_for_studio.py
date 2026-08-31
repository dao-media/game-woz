#!/usr/bin/env python3
"""
Export Winged Monkey NEW mesh skinned bind for 3D Studio from EDIT_ME bind.

Writes derived model only (masters untouched):
  - WingedMonkey_new_wings.glb

Then run scripts/seed_monkey_studio_glbs.ts for *_studio.glb optimization.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/export_monkey_binds_for_studio.py
"""
from __future__ import annotations

from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "models/wingedmonkey/EDIT_ME_monkey_bind.blend"
OUT_NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"


def export_pair(arm: bpy.types.Object, mesh: bpy.types.Object, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        hide = o not in {arm, mesh}
        o.hide_set(hide)
        o.hide_viewport = hide
        o.select_set(not hide)
    arm.hide_set(False)
    mesh.hide_set(False)
    arm.hide_viewport = False
    mesh.hide_viewport = False
    bpy.context.view_layer.objects.active = arm
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        export_rest_position_armature=True,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    if not BLEND.is_file():
        raise SystemExit(f"missing {BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))

    arm = bpy.data.objects.get("GargoyleMonkey")
    new_mesh = bpy.data.objects.get("WingedMonkeyNEW")
    if not arm or arm.type != "ARMATURE":
        raise SystemExit("GargoyleMonkey armature missing")
    if not new_mesh or new_mesh.type != "MESH":
        raise SystemExit("WingedMonkeyNEW mesh missing")

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for wing in ("GargLWing1", "GargRWing1"):
        if wing in eb and "GargRibcage" in eb:
            eb[wing].parent = eb["GargRibcage"]
            eb[wing].use_connect = False
            print(
                f"{wing} parent={eb[wing].parent.name} "
                f"len={round((eb[wing].tail - eb[wing].head).length, 4)}"
            )
    bpy.ops.object.mode_set(mode="OBJECT")

    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()

    export_pair(arm, new_mesh, OUT_NEW)
    print("DONE studio bind export (NEW mesh only)")


if __name__ == "__main__":
    main()
