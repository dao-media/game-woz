#!/usr/bin/env python3
"""
Bake Character Creator (CC_Base_*) clips onto Dorothy MASTER Mixamo armature.

Rest-offset world rotations onto mapped Mixamo bones, then visual-bake via
anim_utils.bake_action. Hips stay in place on XZ; vertical hop is relative to
the lowest source frame so Skip plants instead of floating. Only mapped body
bones are selected — hands/feet/toes stay on Dorothy rest and follow parents.
Visual-keying every bone world-locks those tips (hooked heels, stretched arms).

Reads masters (never modified). Writes derived GLB under models/.

Usage (Blender 5+):
  # Powerful Spell (default)
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/bake_cc_ultimate_to_dorothy.py

  # Traversal Skip
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/bake_cc_ultimate_to_dorothy.py -- \\
    --src masters/dorothy/Animations/Traversal_Skip/skip-walk-c2.fbx \\
    --out-stem Traversal_skip \\
    --action-name Skip \\
    --no-arms
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from bpy_extras import anim_utils
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MASTER_FBX = ROOT / "masters/dorothy/Animations/Magic/Ultimate_Dorothy.fbx"
DOROTHY_GLB = ROOT / "models/dorothy/MASTER/Dorothy_rigged.glb"
DEFAULT_OUT_STEM = "Attack_powerful_spell"
DEFAULT_ACTION_NAME = "Powerful Spell"

# Source CC bone → Dorothy Mixamo-char bone
# Tip bones (hands/feet/fingers) stay on Dorothy rest — CC tip axes flip palms/fold shoes.
BONE_MAP: dict[str, str] = {
    "CC_Base_Hip": "Hips",
    "CC_Base_Waist": "Spine02",
    "CC_Base_Spine01": "Spine01",
    "CC_Base_Spine02": "Spine",
    "CC_Base_NeckTwist01": "neck",
    "CC_Base_Head": "Head",
    "CC_Base_L_Clavicle": "LeftShoulder",
    "CC_Base_L_Upperarm": "LeftArm",
    "CC_Base_L_Forearm": "LeftForeArm",
    "CC_Base_R_Clavicle": "RightShoulder",
    "CC_Base_R_Upperarm": "RightArm",
    "CC_Base_R_Forearm": "RightForeArm",
    "CC_Base_L_Thigh": "LeftUpLeg",
    "CC_Base_L_Calf": "LeftLeg",
    "CC_Base_R_Thigh": "RightUpLeg",
    "CC_Base_R_Calf": "RightLeg",
}


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_armature(prefix: str | None = None) -> bpy.types.Object:
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if prefix:
        for a in arms:
            if any(b.name.startswith(prefix) for b in a.data.bones):
                return a
    if not arms:
        raise RuntimeError("No armature found")
    return arms[0]


def bone_world_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    pb = arm.pose.bones[bone_name]
    return arm.matrix_world @ pb.matrix


def flat_forward_from_shoulders(arm: bpy.types.Object, left: str, right: str) -> Vector:
    ls = bone_world_matrix(arm, left).translation
    rs = bone_world_matrix(arm, right).translation
    shoulder = Vector((rs.x - ls.x, 0.0, rs.z - ls.z))
    if shoulder.length < 1e-8:
        return Vector((0.0, 0.0, 1.0))
    shoulder.normalize()
    # character-right × up? facing = up × right
    fwd = Vector((0.0, 1.0, 0.0)).cross(shoulder)
    if fwd.length < 1e-8:
        return Vector((0.0, 0.0, 1.0))
    fwd.normalize()
    return fwd


def _up_height(v: Vector) -> float:
    """Blender glTF/FBX imports here are Z-up for these assets — prefer |Z|, fallback |Y|."""
    if abs(v.z) >= abs(v.y):
        return abs(v.z)
    return abs(v.y)


def align_source_to_target(src: bpy.types.Object, tgt: bpy.types.Object) -> None:
    """Match height + yaw so CC Hip lines up with Dorothy Hips facing."""
    bpy.context.view_layer.update()
    src_hip = src.pose.bones.get("CC_Base_Hip") or src.pose.bones.get("CC_Base_Pelvis")
    tgt_hip = tgt.pose.bones["Hips"]
    if not src_hip:
        raise RuntimeError("CC hip bone missing")

    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    tgt_hip_w = (tgt.matrix_world @ tgt_hip.matrix).translation

    # Scale by hip height (these imports are Z-up; Y≈0 so never use Y alone)
    src_h = max(_up_height(src_hip_w), 1e-4)
    tgt_h = max(_up_height(tgt_hip_w), 1e-4)
    scale = tgt_h / src_h
    src.scale *= scale
    bpy.context.view_layer.update()

    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    src.location += tgt_hip_w - src_hip_w
    bpy.context.view_layer.update()

    # Yaw about world +Z (up) using shoulder line
    try:
        # Rebuild shoulder forward in XY (Z-up)
        def shoulder_fwd(arm: bpy.types.Object, left: str, right: str) -> Vector:
            ls = bone_world_matrix(arm, left).translation
            rs = bone_world_matrix(arm, right).translation
            right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
            if right_v.length < 1e-8:
                return Vector((0.0, 1.0, 0.0))
            right_v.normalize()
            # up(Z) × right → forward
            fwd = Vector((0.0, 0.0, 1.0)).cross(right_v)
            return fwd.normalized() if fwd.length > 1e-8 else Vector((0.0, 1.0, 0.0))

        src_fwd = shoulder_fwd(src, "CC_Base_L_Clavicle", "CC_Base_R_Clavicle")
        tgt_fwd = shoulder_fwd(tgt, "LeftShoulder", "RightShoulder")
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

    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    print(
        f"align scale={scale:.4f} src_hip={tuple(round(c, 3) for c in src_hip_w)} "
        f"tgt_hip={tuple(round(c, 3) for c in tgt_hip_w)}"
    )


def bone_rest_world(arm: bpy.types.Object, bone_name: str) -> Matrix:
    """Bind-pose world matrix (edit/rest), not the current posed matrix."""
    return arm.matrix_world @ arm.data.bones[bone_name].matrix_local


def mapped_pairs(src: bpy.types.Object, tgt: bpy.types.Object) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for src_name, tgt_name in BONE_MAP.items():
        if src_name not in src.pose.bones or tgt_name not in tgt.pose.bones:
            print(f"skip missing {src_name} → {tgt_name}")
            continue
        pairs.append((src_name, tgt_name))
    return pairs


def hierarchy_sorted_pairs(
    tgt: bpy.types.Object, pairs: list[tuple[str, str]]
) -> list[tuple[str, str]]:
    """Parents before children so pb.matrix assignments stick."""

    def depth(name: str) -> int:
        b = tgt.data.bones.get(name)
        d = 0
        while b and b.parent:
            d += 1
            b = b.parent
        return d

    return sorted(pairs, key=lambda p: depth(p[1]))


def clear_pose_constraints(tgt: bpy.types.Object, bone_names: list[str]) -> None:
    for name in bone_names:
        pb = tgt.pose.bones[name]
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])


def bone_matrix_parent_space(arm: bpy.types.Object, bone_name: str, *, rest: bool) -> Matrix:
    """Bone matrix in parent (or armature) space — rest bind or current pose."""
    if rest:
        b = arm.data.bones[bone_name]
        mat = b.matrix_local.copy()
        if b.parent:
            return b.parent.matrix_local.inverted() @ mat
        return mat
    pb = arm.pose.bones[bone_name]
    mat = pb.matrix.copy()
    if pb.parent:
        return pb.parent.matrix.inverted() @ mat
    return mat


def bake_rest_relative(
    src: bpy.types.Object,
    tgt: bpy.types.Object,
    frame_start: int,
    frame_end: int,
    *,
    no_arms: bool = False,
) -> list[str]:
    """
    Locomotion: pass --no-arms so Dorothy's A-pose arms stay at rest (CC T-pose
    arm axes become wings). Spell/attack clips keep the arm chain.
    Hips stay in-place on XZ with source hop, then a foot-plant shift so the
    lowest frame matches Dorothy rest feet. Hands/feet stay on Dorothy rest.
    """
    pairs = hierarchy_sorted_pairs(tgt, mapped_pairs(src, tgt))
    if no_arms:
        skip_tgts = {
            "LeftShoulder",
            "RightShoulder",
            "LeftArm",
            "RightArm",
            "LeftForeArm",
            "RightForeArm",
        }
        pairs = [(s, t) for s, t in pairs if t not in skip_tgts]
        print(f"no-arms: baking {len(pairs)} body/leg bones (A-pose arms stay at rest)")
    if not pairs:
        raise RuntimeError("No overlapping bones to bake")

    clear_pose_constraints(tgt, [t for _, t in pairs])

    src_rest_q: dict[str, object] = {}
    tgt_rest_q: dict[str, object] = {}
    for src_name, tgt_name in pairs:
        src_rest_q[src_name] = bone_rest_world(src, src_name).to_quaternion()
        tgt_rest_q[tgt_name] = bone_rest_world(tgt, tgt_name).to_quaternion()
        ang = math.degrees(
            (
                bone_rest_world(src, src_name).to_3x3().inverted()
                @ bone_rest_world(tgt, tgt_name).to_3x3()
            )
            .to_quaternion()
            .angle
        )
        if ang > 15.0:
            print(f"restΔ {src_name}→{tgt_name}: {ang:.1f}°")

    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"

    hip_src = next((s for s, t in pairs if t == "Hips"), None)
    tgt_hip_rest_w = bone_rest_world(tgt, "Hips").translation.copy()
    up_i = 2 if abs(tgt_hip_rest_w.z) >= abs(tgt_hip_rest_w.y) else 1
    tgt_up = tgt_hip_rest_w[up_i]
    tgt_rest_foot = min(
        bone_rest_world(tgt, n).translation[up_i]
        for n in ("LeftFoot", "RightFoot")
        if n in tgt.pose.bones
    )
    min_src_up = tgt_up
    if hip_src:
        src_ups: list[float] = []
        for frame in range(frame_start, frame_end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            src_ups.append(bone_world_matrix(src, hip_src).translation[up_i])
        min_src_up = min(src_ups)
        print(
            f"hip plant axis={up_i} src_up=[{min(src_ups):.4f}..{max(src_ups):.4f}] "
            f"tgt_rest_up={tgt_up:.4f} hop={max(src_ups) - min_src_up:.4f} "
            f"tgt_rest_foot={tgt_rest_foot:.4f}"
        )

    def _unit_q(q):
        if q.magnitude < 0.25:
            return None
        q = q.copy()
        q.normalize()
        return q

    def apply_retarget(_scene: bpy.types.Scene) -> None:
        bpy.context.view_layer.update()
        # Dorothy MASTER is A-pose; CC Skip is T-pose. World-aim copy swung
        # A-pose arms out to T-pose/+Y (wings). Conjugate local FK instead.
        for src_name, tgt_name in pairs:
            src_delta = _unit_q(src.pose.bones[src_name].matrix_basis.to_quaternion())
            if src_delta is None:
                continue
            align = _unit_q(src_rest_q[src_name].inverted() @ tgt_rest_q[tgt_name])
            if align is None:
                continue
            tgt_delta = _unit_q(align.inverted() @ src_delta @ align)
            if tgt_delta is None:
                continue
            pb = tgt.pose.bones[tgt_name]
            pb.rotation_quaternion = tgt_delta
            pb.scale = Vector((1.0, 1.0, 1.0))
            if tgt_name != "Hips":
                pb.location = (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        if hip_src:
            hips = tgt.pose.bones["Hips"]
            src_w = bone_world_matrix(src, hip_src).translation
            desired_w = tgt_hip_rest_w.copy()
            desired_w[up_i] = tgt_up + (src_w[up_i] - min_src_up)
            desired_arm = tgt.matrix_world.inverted() @ desired_w
            mat = hips.matrix.copy()
            mat.translation = desired_arm
            hips.matrix = mat
            hips.scale = Vector((1.0, 1.0, 1.0))
            bpy.context.view_layer.update()

    bpy.app.handlers.frame_change_pre.append(apply_retarget)
    try:
        bpy.context.scene.frame_set(frame_start)
        apply_retarget(bpy.context.scene)
        hips_pb = tgt.pose.bones.get("Hips")
        arm_pb = tgt.pose.bones.get("LeftArm")
        if hips_pb is not None:
            hw = bone_world_matrix(tgt, "Hips").translation
            print(
                f"frame {frame_start} hips.location={tuple(round(c, 4) for c in hips_pb.location)} "
                f"world={tuple(round(c, 4) for c in hw)}"
            )
        if arm_pb is not None:
            print(
                f"frame {frame_start} LeftArm quat={tuple(round(c, 3) for c in arm_pb.rotation_quaternion)}"
            )

        frames = list(range(frame_start, frame_end + 1))
        mapped_names = [t for _, t in pairs]
        opts = anim_utils.BakeOptions(
            only_selected=True,
            do_pose=True,
            do_object=False,
            do_visual_keying=True,
            do_constraint_clear=False,
            do_parents_clear=False,
            do_clean=False,
            do_location=False,
            do_rotation=True,
            do_scale=False,
            do_bbone=False,
            do_custom_props=False,
        )
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        tgt.select_set(True)
        bpy.context.view_layer.objects.active = tgt
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="DESELECT")
        for name in mapped_names:
            pb = tgt.pose.bones.get(name)
            if pb is not None:
                pb.select = True

        action = anim_utils.bake_action(tgt, action=None, frames=frames, bake_options=opts)
        bpy.ops.object.mode_set(mode="OBJECT")
        if action is None:
            raise RuntimeError("bake_action returned None")
        if not tgt.animation_data:
            tgt.animation_data_create()
        tgt.animation_data.action = action

        if hip_src:
            hips = tgt.pose.bones["Hips"]
            for frame in frames:
                bpy.context.scene.frame_set(frame)
                apply_retarget(bpy.context.scene)
                hips.keyframe_insert(data_path="location", frame=frame)
    finally:
        if apply_retarget in bpy.app.handlers.frame_change_pre:
            bpy.app.handlers.frame_change_pre.remove(apply_retarget)

    if hip_src and tgt.animation_data and tgt.animation_data.action:
        min_foot = 1e9
        for frame in range(frame_start, frame_end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            for n in ("LeftFoot", "RightFoot"):
                if n in tgt.pose.bones:
                    min_foot = min(min_foot, bone_world_matrix(tgt, n).translation[up_i])
        plant = tgt_rest_foot - min_foot
        print(f"foot plant rest={tgt_rest_foot:.4f} baked_min={min_foot:.4f} delta={plant:.4f}")
        if abs(plant) > 1e-4:
            hips = tgt.pose.bones["Hips"]
            for frame in range(frame_start, frame_end + 1):
                bpy.context.scene.frame_set(frame)
                bpy.context.view_layer.update()
                cur = bone_world_matrix(tgt, "Hips").translation.copy()
                cur[up_i] += plant
                desired_arm = tgt.matrix_world.inverted() @ cur
                mat = hips.matrix.copy()
                mat.translation = desired_arm
                hips.matrix = mat
                hips.scale = Vector((1.0, 1.0, 1.0))
                hips.keyframe_insert(data_path="location", frame=frame)

    if tgt.animation_data and tgt.animation_data.action:
        clear_tip_channels(tgt, tgt.animation_data.action)
        align_baked_locomotion_facing(tgt, frame_start, frame_end)
        smooth_action_curves(tgt.animation_data.action, passes=4)

    mid = (frame_start + frame_end) // 2
    bpy.context.scene.frame_set(mid)
    bpy.context.view_layer.update()
    if all(n in tgt.pose.bones for n in ("LeftLeg", "LeftFoot", "LeftToeBase")):
        k = bone_world_matrix(tgt, "LeftLeg").translation
        a = bone_world_matrix(tgt, "LeftFoot").translation
        t = bone_world_matrix(tgt, "LeftToeBase").translation
        shin = (a - k).normalized()
        foot = (t - a).normalized()
        ang = math.degrees(math.acos(max(-1.0, min(1.0, shin.dot(foot)))))
        print(f"mid-frame {mid} L ankle angle: {ang:.1f}°")

    # Verify facing after cleanup
    left, right = _probe_arms(tgt)
    rest_fwd = _flat_fwd_zup(tgt, left, right, rest=True)
    acc = Vector((0.0, 0.0, 0.0))
    step = max(1, (frame_end - frame_start) // 16)
    for fr in range(frame_start, frame_end + 1, step):
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        acc += _flat_fwd_zup(tgt, left, right, rest=False)
    if acc.length > 1e-8:
        mean_fwd = acc.normalized()
        bias = math.degrees(_signed_yaw_zup(mean_fwd, rest_fwd))
        print(f"post-align facing bias={bias:.1f}°")

    print(f"retarget bake on {len(pairs)} bones frames {frame_start}..{frame_end}")
    return [t for _, t in pairs]


def action_fcurves(action: bpy.types.Action):
    layered = False
    for layer in getattr(action, "layers", []) or []:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                layered = True
                yield cb.fcurves, list(cb.fcurves)
    if not layered and hasattr(action, "fcurves"):
        yield action.fcurves, list(action.fcurves)


def is_tip_bone(name: str) -> bool:
    if name in ("head_end", "head_tip"):
        return True
    return any(m in name for m in ("Hand", "Foot", "Toe"))


def clear_tip_channels(tgt: bpy.types.Object, action: bpy.types.Action) -> int:
    """Drop hand/foot/toe keys so tips follow their parents at rest (no world-lock)."""
    removed = 0
    for coll, fcs in action_fcurves(action):
        for fc in fcs:
            dp = fc.data_path
            if 'pose.bones["' not in dp:
                continue
            bone = dp.split('pose.bones["', 1)[1].split('"]', 1)[0]
            if is_tip_bone(bone):
                coll.remove(fc)
                removed += 1
    for pb in tgt.pose.bones:
        if not is_tip_bone(pb.name):
            continue
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pb.location = (0.0, 0.0, 0.0)
        pb.scale = (1.0, 1.0, 1.0)
    print(f"cleared tip channels={removed}")
    return removed


def _flat_fwd_zup(arm: bpy.types.Object, left: str, right: str, *, rest: bool) -> Vector:
    if rest:
        ls = arm.matrix_world @ arm.data.bones[left].head_local
        rs = arm.matrix_world @ arm.data.bones[right].head_local
    else:
        ls = arm.matrix_world @ arm.pose.bones[left].head
        rs = arm.matrix_world @ arm.pose.bones[right].head
    right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right_v.length < 1e-8:
        return Vector((0.0, 1.0, 0.0))
    right_v.normalize()
    fwd = Vector((0.0, 0.0, 1.0)).cross(right_v)
    return fwd.normalized() if fwd.length > 1e-8 else Vector((0.0, 1.0, 0.0))


def _signed_yaw_zup(from_v: Vector, to_v: Vector) -> float:
    return math.atan2(
        from_v.x * to_v.y - from_v.y * to_v.x,
        from_v.x * to_v.x + from_v.y * to_v.y,
    )


def _probe_arms(arm: bpy.types.Object) -> tuple[str, str]:
    """Prefer upper-arm heads (stable); fall back to shoulders."""
    if "LeftArm" in arm.pose.bones and "RightArm" in arm.pose.bones:
        return "LeftArm", "RightArm"
    return "LeftShoulder", "RightShoulder"


def align_baked_locomotion_facing(
    tgt: bpy.types.Object,
    frame_start: int,
    frame_end: int,
) -> None:
    """Zero mean chest crook + thigh swing skew (Skip looked SSW on South)."""
    if not tgt.animation_data or not tgt.animation_data.action:
        return
    left, right = _probe_arms(tgt)
    rest_fwd = _flat_fwd_zup(tgt, left, right, rest=True)

    samples = list(range(frame_start, frame_end + 1, max(1, (frame_end - frame_start) // 24)))
    acc = Vector((0.0, 0.0, 0.0))
    for fr in samples:
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        acc += _flat_fwd_zup(tgt, left, right, rest=False)
    if acc.length < 1e-8:
        return
    mean_fwd = acc.normalized()
    bias = _signed_yaw_zup(mean_fwd, rest_fwd)
    print(
        f"facing mean_yaw={math.degrees(_signed_yaw_zup(Vector((0, 1, 0)), mean_fwd)):.1f}° "
        f"rest={math.degrees(_signed_yaw_zup(Vector((0, 1, 0)), rest_fwd)):.1f}° "
        f"bias={math.degrees(bias):.1f}°"
    )

    def yaw_bone_world(pb: bpy.types.PoseBone, yaw: float) -> None:
        mw = tgt.matrix_world @ pb.matrix
        R = Matrix.Rotation(yaw, 3, "Z") @ mw.to_3x3()
        new = R.to_4x4()
        new.translation = mw.translation
        pb.matrix = tgt.matrix_world.inverted() @ new
        bpy.context.view_layer.update()
        _loc, rot, _sca = pb.matrix_basis.decompose()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = rot
        if pb.name != "Hips":
            pb.location = (0.0, 0.0, 0.0)
        pb.scale = Vector((1.0, 1.0, 1.0))

    if abs(bias) >= math.radians(1.0) and abs(bias) <= math.radians(40.0):
        # Prefer Spine02 over Hips: Blender glTF often writes the armature *root*
        # bone near rest (same bug as GargPelvis), so hip yaw vanishes on export.
        yaw_target = "Spine02" if "Spine02" in tgt.pose.bones else "Hips"
        pb_yaw = tgt.pose.bones[yaw_target]
        for fr in range(frame_start, frame_end + 1):
            bpy.context.scene.frame_set(fr)
            bpy.context.view_layer.update()
            yaw_bone_world(pb_yaw, bias)
            pb_yaw.keyframe_insert(data_path="rotation_quaternion", frame=fr)
        print(f"applied {yaw_target} facing yaw {math.degrees(bias):.1f}°")

    # Foot swing skew vs chest (same idea as studio alignClipFacingToRest pass 3).
    bpy.context.view_layer.update()
    acc = Vector((0.0, 0.0, 0.0))
    for fr in samples:
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        acc += _flat_fwd_zup(tgt, left, right, rest=False)
    mean_chest = acc.normalized() if acc.length > 1e-8 else rest_fwd
    right_axis = mean_chest.cross(Vector((0.0, 0.0, 1.0)))
    if right_axis.length < 1e-8:
        return
    right_axis.normalize()
    # In Z-up, "forward" is mean_chest in XY; right is perpendicular in XY.
    right_axis = Vector((-mean_chest.y, mean_chest.x, 0.0)).normalized()

    skews: list[float] = []
    for foot_name in ("LeftFoot", "RightFoot"):
        if foot_name not in tgt.pose.bones:
            continue
        fs: list[float] = []
        rs: list[float] = []
        for fr in samples:
            bpy.context.scene.frame_set(fr)
            bpy.context.view_layer.update()
            hips_w = bone_world_matrix(tgt, "Hips").translation
            foot_w = bone_world_matrix(tgt, foot_name).translation
            rel = foot_w - hips_w
            fs.append(rel.x * mean_chest.x + rel.y * mean_chest.y)
            rs.append(rel.x * right_axis.x + rel.y * right_axis.y)
        mf = sum(fs) / len(fs)
        mr = sum(rs) / len(rs)
        cff = crr = cfr = 0.0
        for f, r in zip(fs, rs):
            f -= mf
            r -= mr
            cff += f * f
            crr += r * r
            cfr += f * r
        skews.append(0.5 * math.atan2(2.0 * cfr, cff - crr))
    if not skews:
        return
    skew = sum(skews) / len(skews)
    print(f"foot swing skew={math.degrees(skew):.1f}°")
    if abs(skew) < math.radians(1.5) or abs(skew) > math.radians(45.0):
        return

    # Yaw thighs opposite the skew so swing plane matches chest.
    fix = -skew
    for fr in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        for name in ("LeftUpLeg", "RightUpLeg"):
            if name not in tgt.pose.bones:
                continue
            pb = tgt.pose.bones[name]
            yaw_bone_world(pb, fix)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=fr)
    print(f"applied thigh yaw {-math.degrees(skew):.1f}°")


def smooth_action_curves(action: bpy.types.Action, passes: int = 4) -> None:
    """Light gaussian-ish smooth on keyed channels; re-normalize quaternions."""
    # Group quat channels by bone so we can renormalize.
    quat_groups: dict[str, dict[int, object]] = {}
    for _coll, fcs in action_fcurves(action):
        for fc in fcs:
            dp = fc.data_path
            if "rotation_quaternion" in dp and 'pose.bones["' in dp:
                bone = dp.split('pose.bones["', 1)[1].split('"]', 1)[0]
                quat_groups.setdefault(bone, {})[fc.array_index] = fc
            pts = list(fc.keyframe_points)
            if len(pts) < 5:
                continue
            for _ in range(passes):
                vals = [kp.co[1] for kp in pts]
                new = vals[:]
                for i in range(1, len(vals) - 1):
                    new[i] = 0.2 * vals[i - 1] + 0.6 * vals[i] + 0.2 * vals[i + 1]
                # Keep endpoints fixed (loop seams).
                new[0] = vals[0]
                new[-1] = vals[-1]
                for i, kp in enumerate(pts):
                    kp.co[1] = new[i]
                fc.update()
            for kp in pts:
                kp.interpolation = "BEZIER"
                kp.handle_left_type = "AUTO_CLAMPED"
                kp.handle_right_type = "AUTO_CLAMPED"
            fc.update()

    # Renormalize quaternion keys per frame index.
    for bone, chans in quat_groups.items():
        if set(chans.keys()) != {0, 1, 2, 3}:
            continue
        fcs = [chans[i] for i in range(4)]
        n = min(len(fc.keyframe_points) for fc in fcs)
        for i in range(n):
            q = Vector((fcs[0].keyframe_points[i].co[1],
                        fcs[1].keyframe_points[i].co[1],
                        fcs[2].keyframe_points[i].co[1],
                        fcs[3].keyframe_points[i].co[1]))
            if q.length < 1e-8:
                continue
            q.normalize()
            for c in range(4):
                fcs[c].keyframe_points[i].co[1] = q[c]
        for fc in fcs:
            fc.update()
    print(f"smoothed action curves passes={passes}")


def hide_source(src: bpy.types.Object) -> None:
    src.hide_render = True
    src.hide_viewport = True
    for child in src.children_recursive:
        child.hide_render = True
        child.hide_viewport = True
        if child.type == "MESH":
            bpy.data.objects.remove(child, do_unlink=True)


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    # Export Dorothy armature + mesh only
    for o in bpy.data.objects:
        if o.type in {"ARMATURE", "MESH"} and not o.name.startswith("CC") and "CC_Base" not in (
            o.data.bones[0].name if o.type == "ARMATURE" and o.data.bones else ""
        ):
            # Keep Dorothy Armature / Dorothy mesh; skip source if still present
            if o.type == "ARMATURE" and any(b.name.startswith("CC_Base_") for b in o.data.bones):
                continue
            o.hide_set(False)
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="ACTIVE_ACTIONS",
        export_nla_strips=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def parse_args(argv: list[str]) -> argparse.Namespace:
    # Blender passes its own flags; args after "--" are ours.
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Bake CC_Base clip onto Dorothy MASTER")
    p.add_argument(
        "--src",
        type=Path,
        default=DEFAULT_MASTER_FBX,
        help="Master CC FBX (under masters/)",
    )
    p.add_argument(
        "--out-stem",
        default=DEFAULT_OUT_STEM,
        help="Output filename stem under mixamo_character/ and studio/",
    )
    p.add_argument("--action-name", default=DEFAULT_ACTION_NAME, help="Baked action display name")
    p.add_argument(
        "--no-arms",
        action="store_true",
        help="Leave Dorothy A-pose arms at rest (skip/locomotion — CC T-pose arms become wings)",
    )
    return p.parse_args(argv)


def main() -> None:
    args = parse_args(sys.argv)
    master_fbx = args.src if args.src.is_absolute() else ROOT / args.src
    out_glb = ROOT / "models/dorothy/Animations/mixamo_character" / f"{args.out_stem}.glb"
    out_studio = ROOT / "models/dorothy/Animations/studio" / f"{args.out_stem}.glb"

    if not master_fbx.exists():
        raise SystemExit(f"Missing master FBX: {master_fbx}")
    if not DOROTHY_GLB.exists():
        raise SystemExit(f"Missing Dorothy: {DOROTHY_GLB}")

    clear_scene()

    # 1) Dorothy target
    bpy.ops.import_scene.gltf(filepath=str(DOROTHY_GLB))
    tgt = find_armature()
    tgt.name = "DorothyArmature"
    if tgt.animation_data:
        tgt.animation_data_clear()
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"target armature: {tgt.name} bones={len(tgt.data.bones)}")

    # 2) CC source motion
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(master_fbx),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in added if o.type == "ARMATURE")
    src.name = "CCSource"
    print(f"source armature: {src.name} bones={len(src.data.bones)}")

    # Animation range from source action
    action = src.animation_data.action if src.animation_data else None
    if action is None:
        # Try any action
        if not bpy.data.actions:
            raise SystemExit("No actions on CC FBX")
        action = bpy.data.actions[0]
        if not src.animation_data:
            src.animation_data_create()
        src.animation_data.action = action

    frame_start = int(round(action.frame_range[0]))
    frame_end = int(round(action.frame_range[1]))
    scene = bpy.context.scene
    scene.frame_start = frame_start
    scene.frame_end = frame_end
    scene.frame_set(frame_start)
    print(f"frames {frame_start}..{frame_end} action={action.name}")

    align_source_to_target(src, tgt)
    bake_rest_relative(src, tgt, frame_start, frame_end, no_arms=args.no_arms)

    # Name the baked action
    if tgt.animation_data and tgt.animation_data.action:
        tgt.animation_data.action.name = args.action_name

    hide_source(src)
    # Remove leftover CC meshes
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE" and any(b.name.startswith("CC_Base_") for b in o.data.bones):
            bpy.data.objects.remove(o, do_unlink=True)

    export_glb(out_glb)
    export_glb(out_studio)
    print(f"DONE {args.action_name} bake → {out_glb.name}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("BAKE FAILED:", e, file=sys.stderr)
        raise
