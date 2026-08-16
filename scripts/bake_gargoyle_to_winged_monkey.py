#!/usr/bin/env python3
"""
Retarget Infinity PBR GargoyleHumanoid Take 001 clips onto Winged Monkey.

Reads:
  - models/wingedmonkey/WingedMonkey_rigged.glb (derived from masters)
  - Unity GargoyleHumanoid.FBX (source motion — not modified)

Writes:
  - models/wingedmonkey/Animations/gargoyle/<Clip>.glb

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/bake_gargoyle_to_winged_monkey.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras import anim_utils
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
MONKEY_GLB = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
GARGOYLE_FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
OUT_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle"

# Unity FBX.meta clip slices (Take 001 @ 30fps)
CLIPS: list[tuple[str, int, int]] = [
    ("Tpose", 0, 5),
    ("Idle", 80, 190),
    ("IdleBreak", 200, 340),
    ("Walk", 360, 390),
    ("Attack01", 410, 470),
    ("Cast01", 470, 545),
    ("Cast02", 545, 570),
    ("Cast03", 570, 608),
    ("Sheild01", 610, 630),
    ("Sheild02", 630, 680),
    ("Sheild03", 680, 700),
    ("Attack02", 720, 785),
    ("Hit", 800, 885),
    ("DeathStanding", 900, 940),
    ("Statue01", 964, 966),
    ("Statue02", 984, 987),
    ("Statue03", 1004, 1006),
    ("GroundToFly", 1140, 1179),
    ("FlyForward", 1180, 1210),
    ("FlyToIdle", 1240, 1300),
    ("FlyIdleLoop", 1305, 1335),
    ("IdleToFly", 1330, 1390),
    ("FlyAttack01", 1410, 1490),
    ("FlyAttack02", 1520, 1600),
    ("FlyCast", 1620, 1735),
    ("DieFly", 1750, 1850),
    ("FlyLand", 1870, 1900),
    ("FlyBackward", 1930, 1960),
    ("FlyHit", 1990, 2065),
    ("WalkBackward", 2120, 2160),
]

# Gargoyle → Winged Monkey (Tripo + wing bones)
BONE_MAP: dict[str, str] = {
    "GargPelvis": "Hip",
    "GargSpine1": "Waist",
    "GargSpine2": "Spine01",
    "GargSpine3": "Spine02",
    "GargRibcage": "Spine02",
    "GargNeck1": "NeckTwist01",
    "GargNeck2": "NeckTwist02",
    "GargHead": "Head",
    "GargLArmCollarbone": "L_Clavicle",
    "GargLArmUpperarm1": "L_Upperarm",
    "GargLArmForearm1": "L_Forearm",
    "GargLArmPalm": "L_Hand",
    "GargRCollarbone": "R_Clavicle",
    "GargRUpperarm1": "R_Upperarm",
    "GargRForearm1": "R_Forearm",
    "GargRPalm": "R_Hand",
    "GargLLegThigh1": "L_Thigh",
    "GargLLegCalf1": "L_Calf",
    "GargLLegAnkle": "L_Foot",
    "GargLLegToe1": "L_ToeBase",
    "GargRThigh1": "R_Thigh",
    "GargRCalf1": "R_Calf",
    "GargRAnkle": "R_Foot",
    "GargRToe1": "R_ToeBase",
    # Wings
    "GargLWingWCollarbone": "L_WingCollarbone",
    "GargLWing1": "L_Wing1",
    "GargLWing2": "L_Wing2",
    "GargLWingLWingPalm": "L_WingPalm",
    "GargLWingLDigit1": "L_WingDigit1",
    "GargWingThumbL": "L_WingThumb",
    "GargRWingWCollarbone": "R_WingCollarbone",
    "GargRWing1": "R_Wing1",
    "GargRWing2": "R_Wing2",
    "GargRWingRWingPalm": "R_WingPalm",
    "GargRWingRDigit1": "R_WingDigit1",
    "GargWingThumbR": "R_WingThumb",
}


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_monkey_armature() -> bpy.types.Object:
    for o in bpy.data.objects:
        if o.type == "ARMATURE" and "Hip" in o.data.bones and "L_Wing1" in o.data.bones:
            return o
    for o in bpy.data.objects:
        if o.type == "ARMATURE" and "Hip" in o.data.bones:
            return o
    raise RuntimeError("Monkey armature not found")


def bone_world_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    return arm.matrix_world @ arm.pose.bones[bone_name].matrix


def shoulder_fwd(arm: bpy.types.Object, left: str, right: str) -> Vector:
    ls = bone_world_matrix(arm, left).translation
    rs = bone_world_matrix(arm, right).translation
    right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right_v.length < 1e-8:
        return Vector((0.0, 1.0, 0.0))
    right_v.normalize()
    fwd = Vector((0.0, 0.0, 1.0)).cross(right_v)
    return fwd.normalized() if fwd.length > 1e-8 else Vector((0.0, 1.0, 0.0))


def align_source_to_target(src: bpy.types.Object, tgt: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    src_hip = src.pose.bones["GargPelvis"]
    tgt_hip = tgt.pose.bones["Hip"]
    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    tgt_hip_w = (tgt.matrix_world @ tgt_hip.matrix).translation

    src_h = max(abs(src_hip_w.z), 1e-4)
    tgt_h = max(abs(tgt_hip_w.z), 1e-4)
    scale = tgt_h / src_h
    src.scale *= scale
    bpy.context.view_layer.update()

    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    src.location += tgt_hip_w - src_hip_w
    bpy.context.view_layer.update()

    try:
        src_fwd = shoulder_fwd(src, "GargLArmCollarbone", "GargRCollarbone")
        tgt_fwd = shoulder_fwd(tgt, "L_Clavicle", "R_Clavicle")
        yaw = math.atan2(
            src_fwd.x * tgt_fwd.y - src_fwd.y * tgt_fwd.x,
            src_fwd.x * tgt_fwd.x + src_fwd.y * tgt_fwd.y,
        )
        src.rotation_euler[2] += yaw
        bpy.context.view_layer.update()
        src_hip_w = (src.matrix_world @ src_hip.matrix).translation
        src.location += tgt_hip_w - src_hip_w
        bpy.context.view_layer.update()
    except KeyError:
        pass

    print(f"align scale={scale:.4f}")


def clear_constraints(tgt: bpy.types.Object) -> None:
    for pb in tgt.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])


def add_constraints(src: bpy.types.Object, tgt: bpy.types.Object) -> list[str]:
    clear_constraints(tgt)
    mapped: list[str] = []
    for src_name, tgt_name in BONE_MAP.items():
        if src_name not in src.pose.bones or tgt_name not in tgt.pose.bones:
            print(f"skip missing {src_name} → {tgt_name}")
            continue
        pb = tgt.pose.bones[tgt_name]
        rot = pb.constraints.new("COPY_ROTATION")
        rot.target = src
        rot.subtarget = src_name
        rot.target_space = "WORLD"
        rot.owner_space = "WORLD"
        rot.mix_mode = "REPLACE"

        if tgt_name == "Hip":
            loc = pb.constraints.new("COPY_LOCATION")
            loc.target = src
            loc.subtarget = src_name
            loc.target_space = "WORLD"
            loc.owner_space = "WORLD"
        mapped.append(tgt_name)
    print(f"constraints on {len(mapped)} bones")
    return mapped


def action_fcurves(action: bpy.types.Action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def action_fcurve_count(action: bpy.types.Action) -> int:
    return sum(1 for _ in action_fcurves(action))


def retime_action_to_zero(action: bpy.types.Action, frame_start: int, frame_end: int) -> None:
    """Shift keys so clip starts at frame 0 (needed for glTF / Three.js playback)."""
    offset = -float(frame_start)
    for fcu in action_fcurves(action):
        for kp in fcu.keyframe_points:
            kp.co[0] += offset
            kp.handle_left[0] += offset
            kp.handle_right[0] += offset
        fcu.update()
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = max(0, frame_end - frame_start)


def bake_clip(
    tgt: bpy.types.Object,
    name: str,
    frame_start: int,
    frame_end: int,
) -> bpy.types.Action:
    frames = list(range(frame_start, frame_end + 1))
    opts = anim_utils.BakeOptions(
        only_selected=False,
        do_pose=True,
        do_object=False,
        do_visual_keying=True,
        do_constraint_clear=False,
        do_parents_clear=False,
        do_clean=False,
        do_location=True,
        do_rotation=True,
        do_scale=False,
        do_bbone=False,
        do_custom_props=False,
    )
    action = anim_utils.bake_action(tgt, action=None, frames=frames, bake_options=opts)
    if action is None:
        raise RuntimeError(f"bake_action returned None for {name}")
    action.name = name
    retime_action_to_zero(action, frame_start, frame_end)
    return action


def export_clip_glb(
    tgt: bpy.types.Object,
    action: bpy.types.Action,
    path: Path,
    frame_start: int,
    frame_end: int,
) -> None:
    """Export armature + animation only (studio already loads the skinned mesh)."""
    if not tgt.animation_data:
        tgt.animation_data_create()
    tgt.animation_data.action = action
    duration = max(0, frame_end - frame_start)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = duration
    scene.frame_set(0)

    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    tgt.hide_set(False)
    tgt.select_set(True)
    # Hide meshes so selection export stays animation-only / small.
    mesh_vis: list[tuple[bpy.types.Object, bool]] = []
    for o in bpy.data.objects:
        if o.type == "MESH":
            mesh_vis.append((o, o.hide_get()))
            o.hide_set(True)
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIVE_ACTIONS",
            export_nla_strips=False,
            export_skins=False,
            export_morph=False,
            export_apply=False,
            export_texcoords=False,
            export_normals=False,
            export_materials="NONE",
        )
    finally:
        for o, hidden in mesh_vis:
            o.hide_set(hidden)
    print(
        f"wrote {path.name} ({path.stat().st_size} bytes) "
        f"len={duration}f fcurves={action_fcurve_count(action)}"
    )


def hide_gargoyle(src: bpy.types.Object) -> None:
    src.hide_render = True
    src.hide_viewport = True
    for child in list(src.children_recursive):
        if child.type == "MESH":
            bpy.data.objects.remove(child, do_unlink=True)
        else:
            child.hide_render = True
            child.hide_viewport = True


def main() -> None:
    if not MONKEY_GLB.exists():
        raise SystemExit(f"Missing rigged monkey (run setup_winged_monkey_wings.py first): {MONKEY_GLB}")
    if not GARGOYLE_FBX.exists():
        raise SystemExit(f"Missing Gargoyle FBX: {GARGOYLE_FBX}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MONKEY_GLB))
    tgt = find_monkey_armature()
    tgt.name = "WingedMonkeyArmature"
    print(f"target bones={len(tgt.data.bones)} has_wings={('L_Wing1' in tgt.data.bones)}")

    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(GARGOYLE_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
        use_anim=True,
    )
    added = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in added if o.type == "ARMATURE")
    src.name = "GargoyleSource"
    print(f"source bones={len(src.data.bones)}")

    action = src.animation_data.action if src.animation_data else None
    if action is None:
        candidates = [a for a in bpy.data.actions if "Take" in a.name or "Garg" in a.name]
        if not candidates:
            candidates = list(bpy.data.actions)
        if not candidates:
            raise SystemExit("No Gargoyle action found")
        action = candidates[0]
        if not src.animation_data:
            src.animation_data_create()
        src.animation_data.action = action
    print(f"source action={action.name} range={tuple(action.frame_range)}")

    scene = bpy.context.scene
    scene.render.fps = 30

    align_source_to_target(src, tgt)
    add_constraints(src, tgt)
    hide_gargoyle(src)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, start, end in CLIPS:
        print(f"baking {name} {start}..{end} …")
        clip_action = bake_clip(tgt, name, start, end)
        export_clip_glb(tgt, clip_action, OUT_DIR / f"{name}.glb", start, end)

    clear_constraints(tgt)
    if src.name in bpy.data.objects:
        bpy.data.objects.remove(src, do_unlink=True)

    manifest = OUT_DIR / "_bake_summary.json"
    manifest.write_text(
        json.dumps(
            {
                "source": str(GARGOYLE_FBX.relative_to(ROOT)),
                "target": str(MONKEY_GLB.relative_to(ROOT)),
                "clips": [{"name": n, "start": s, "end": e} for n, s, e in CLIPS],
                "boneMap": BONE_MAP,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {manifest}")
    print("DONE gargoyle → winged monkey bake")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("BAKE FAILED:", e, file=sys.stderr)
        raise
