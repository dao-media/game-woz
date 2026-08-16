#!/usr/bin/env python3
"""
Replace the fitted GargoyleMonkey bind rests with a scaled/yaw-aligned fresh FBX rest.

Why: polyline_fit left pelvis/spine roll ~90° off vs clavicles (pelvis X → world +Y,
shoulders L/R on X). Legs sit front/back, so clip basis quats flex sideways;
wings/arms inherit the same crooked upper-chain frame.

Masters untouched. Writes derived GLBs + blend only.
Then run rebuild_monkey_gargoyle_from_fbx.py to rebake clips against the fixed bind.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/fix_monkey_bind_from_fbx_rest.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
CHAR_GLB = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
NEW_MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
GARGOYLE_FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
REPORT = ROOT / "models/wingedmonkey/Animations/gargoyle/_bind_axis_fix.json"


def world_bone_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def flat_fwd(arm: bpy.types.Object, left: str, right: str) -> Vector:
    ls = world_bone_head(arm, left)
    rs = world_bone_head(arm, right)
    right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right_v.length < 1e-8:
        return Vector((0.0, -1.0, 0.0))
    right_v.normalize()
    f = Vector((0.0, 0.0, 1.0)).cross(right_v)
    return f.normalized() if f.length > 1e-8 else Vector((0.0, -1.0, 0.0))


def hip_yaw_deg(arm: bpy.types.Object) -> float:
    lt = world_bone_head(arm, "GargLLegThigh1")
    rt = world_bone_head(arm, "GargRThigh1")
    d = rt - lt
    return math.degrees(math.atan2(d.y, d.x))


def pelvis_x_yaw_deg(arm: bpy.types.Object) -> float:
    b = arm.data.bones["GargPelvis"]
    x = (arm.matrix_world @ b.matrix_local).to_3x3() @ Vector((1, 0, 0))
    return math.degrees(math.atan2(x.y, x.x))


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def align_fbx_object_to_target(src: bpy.types.Object, target_fwd: Vector, target_hip_z: float) -> None:
    """Uniform scale + yaw so FBX chest matches target forward and pelvis height."""
    bpy.context.view_layer.update()
    # Bake evaluated TRS into object channels (FBX often 0.01 scale).
    src.location = src.matrix_world.to_translation()
    src.rotation_mode = "XYZ"
    src.rotation_euler = src.matrix_world.to_euler("XYZ")
    src.scale = src.matrix_world.to_scale()
    bpy.context.view_layer.update()

    s_hip = world_bone_head(src, "GargPelvis")
    factor = abs(target_hip_z) / max(abs(s_hip.z), 1e-6)
    src.scale *= factor
    bpy.context.view_layer.update()

    s_hip = world_bone_head(src, "GargPelvis")
    src.location.z += target_hip_z - s_hip.z
    src.location.x -= s_hip.x
    src.location.y -= world_bone_head(src, "GargPelvis").y
    bpy.context.view_layer.update()

    g_fwd = flat_fwd(src, "GargLArmCollarbone", "GargRCollarbone")
    yaw = math.atan2(
        g_fwd.x * target_fwd.y - g_fwd.y * target_fwd.x,
        g_fwd.x * target_fwd.x + g_fwd.y * target_fwd.y,
    )
    src.rotation_euler[2] += yaw
    bpy.context.view_layer.update()
    s_hip = world_bone_head(src, "GargPelvis")
    src.location.z += target_hip_z - s_hip.z
    src.location.x -= s_hip.x
    src.location.y -= world_bone_head(src, "GargPelvis").y
    bpy.context.view_layer.update()
    print(
        f"FBX align scale={tuple(round(c,5) for c in src.scale)} "
        f"yaw_deg={math.degrees(yaw):.1f} "
        f"hip_yaw={hip_yaw_deg(src):.1f} pelvis_x_yaw={pelvis_x_yaw_deg(src):.1f}"
    )


def copy_edit_bones_from(src: bpy.types.Object, dst: bpy.types.Object) -> int:
    """Overwrite dst rest bones with src world head/tail/roll (same names)."""
    bpy.context.view_layer.objects.active = dst
    dst.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    # Snapshot src in world while both in object mode — switch src to edit too.
    bpy.ops.object.mode_set(mode="OBJECT")

    # Collect src world head/tail and roll guide from matrix
    src_data: dict[str, tuple[Vector, Vector, Vector]] = {}
    for b in src.data.bones:
        h = src.matrix_world @ b.head_local
        t = src.matrix_world @ b.tail_local
        # Use bone local X mapped to world as align_roll guide
        x = (src.matrix_world @ b.matrix_local).to_3x3() @ Vector((1.0, 0.0, 0.0))
        src_data[b.name] = (h.copy(), t.copy(), x.normalized())

    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.mode_set(mode="EDIT")
    eb = dst.data.edit_bones
    inv = dst.matrix_world.inverted()
    n = 0
    # Parents before children: use armature bone order
    for b in dst.data.bones:
        if b.name not in src_data or b.name not in eb:
            continue
        h_w, t_w, guide = src_data[b.name]
        e = eb[b.name]
        e.head = inv @ h_w
        e.tail = inv @ t_w
        if (e.tail - e.head).length < 1e-6:
            e.tail = e.head + Vector((0.0, 0.0, 0.01))
        try:
            e.align_roll(guide)
        except Exception:
            pass
        n += 1
    bpy.ops.object.mode_set(mode="OBJECT")
    clear_pose(dst)
    return n


def transfer_weights(dst: bpy.types.Object, src: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.data_transfer(
        data_type="VGROUP_WEIGHTS",
        use_auto_transform=False,
        layers_select_src="ALL",
        layers_select_dst="NAME",
        mix_mode="REPLACE",
        mix_factor=1.0,
        vert_mapping="NEAREST",
    )


def bind(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mesh.modifiers.remove(mod)
    if mesh.parent:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_NAME")
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE":
            mod.object = arm


def align_mesh_aabb_to_arm_bounds(dst: bpy.types.Object, arm: bpy.types.Object) -> None:
    """Roughly fit mesh AABB to armature bone-head AABB (keeps feet near z=0)."""
    dst.data = dst.data.copy()
    bpy.ops.object.select_all(action="DESELECT")
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    heads = [arm.matrix_world @ b.head_local for b in arm.data.bones]
    amin = Vector((min(h.x for h in heads), min(h.y for h in heads), min(h.z for h in heads)))
    amax = Vector((max(h.x for h in heads), max(h.y for h in heads), max(h.z for h in heads)))
    # Expand slightly so mesh envelopes bones
    pad = Vector((0.05, 0.08, 0.02))
    amin -= pad
    amax += pad
    # Keep feet on ground: amin.z = 0
    amin.z = 0.0

    coords = [Vector(v.co) for v in dst.data.vertices]
    nmin = Vector((min(c.x for c in coords), min(c.y for c in coords), min(c.z for c in coords)))
    nmax = Vector((max(c.x for c in coords), max(c.y for c in coords), max(c.z for c in coords)))
    nsize = Vector(
        (
            max(nmax.x - nmin.x, 1e-6),
            max(nmax.y - nmin.y, 1e-6),
            max(nmax.z - nmin.z, 1e-6),
        )
    )
    asize = amax - amin
    for v in dst.data.vertices:
        local = Vector(
            (
                (v.co.x - nmin.x) / nsize.x,
                (v.co.y - nmin.y) / nsize.y,
                (v.co.z - nmin.z) / nsize.z,
            )
        )
        v.co = Vector(
            (
                amin.x + local.x * asize.x,
                amin.y + local.y * asize.y,
                amin.z + local.z * asize.z,
            )
        )
    dst.data.update()


def export_skinned(path: Path, arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(o in {arm, mesh})
        if o in {arm, mesh}:
            o.hide_set(False)
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
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    for p in (CHAR_GLB, GARGOYLE_FBX, NEW_MASTER):
        if not p.exists():
            raise SystemExit(f"Missing {p}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(CHAR_GLB))
    bind_arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bind_arm.name = "GargoyleMonkey"
    donor = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
    donor.name = "WingedMonkey"
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != donor:
            bpy.data.objects.remove(o, do_unlink=True)

    before = {
        "hip_yaw": hip_yaw_deg(bind_arm),
        "pelvis_x_yaw": pelvis_x_yaw_deg(bind_arm),
        "chest_fwd": [round(c, 3) for c in flat_fwd(bind_arm, "GargLArmCollarbone", "GargRCollarbone")],
    }
    print(f"BEFORE {before}")

    # Target: Mixamo-style chest −Y (Three +Z), pelvis height from current bind.
    target_fwd = Vector((0.0, -1.0, 0.0))
    target_hip_z = world_bone_head(bind_arm, "GargPelvis").z

    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(GARGOYLE_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before_objs]
    src = next(o for o in added if o.type == "ARMATURE")
    src.name = "GargoyleSourceRest"
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if src.animation_data:
        src.animation_data_clear()

    align_fbx_object_to_target(src, target_fwd, target_hip_z)
    n = copy_edit_bones_from(src, bind_arm)
    print(f"copied {n} bone rests from FBX")

    after = {
        "hip_yaw": hip_yaw_deg(bind_arm),
        "pelvis_x_yaw": pelvis_x_yaw_deg(bind_arm),
        "chest_fwd": [round(c, 3) for c in flat_fwd(bind_arm, "GargLArmCollarbone", "GargRCollarbone")],
        "bones_copied": n,
    }
    print(f"AFTER {after}")
    if abs(after["hip_yaw"]) % 180 > 20 and abs(abs(after["hip_yaw"]) - 180) > 20:
        # Expect ~±180 (L/R on X). 90° means still broken.
        if 70 < abs(after["hip_yaw"]) % 180 < 110:
            raise SystemExit(f"Hip yaw still sideways after fix: {after['hip_yaw']}")

    # Rebind donor (weights already named Garg*)
    bind(donor, bind_arm)

    # NEW mesh from master
    before_objs = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(NEW_MASTER))
    added = [o for o in bpy.data.objects if o not in before_objs]
    new_mesh = next(o for o in added if o.type == "MESH" and len(o.data.vertices) > 1000)
    new_mesh.name = "WingedMonkeyNEW"
    for o in list(added):
        if o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    align_mesh_aabb_to_arm_bounds(new_mesh, bind_arm)
    transfer_weights(new_mesh, donor)
    bind(new_mesh, bind_arm)
    export_skinned(OUT_NEW, bind_arm, new_mesh)

    bpy.data.objects.remove(new_mesh, do_unlink=True)
    bind(donor, bind_arm)
    src.hide_viewport = True
    src.hide_render = True
    export_skinned(OUT_CHAR, bind_arm, donor)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {"before": before, "after": after, "target_fwd": [0.0, -1.0, 0.0]}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"DONE wrote {OUT_CHAR.name} {OUT_NEW.name} report={REPORT}")


if __name__ == "__main__":
    main()
