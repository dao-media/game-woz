#!/usr/bin/env python3
"""
Build a Minimum Viable Product Gargoyle armature on the Winged Monkey.

Keeps only major directional limbs (no twist stacks, no finger forests):
  Pelvis → Spine → Chest → Neck → Head
  Chest → L/R Shoulder → UpperArm → Forearm → Hand
  Pelvis → L/R Hip → Shin → Foot
  Chest → L/R Wing (one bone each, full span to tip)

Reads masters / labeled sources; writes derived models only.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/build_monkey_mvp_armature.py

Then:
  REBAKE_QUICK=1 /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/rebuild_monkey_gargoyle_from_fbx.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
RIGGED_GLB = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
NEW_MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
GARGOYLE_FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
OUT_EDIT = ROOT / "models/wingedmonkey/EDIT_ME_monkey_bind.blend"
REPORT = ROOT / "models/wingedmonkey/Animations/gargoyle/_mvp_armature.json"

# Keep these Gargoyle deform bone names (clip bake + studio look them up).
MVP_BONES = [
    "GargPelvis",
    "GargSpine1",
    "GargRibcage",
    "GargNeck1",
    "GargHead",
    "GargLArmCollarbone",
    "GargLArmUpperarm1",
    "GargLArmForearm1",
    "GargLArmPalm",
    "GargRCollarbone",
    "GargRUpperarm1",
    "GargRForearm1",
    "GargRPalm",
    "GargLLegThigh1",
    "GargLLegCalf1",
    "GargLLegAnkle",
    "GargRThigh1",
    "GargRCalf1",
    "GargRAnkle",
    "GargLWing1",
    "GargRWing1",
]

# Deleted bone → absorb vertex weights into this keeper
WEIGHT_ABSORB: dict[str, str] = {
    "GargSpine2": "GargSpine1",
    "GargSpine3": "GargRibcage",
    "GargNeck2": "GargNeck1",
    "GargJaw": "GargHead",
    "GargTongue1": "GargHead",
    "GargTongue2": "GargHead",
    "GargEyeL": "GargHead",
    "GargEyeR": "GargHead",
    "GargBrowL1": "GargHead",
    "GargBrowR1": "GargHead",
    "GargLidL_T": "GargHead",
    "GargLidR_T": "GargHead",
    "GargLipL": "GargHead",
    "GargLipR": "GargHead",
    "GargTail1": "GargPelvis",
    "GargTail2": "GargPelvis",
    "GargTail3": "GargPelvis",
    "GargLArmUpperarm2": "GargLArmUpperarm1",
    "GargLArmUpperarm3": "GargLArmUpperarm1",
    "GargLArmForearm2": "GargLArmForearm1",
    "GargLArmForearm3": "GargLArmForearm1",
    "GargRUpperarm2": "GargRUpperarm1",
    "GargRUpperarm3": "GargRUpperarm1",
    "GargRForearm2": "GargRForearm1",
    "GargRForearm3": "GargRForearm1",
    "GargLLegThigh2": "GargLLegThigh1",
    "GargLLegCalf2": "GargLLegCalf1",
    "GargLLegToe1": "GargLLegAnkle",
    "GargLLegToe2": "GargLLegAnkle",
    "GargLLegDigit21": "GargLLegAnkle",
    "GargLLegDigit22": "GargLLegAnkle",
    "GargRThigh2": "GargRThigh1",
    "GargRCalf2": "GargRCalf1",
    "GargRToe1": "GargRAnkle",
    "GargRToe2": "GargRAnkle",
    "GargRToe011": "GargRAnkle",
    "GargRToe012": "GargRAnkle",
    "GargLWingWCollarbone": "GargLWing1",
    "GargLWing2": "GargLWing1",
    "GargLWingLWingPalm": "GargLWing1",
    "GargLWingLDigit1": "GargLWing1",
    "GargLWingLDigit2": "GargLWing1",
    "GargWingThumbL": "GargLWing1",
    "GargWingThumbL2": "GargLWing1",
    "GargLDigitMiddle": "GargLWing1",
    "GargLDigitMiddle2": "GargLWing1",
    "GargLDigitMiddle3": "GargLWing1",
    "GargLDigitPink": "GargLWing1",
    "GargLDigitPink2": "GargLWing1",
    "GargRWingWCollarbone": "GargRWing1",
    "GargRWing2": "GargRWing1",
    "GargRWingRWingPalm": "GargRWing1",
    "GargRWingRDigit1": "GargRWing1",
    "GargRWingRDigit2": "GargRWing1",
    "GargWingThumbR": "GargRWing1",
    "GargWingThumbR2": "GargRWing1",
    "GargRDigitMiddle": "GargRWing1",
    "GargRDigitMiddle2": "GargRWing1",
    "GargRDigitMiddle3": "GargRWing1",
    "GargRDigitPink": "GargRWing1",
    "GargRDigitPink2": "GargRWing1",
}

for i in range(5):
    for j in range(1, 4):
        WEIGHT_ABSORB[f"GargLArmDigit{i}{j}"] = "GargLArmPalm"
        WEIGHT_ABSORB[f"GargRDigit{i}{j}"] = "GargRPalm"

# Tripo → MVP Gargoyle weights
TRIPO_TO_MVP: dict[str, str] = {
    "Hip": "GargPelvis",
    "Pelvis": "GargPelvis",
    "Root": "GargPelvis",
    "Waist": "GargSpine1",
    "Spine01": "GargSpine1",
    "Spine02": "GargRibcage",
    "NeckTwist01": "GargNeck1",
    "NeckTwist02": "GargNeck1",
    "Head": "GargHead",
    "L_Clavicle": "GargLArmCollarbone",
    "L_Upperarm": "GargLArmUpperarm1",
    "L_UpperarmTwist01": "GargLArmUpperarm1",
    "L_UpperarmTwist02": "GargLArmUpperarm1",
    "L_Forearm": "GargLArmForearm1",
    "L_ForearmTwist01": "GargLArmForearm1",
    "L_ForearmTwist02": "GargLArmForearm1",
    "L_Hand": "GargLArmPalm",
    "R_Clavicle": "GargRCollarbone",
    "R_Upperarm": "GargRUpperarm1",
    "R_UpperarmTwist01": "GargRUpperarm1",
    "R_UpperarmTwist02": "GargRUpperarm1",
    "R_Forearm": "GargRForearm1",
    "R_ForearmTwist01": "GargRForearm1",
    "R_ForearmTwist02": "GargRForearm1",
    "R_Hand": "GargRPalm",
    "L_Thigh": "GargLLegThigh1",
    "L_ThighTwist01": "GargLLegThigh1",
    "L_ThighTwist02": "GargLLegThigh1",
    "L_Calf": "GargLLegCalf1",
    "L_CalfTwist01": "GargLLegCalf1",
    "L_CalfTwist02": "GargLLegCalf1",
    "L_Foot": "GargLLegAnkle",
    "L_ToeBase": "GargLLegAnkle",
    "R_Thigh": "GargRThigh1",
    "R_ThighTwist01": "GargRThigh1",
    "R_ThighTwist02": "GargRThigh1",
    "R_Calf": "GargRCalf1",
    "R_CalfTwist01": "GargRCalf1",
    "R_CalfTwist02": "GargRCalf1",
    "R_Foot": "GargRAnkle",
    "R_ToeBase": "GargRAnkle",
    "L_WingCollarbone": "GargLWing1",
    "L_Wing1": "GargLWing1",
    "L_Wing2": "GargLWing1",
    "L_WingPalm": "GargLWing1",
    "L_WingDigit1": "GargLWing1",
    "L_WingThumb": "GargLWing1",
    "R_WingCollarbone": "GargRWing1",
    "R_Wing1": "GargRWing1",
    "R_Wing2": "GargRWing1",
    "R_WingPalm": "GargRWing1",
    "R_WingDigit1": "GargRWing1",
    "R_WingThumb": "GargRWing1",
}


def wh(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def wt(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].tail_local


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def mesh_bbox(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    return (
        Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
        Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))),
    )


def wing_tip(mesh: bpy.types.Object, side: str, root: Vector) -> Vector:
    """Outboard wing tip — prefer span along ±X, not feet/hands below."""
    best = None
    best_score = -1e9
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if side == "L":
            if p.x < root.x + 0.02:
                continue
            lateral = p.x - root.x
        else:
            if p.x > root.x - 0.02:
                continue
            lateral = root.x - p.x
        # Strongly prefer outboard; lightly prefer slightly down/back for feathers
        score = lateral * 2.0 + 0.35 * (root.z - p.z) + 0.15 * (p.y - root.y)
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        return root + Vector((0.22 if side == "L" else -0.22, 0.10, -0.15))
    return best


def find_armature_with_bone(names: set[str]) -> bpy.types.Object:
    for o in bpy.data.objects:
        if o.type != "ARMATURE":
            continue
        bone_names = {b.name for b in o.data.bones}
        if names & bone_names:
            return o
    raise RuntimeError(f"No armature containing any of {names}")


def largest_mesh() -> bpy.types.Object:
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("No mesh")
    return max(meshes, key=lambda o: len(o.data.vertices))


def purge_except(keep: set[bpy.types.Object]) -> None:
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


def apply_armature_scale(arm: bpy.types.Object) -> None:
    """Bake FBX 0.01 object scale into edit bones so locals match world meters.

    FBX actions often key object scale every frame — clear anim data first or
    apply is immediately overwritten / ignored.
    """
    if arm.animation_data:
        arm.animation_data_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()
    print(f"applied armature scale → {tuple(round(c, 5) for c in arm.scale)}")


def strip_non_character_meshes(keep: set[bpy.types.Object]) -> None:
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
        if o.type not in {"MESH", "ARMATURE"} and o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


def snapshot_guides(arm: bpy.types.Object) -> dict[str, Vector]:
    guides: dict[str, Vector] = {}
    for b in arm.data.bones:
        x = (arm.matrix_world @ b.matrix_local).to_3x3() @ Vector((1.0, 0.0, 0.0))
        if x.length > 1e-8:
            guides[b.name] = x.normalized()
    return guides


def align_fbx_to_tripo(src: bpy.types.Object, tripo: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    src.location = src.matrix_world.to_translation()
    src.rotation_mode = "XYZ"
    src.rotation_euler = src.matrix_world.to_euler("XYZ")
    src.scale = src.matrix_world.to_scale()
    bpy.context.view_layer.update()

    s_hip = wh(src, "GargPelvis")
    t_hip = wh(tripo, "Hip")
    factor = abs(t_hip.z) / max(abs(s_hip.z), 1e-6)
    src.scale *= factor
    bpy.context.view_layer.update()

    s_hip = wh(src, "GargPelvis")
    src.location += t_hip - s_hip
    bpy.context.view_layer.update()

    # Yaw: Gargoyle hip L→R onto Tripo thigh L→R
    def hip_right(arm: bpy.types.Object, left: str, right: str) -> Vector:
        d = wh(arm, right) - wh(arm, left)
        d.z = 0.0
        return d.normalized() if d.length > 1e-8 else Vector((1, 0, 0))

    br = hip_right(tripo, "L_Thigh", "R_Thigh")
    sr = hip_right(src, "GargLLegThigh1", "GargRThigh1")
    yaw = math.atan2(sr.x * br.y - sr.y * br.x, sr.x * br.x + sr.y * br.y)
    src.rotation_euler[2] += yaw
    bpy.context.view_layer.update()
    s_hip = wh(src, "GargPelvis")
    src.location += t_hip - s_hip
    bpy.context.view_layer.update()
    print(f"FBX align scale={factor:.4f} yaw_deg={math.degrees(yaw):.1f}")


def collapse_to_mvp(arm: bpy.types.Object) -> list[str]:
    """Reparent MVP chain, delete everything else. Returns deleted names."""
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    clear_pose(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    keep = set(MVP_BONES)

    # Desired parents for MVP (after collapse)
    parents = {
        "GargSpine1": "GargPelvis",
        "GargRibcage": "GargSpine1",
        "GargNeck1": "GargRibcage",
        "GargHead": "GargNeck1",
        "GargLArmCollarbone": "GargRibcage",
        "GargLArmUpperarm1": "GargLArmCollarbone",
        "GargLArmForearm1": "GargLArmUpperarm1",
        "GargLArmPalm": "GargLArmForearm1",
        "GargRCollarbone": "GargRibcage",
        "GargRUpperarm1": "GargRCollarbone",
        "GargRForearm1": "GargRUpperarm1",
        "GargRPalm": "GargRForearm1",
        "GargLLegThigh1": "GargPelvis",
        "GargLLegCalf1": "GargLLegThigh1",
        "GargLLegAnkle": "GargLLegCalf1",
        "GargRThigh1": "GargPelvis",
        "GargRCalf1": "GargRThigh1",
        "GargRAnkle": "GargRCalf1",
        "GargLWing1": "GargRibcage",
        "GargRWing1": "GargRibcage",
    }

    for name, pname in parents.items():
        if name in eb and pname in eb:
            b = eb[name]
            b.use_connect = False
            b.parent = eb[pname]

    deleted: list[str] = []
    for b in list(eb):
        if b.name not in keep and b.name != "neutral_bone":
            deleted.append(b.name)
            eb.remove(b)

    # Drop orphan neutral if present
    if "neutral_bone" in eb:
        eb.remove(eb["neutral_bone"])

    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"MVP bones={len(arm.data.bones)} deleted={len(deleted)}")
    return deleted


def set_bone_chain(
    arm: bpy.types.Object,
    names: list[str],
    points: list[Vector],
    guides: dict[str, Vector],
) -> None:
    """Place N bones through N+1 world points (head0, joint1, …, tip)."""
    if len(points) != len(names) + 1:
        raise ValueError(f"{names}: points {len(points)} != {len(names)+1}")
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    for i, name in enumerate(names):
        b = eb[name]
        h_w, t_w = points[i], points[i + 1]
        b.use_connect = False
        b.head = inv @ h_w
        b.tail = inv @ t_w
        if (b.tail - b.head).length < 1e-5:
            b.tail = b.head + Vector((0, 0, 0.02))
        axis = (t_w - h_w).normalized()
        guide = guides.get(name, Vector((0, 1, 0))).copy()
        guide = guide - axis * guide.dot(axis)
        if guide.length < 1e-6:
            guide = Vector((0, 1, 0))
            if abs(axis.dot(guide)) > 0.9:
                guide = Vector((1, 0, 0))
            guide = guide - axis * guide.dot(axis)
        try:
            b.align_roll(guide.normalized())
        except Exception:
            pass
    bpy.ops.object.mode_set(mode="OBJECT")


def fit_mvp_to_tripo(
    garg: bpy.types.Object,
    tripo: bpy.types.Object,
    mesh: bpy.types.Object,
    guides: dict[str, Vector],
) -> dict:
    report: dict = {}

    hip = wh(tripo, "Hip")
    waist = wh(tripo, "Waist")
    sp1 = wh(tripo, "Spine01")
    sp2 = wh(tripo, "Spine02")
    neck = wh(tripo, "NeckTwist01")
    head = wh(tripo, "Head")
    head_t = wt(tripo, "Head")
    if (head_t - head).length < 0.02:
        head_t = head + Vector((0, 0, 0.08))

    # Spine: hip → waist/sp1 → chest → neck → head tip
    chest = sp2.lerp(neck, 0.25)
    set_bone_chain(
        garg,
        ["GargPelvis", "GargSpine1", "GargRibcage", "GargNeck1", "GargHead"],
        [hip, waist.lerp(sp1, 0.4), chest, neck, head, head_t],
        guides,
    )

    # Arms: clavicle → upper → forearm → hand → hand tip
    for side, bones, clav, upper, forearm, hand in (
        (
            "L",
            ["GargLArmCollarbone", "GargLArmUpperarm1", "GargLArmForearm1", "GargLArmPalm"],
            "L_Clavicle",
            "L_Upperarm",
            "L_Forearm",
            "L_Hand",
        ),
        (
            "R",
            ["GargRCollarbone", "GargRUpperarm1", "GargRForearm1", "GargRPalm"],
            "R_Clavicle",
            "R_Upperarm",
            "R_Forearm",
            "R_Hand",
        ),
    ):
        c = wh(tripo, clav)
        u = wh(tripo, upper)
        f = wh(tripo, forearm)
        h = wh(tripo, hand)
        tip = wt(tripo, hand)
        if (tip - h).length < 0.02:
            tip = h + (h - f).normalized() * 0.08
        # Untwist clavicle start: share sternum X=0, keep Tripo Z; average Y
        sternum = wh(garg, "GargRibcage").copy()
        sternum.x = 0.0
        sternum.y = 0.5 * (c.y + sternum.y)
        sternum.z = max(c.z, sternum.z) - 0.01
        # Socket = upperarm head (true shoulder), not wing
        set_bone_chain(garg, bones, [sternum, u, f, h, tip], guides)
        report[f"arm_{side}"] = {
            "sternum": [round(x, 3) for x in sternum],
            "socket": [round(x, 3) for x in u],
            "hand": [round(x, 3) for x in h],
        }

    # Legs: hip → knee → ankle → toe (foot bone aims forward along foot)
    for side, bones, thigh, calf, foot, toe in (
        (
            "L",
            ["GargLLegThigh1", "GargLLegCalf1", "GargLLegAnkle"],
            "L_Thigh",
            "L_Calf",
            "L_Foot",
            "L_ToeBase",
        ),
        (
            "R",
            ["GargRThigh1", "GargRCalf1", "GargRAnkle"],
            "R_Thigh",
            "R_Calf",
            "R_Foot",
            "R_ToeBase",
        ),
    ):
        t0 = wh(tripo, thigh)
        k0 = wh(tripo, calf)
        a0 = wh(tripo, foot)
        toe_h = wh(tripo, toe)
        toe_t = wt(tripo, toe)
        # Foot bone: ankle → toe tip (−Y forward on this bind)
        foot_tip = toe_t if (toe_t - toe_h).length > 1e-4 else toe_h + Vector((0, -0.04, 0))
        # Keep foot mostly horizontal
        foot_tip = Vector((foot_tip.x, foot_tip.y, min(foot_tip.z, a0.z + 0.01)))
        set_bone_chain(garg, bones, [t0, k0, a0, foot_tip], guides)
        dir_f = (foot_tip - a0).normalized()
        report[f"leg_{side}"] = {
            "hip": [round(x, 3) for x in t0],
            "knee": [round(x, 3) for x in k0],
            "ankle": [round(x, 3) for x in a0],
            "foot_dir": [round(x, 3) for x in dir_f],
        }

    # Wings: one bone each, root at Tripo wing → farthest mesh tip
    for side, bone, root_name, w1_name in (
        ("L", "GargLWing1", "L_WingCollarbone", "L_Wing1"),
        ("R", "GargRWing1", "R_WingCollarbone", "R_Wing1"),
    ):
        root = wh(tripo, root_name)
        if w1_name in tripo.data.bones:
            root = wh(tripo, w1_name)
        tip = wing_tip(mesh, side, root)
        # Extend at least to Tripo digit tip along outboard axis
        digit = "L_WingDigit1" if side == "L" else "R_WingDigit1"
        if digit in tripo.data.bones:
            dtip = wt(tripo, digit)
            if (dtip - root).length > (tip - root).length * 0.5:
                # Keep mesh tip if longer/outboard; else use digit direction * mesh reach
                axis = (tip - root)
                if axis.length < 1e-6 or abs(axis.normalized().x) < 0.35:
                    axis = dtip - root
                tip = root + axis.normalized() * max(axis.length, (dtip - root).length * 1.2)
        set_bone_chain(garg, [bone], [root, tip], guides)
        report[f"wing_{side}"] = {
            "root": [round(x, 3) for x in root],
            "tip": [round(x, 3) for x in tip],
            "len": round((tip - root).length, 3),
        }

    # Re-assert parents (edit ops can leave them)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = garg.data.edit_bones
    parenting = {
        "GargSpine1": "GargPelvis",
        "GargRibcage": "GargSpine1",
        "GargNeck1": "GargRibcage",
        "GargHead": "GargNeck1",
        "GargLArmCollarbone": "GargRibcage",
        "GargLArmUpperarm1": "GargLArmCollarbone",
        "GargLArmForearm1": "GargLArmUpperarm1",
        "GargLArmPalm": "GargLArmForearm1",
        "GargRCollarbone": "GargRibcage",
        "GargRUpperarm1": "GargRCollarbone",
        "GargRForearm1": "GargRUpperarm1",
        "GargRPalm": "GargRForearm1",
        "GargLLegThigh1": "GargPelvis",
        "GargLLegCalf1": "GargLLegThigh1",
        "GargLLegAnkle": "GargLLegCalf1",
        "GargRThigh1": "GargPelvis",
        "GargRCalf1": "GargRThigh1",
        "GargRAnkle": "GargRCalf1",
        "GargLWing1": "GargRibcage",
        "GargRWing1": "GargRibcage",
    }
    for name, pname in parenting.items():
        if name in eb and pname in eb:
            eb[name].use_connect = False
            eb[name].parent = eb[pname]
    bpy.ops.object.mode_set(mode="OBJECT")
    return report


def ensure_vgroup(mesh: bpy.types.Object, name: str) -> bpy.types.VertexGroup:
    vg = mesh.vertex_groups.get(name)
    if vg is None:
        vg = mesh.vertex_groups.new(name=name)
    return vg


def remap_tripo_weights(mesh: bpy.types.Object) -> int:
    """Rebuild vertex groups as MVP Gargoyle names from Tripo groups."""
    # Snapshot weights
    nverts = len(mesh.data.vertices)
    accum: dict[str, dict[int, float]] = {n: {} for n in MVP_BONES}

    for vg in mesh.vertex_groups:
        target = TRIPO_TO_MVP.get(vg.name)
        if not target:
            continue
        bucket = accum[target]
        for i in range(nverts):
            try:
                w = vg.weight(i)
            except RuntimeError:
                continue
            if w <= 0:
                continue
            bucket[i] = bucket.get(i, 0.0) + w

    # Clear old groups, write MVP
    for vg in list(mesh.vertex_groups):
        mesh.vertex_groups.remove(vg)

    written = 0
    for name, weights in accum.items():
        if not weights:
            continue
        vg = ensure_vgroup(mesh, name)
        for vi, w in weights.items():
            vg.add([vi], min(w, 1.0), "REPLACE")
        written += 1

    # Normalize per vertex across MVP groups
    names = [n for n in MVP_BONES if mesh.vertex_groups.get(n)]
    for i in range(nverts):
        total = 0.0
        vals: list[tuple[bpy.types.VertexGroup, float]] = []
        for n in names:
            vg = mesh.vertex_groups[n]
            try:
                w = vg.weight(i)
            except RuntimeError:
                continue
            if w > 0:
                vals.append((vg, w))
                total += w
        if total <= 1e-8 or abs(total - 1.0) < 1e-4:
            continue
        for vg, w in vals:
            vg.add([i], w / total, "REPLACE")
    return written


def bind_mesh(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    for mod in list(mesh.modifiers):
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
            mod.use_deform_preserve_volume = True


def align_new_mesh(dst: bpy.types.Object, donor: bpy.types.Object) -> None:
    dst.data = dst.data.copy()
    bpy.ops.object.select_all(action="DESELECT")
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    dcoords = [donor.matrix_world @ v.co for v in donor.data.vertices]
    ncoords = [Vector(v.co) for v in dst.data.vertices]
    dmin = Vector((min(c.x for c in dcoords), min(c.y for c in dcoords), min(c.z for c in dcoords)))
    dmax = Vector((max(c.x for c in dcoords), max(c.y for c in dcoords), max(c.z for c in dcoords)))
    nmin = Vector((min(c.x for c in ncoords), min(c.y for c in ncoords), min(c.z for c in ncoords)))
    nmax = Vector((max(c.x for c in ncoords), max(c.y for c in ncoords), max(c.z for c in ncoords)))
    scale = (dmax.z - dmin.z) / max(nmax.z - nmin.z, 1e-6)
    dcenter = (dmin + dmax) * 0.5
    ncenter = (nmin + nmax) * 0.5
    for v in dst.data.vertices:
        v.co = dcenter + (v.co - ncenter) * scale
    z0 = min(v.co.z for v in dst.data.vertices)
    for v in dst.data.vertices:
        v.co.z += dmin.z - z0
    dst.data.update()


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


def export_skinned(path: Path, arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Never let FBX leftovers ride along
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != mesh and (
            o.name.startswith("Ico") or len(o.data.vertices) < 1000
        ):
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(False)
        o.hide_set(o not in {arm, mesh})
    arm.hide_set(False)
    mesh.hide_set(False)
    arm.select_set(True)
    mesh.select_set(True)
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


def verify(arm: bpy.types.Object) -> dict:
    fwd = Vector((0, -1, 0))
    lt = wh(arm, "GargLLegThigh1")
    rt = wh(arm, "GargRThigh1")
    right = Vector((rt.x - lt.x, rt.y - lt.y, 0))
    if right.length > 1e-6:
        right.normalize()
        fwd = Vector((0, 0, 1)).cross(right).normalized()

    def dire(n: str) -> list[float]:
        d = wt(arm, n) - wh(arm, n)
        return [round(c, 3) for c in d.normalized()]

    lfoot = (wt(arm, "GargLLegAnkle") - wh(arm, "GargLLegAnkle")).normalized()
    return {
        "bone_count": len(arm.data.bones),
        "bones": sorted(b.name for b in arm.data.bones),
        "fwd": [round(c, 3) for c in fwd],
        "L_foot_dir": dire("GargLLegAnkle"),
        "L_foot_dot_fwd": round(lfoot.dot(fwd), 3),
        "L_shin_dir": dire("GargLLegCalf1"),
        "L_hip_dir": dire("GargLLegThigh1"),
        "L_shoulder_dir": dire("GargLArmCollarbone"),
        "L_wing_dir": dire("GargLWing1"),
        "L_wing_len": round((wt(arm, "GargLWing1") - wh(arm, "GargLWing1")).length, 3),
        "clav_head_dy": round(wh(arm, "GargRCollarbone").y - wh(arm, "GargLArmCollarbone").y, 3),
    }


def main() -> None:
    if not RIGGED_GLB.is_file():
        raise SystemExit(f"missing {RIGGED_GLB}")
    if not GARGOYLE_FBX.is_file():
        raise SystemExit(f"missing {GARGOYLE_FBX}")
    if not NEW_MASTER.is_file():
        raise SystemExit(f"missing {NEW_MASTER}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(RIGGED_GLB))
    tripo = find_armature_with_bone({"Hip", "L_Thigh", "Pelvis"})
    mesh = largest_mesh()
    tripo.name = "TripoRef"
    mesh.name = "WingedMonkey"
    # Drop extras from this GLB (keep by name after purge)
    keep_names = {"TripoRef", "WingedMonkey"}
    for o in list(bpy.data.objects):
        if o.name not in keep_names:
            bpy.data.objects.remove(o, do_unlink=True)
    tripo = bpy.data.objects["TripoRef"]
    mesh = bpy.data.objects["WingedMonkey"]
    clear_pose(tripo)
    print(f"tripo bones={len(tripo.data.bones)} mesh_verts={len(mesh.data.vertices)}")

    before_arms = {o.name for o in bpy.data.objects if o.type == "ARMATURE"}
    bpy.ops.import_scene.fbx(
        filepath=str(GARGOYLE_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    garg = next(
        o
        for o in bpy.data.objects
        if o.type == "ARMATURE" and o.name not in before_arms
    )
    garg.name = "GargoyleMonkey"
    # Remove every mesh except WingedMonkey (FBX icosphere / body)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name != "WingedMonkey":
            bpy.data.objects.remove(o, do_unlink=True)
        elif o.type not in {"MESH", "ARMATURE"}:
            bpy.data.objects.remove(o, do_unlink=True)

    garg = bpy.data.objects["GargoyleMonkey"]
    tripo = bpy.data.objects["TripoRef"]
    mesh = bpy.data.objects["WingedMonkey"]
    clear_pose(garg)
    align_fbx_to_tripo(garg, tripo)
    apply_armature_scale(garg)
    guides = snapshot_guides(garg)
    deleted = collapse_to_mvp(garg)
    fit_report = fit_mvp_to_tripo(garg, tripo, mesh, guides)

    # Detach Tripo armature; keep mesh
    mesh = bpy.data.objects["WingedMonkey"]
    garg = bpy.data.objects["GargoyleMonkey"]
    if mesh.parent:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
    if "TripoRef" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["TripoRef"], do_unlink=True)

    nvg = remap_tripo_weights(mesh)
    print(f"remapped weight groups={nvg} verts={len(mesh.data.vertices)}")
    bind_mesh(mesh, garg)
    clear_pose(garg)

    # NEW mesh pack (masters — copy only)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(NEW_MASTER))
    added = [o for o in bpy.data.objects if o not in before]
    new_mesh = max(
        (o for o in added if o.type == "MESH"),
        key=lambda o: len(o.data.vertices),
    )
    new_mesh.name = "WingedMonkeyNEW"
    for o in list(added):
        if o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    new_mesh = bpy.data.objects["WingedMonkeyNEW"]
    mesh = bpy.data.objects["WingedMonkey"]
    garg = bpy.data.objects["GargoyleMonkey"]
    print(f"NEW mesh verts={len(new_mesh.data.vertices)}")
    align_new_mesh(new_mesh, mesh)
    transfer_weights(new_mesh, mesh)
    bind_mesh(new_mesh, garg)

    # Final hygiene
    for o in list(bpy.data.objects):
        if o.name not in {"GargoyleMonkey", "WingedMonkey", "WingedMonkeyNEW"}:
            bpy.data.objects.remove(o, do_unlink=True)
    garg = bpy.data.objects["GargoyleMonkey"]
    mesh = bpy.data.objects["WingedMonkey"]
    new_mesh = bpy.data.objects["WingedMonkeyNEW"]

    v = verify(garg)
    report = {
        "mvp_bones": MVP_BONES,
        "deleted": deleted,
        "weight_groups": nvg,
        "mesh_verts": len(mesh.data.vertices),
        "new_verts": len(new_mesh.data.vertices),
        "arm_scale": [round(c, 5) for c in garg.scale],
        "fit": fit_report,
        "verify": v,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2))
    print("VERIFY", json.dumps(v, indent=2))

    new_mesh.hide_set(True)
    new_mesh.hide_viewport = True
    mesh.hide_set(False)
    mesh.hide_viewport = False
    export_skinned(OUT_CHAR, garg, mesh)

    mesh.hide_set(True)
    mesh.hide_viewport = True
    new_mesh.hide_set(False)
    new_mesh.hide_viewport = False
    export_skinned(OUT_NEW, garg, new_mesh)

    mesh.hide_set(False)
    mesh.hide_viewport = False
    new_mesh.hide_set(False)
    new_mesh.hide_viewport = False

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    new_mesh.hide_viewport = True
    mesh.hide_select = True
    garg.show_in_front = True
    garg.data.display_type = "OCTAHEDRAL"
    bpy.ops.object.select_all(action="DESELECT")
    garg.select_set(True)
    bpy.context.view_layer.objects.active = garg
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_EDIT))
    bpy.ops.object.mode_set(mode="OBJECT")

    print(
        f"DONE mvp bones={v['bone_count']} scale={list(garg.scale)} "
        f"char={OUT_CHAR.stat().st_size} new={OUT_NEW.stat().st_size} "
        f"report={REPORT}"
    )


if __name__ == "__main__":
    main()
