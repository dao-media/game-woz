#!/usr/bin/env python3
"""
Reorient winged-monkey derived character GLBs so rest chest faces −Y in Blender
(= +Z forward in Three.js), matching Dorothy/Mixamo.

Studio applies MODEL_YAW = −90° then Facing N (default for monkey) → world +Z North.
Facing E remains Dorothy-compatible East (world −X).

Rotates edit-bones + mesh verts by the same matrix (no object-level apply),
so skinning IBMs stay consistent. Masters untouched. Clips not rebaked.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/reorient_monkey_bind_to_plus_z.py
"""
from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb",
    ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb",
]


def world_bone_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def flat_chest_forward(arm: bpy.types.Object) -> Vector:
    ls = world_bone_head(arm, "GargLArmCollarbone")
    rs = world_bone_head(arm, "GargRCollarbone")
    right = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right.length < 1e-8:
        return Vector((0.0, -1.0, 0.0))
    right.normalize()
    fwd = Vector((0.0, 0.0, 1.0)).cross(right)
    return fwd.normalized() if fwd.length > 1e-8 else Vector((0.0, -1.0, 0.0))


def skinned_meshes(arm: bpy.types.Object) -> list[bpy.types.Object]:
    out: list[bpy.types.Object] = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.parent == arm:
            out.append(o)
            continue
        for mod in o.modifiers:
            if mod.type == "ARMATURE" and mod.object == arm:
                out.append(o)
                break
    return out


def reorient(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"Missing {path}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = skinned_meshes(arm)

    # Zero any leftover object rotation from a prior bad apply.
    arm.rotation_euler = (0.0, 0.0, 0.0)
    for m in meshes:
        m.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()

    before = flat_chest_forward(arm)
    want = Vector((0.0, -1.0, 0.0))  # Blender −Y → Three +Z (Mixamo)
    yaw = math.atan2(
        before.x * want.y - before.y * want.x,
        before.x * want.x + before.y * want.y,
    )
    R = Matrix.Rotation(yaw, 4, "Z")
    print(
        f"{path.name}: before={[round(c, 3) for c in before]} "
        f"yaw_deg={math.degrees(yaw):.1f} meshes={len(meshes)}"
    )

    # Edit-bone transform (rest)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for eb in arm.data.edit_bones:
        eb.transform(R)
    bpy.ops.object.mode_set(mode="OBJECT")

    # Same rotation on mesh verts (object space == armature space for these files)
    for m in meshes:
        for v in m.data.vertices:
            v.co = R @ v.co
        m.data.update()

    bpy.context.view_layer.update()
    after = flat_chest_forward(arm)
    print(f"  after={[round(c, 3) for c in after]} dot_want={after.dot(want):.3f}")
    if after.dot(want) < 0.95:
        raise SystemExit(f"Reorient failed for {path.name}")

    bpy.ops.object.select_all(action="DESELECT")
    arm.hide_set(False)
    arm.select_set(True)
    for m in meshes:
        m.hide_set(False)
        m.select_set(True)
    bpy.context.view_layer.objects.active = arm

    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
    )
    print(f"  wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    for p in TARGETS:
        reorient(p)
    print("DONE")


if __name__ == "__main__":
    main()
