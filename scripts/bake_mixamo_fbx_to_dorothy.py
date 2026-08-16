#!/usr/bin/env python3
"""
Dorothy MASTER is A-pose; Mixamo FBX is T-pose. Conjugates local FK deltas
through rest-world alignment, then visual-bakes onto mapped bones.
Hip location is bind-relative (in-place).

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/bake_mixamo_fbx_to_dorothy.py -- \\
    --src masters/dorothy/Animations/Wave.fbx --out-stem Wave --action-name Wave
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from bpy_extras import anim_utils
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
DOROTHY_GLB = ROOT / "models/dorothy/MASTER/Dorothy_rigged.glb"
DEFAULT_SRC = ROOT / "masters/dorothy/Animations/Wave.fbx"

# Mixamo leaf (prefix stripped) → Dorothy MASTER bone.
# Same-named bones pass through; spine chain + neck are the exceptions.
MIXAMO_TO_DOROTHY: dict[str, str] = {
    "Hips": "Hips",
    "Spine": "Spine02",
    "Spine1": "Spine01",
    "Spine2": "Spine",
    "Neck": "neck",
    "Head": "Head",
    "HeadTop_End": "head_end",
    "LeftShoulder": "LeftShoulder",
    "LeftArm": "LeftArm",
    "LeftForeArm": "LeftForeArm",
    "LeftHand": "LeftHand",
    "RightShoulder": "RightShoulder",
    "RightArm": "RightArm",
    "RightForeArm": "RightForeArm",
    "RightHand": "RightHand",
    "LeftUpLeg": "LeftUpLeg",
    "LeftLeg": "LeftLeg",
    "LeftFoot": "LeftFoot",
    "LeftToeBase": "LeftToeBase",
    "LeftToe_End": "LeftToe_End",
    "RightUpLeg": "RightUpLeg",
    "RightLeg": "RightLeg",
    "RightFoot": "RightFoot",
    "RightToeBase": "RightToeBase",
    "RightToe_End": "RightToe_End",
}

FINGER_LEAVES = [
    "LeftHandThumb1",
    "LeftHandThumb2",
    "LeftHandThumb3",
    "LeftHandThumb4",
    "LeftHandIndex1",
    "LeftHandIndex2",
    "LeftHandIndex3",
    "LeftHandIndex4",
    "RightHandThumb1",
    "RightHandThumb2",
    "RightHandThumb3",
    "RightHandThumb4",
    "RightHandIndex1",
    "RightHandIndex2",
    "RightHandIndex3",
    "RightHandIndex4",
]
for _leaf in FINGER_LEAVES:
    MIXAMO_TO_DOROTHY[_leaf] = _leaf


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def strip_mixamo(name: str) -> str:
    for prefix in ("mixamorig:", "mixamorig"):
        if name.startswith(prefix):
            return name[len(prefix) :]
    return name


def find_armature(*, mixamo: bool | None = None) -> bpy.types.Object:
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No armature found")
    if mixamo is True:
        for a in arms:
            if any(b.name.startswith("mixamorig") for b in a.data.bones):
                return a
    if mixamo is False:
        for a in arms:
            if not any(b.name.startswith("mixamorig") for b in a.data.bones):
                return a
    return arms[0]


def bone_world_matrix(arm: bpy.types.Object, bone_name: str) -> Matrix:
    pb = arm.pose.bones[bone_name]
    return arm.matrix_world @ pb.matrix


def _up_height(v: Vector) -> float:
    if abs(v.z) >= abs(v.y):
        return abs(v.z)
    return abs(v.y)


def src_bone_name(src: bpy.types.Object, leaf: str) -> str | None:
    for candidate in (f"mixamorig:{leaf}", f"mixamorig{leaf}", leaf):
        if candidate in src.pose.bones:
            return candidate
    return None


def mapped_pairs(src: bpy.types.Object, tgt: bpy.types.Object) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for leaf, tgt_name in MIXAMO_TO_DOROTHY.items():
        src_name = src_bone_name(src, leaf)
        if not src_name or tgt_name not in tgt.pose.bones:
            print(f"skip missing {leaf} → {tgt_name}")
            continue
        pairs.append((src_name, tgt_name))
    return pairs


def hierarchy_sorted_pairs(
    tgt: bpy.types.Object, pairs: list[tuple[str, str]]
) -> list[tuple[str, str]]:
    def depth(name: str) -> int:
        b = tgt.data.bones.get(name)
        d = 0
        while b and b.parent:
            d += 1
            b = b.parent
        return d

    return sorted(pairs, key=lambda p: depth(p[1]))


def align_source_to_target(src: bpy.types.Object, tgt: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    src_hip_n = src_bone_name(src, "Hips")
    if not src_hip_n:
        raise RuntimeError("Mixamo Hips missing")
    src_hip = src.pose.bones[src_hip_n]
    tgt_hip = tgt.pose.bones["Hips"]

    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    tgt_hip_w = (tgt.matrix_world @ tgt_hip.matrix).translation
    src_h = max(_up_height(src_hip_w), 1e-4)
    tgt_h = max(_up_height(tgt_hip_w), 1e-4)
    scale = tgt_h / src_h
    src.scale *= scale
    bpy.context.view_layer.update()

    src_hip_w = (src.matrix_world @ src_hip.matrix).translation
    src.location += tgt_hip_w - src_hip_w
    bpy.context.view_layer.update()

    def shoulder_fwd(arm: bpy.types.Object, left: str, right: str) -> Vector:
        ls = bone_world_matrix(arm, left).translation
        rs = bone_world_matrix(arm, right).translation
        right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
        if right_v.length < 1e-8:
            return Vector((0.0, 1.0, 0.0))
        right_v.normalize()
        fwd = Vector((0.0, 0.0, 1.0)).cross(right_v)
        return fwd.normalized() if fwd.length > 1e-8 else Vector((0.0, 1.0, 0.0))

    src_l = src_bone_name(src, "LeftShoulder")
    src_r = src_bone_name(src, "RightShoulder")
    if src_l and src_r:
        src_fwd = shoulder_fwd(src, src_l, src_r)
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

    print(
        f"align scale={scale:.4f} src_hip={tuple(round(c, 3) for c in src_hip_w)} "
        f"tgt_hip={tuple(round(c, 3) for c in tgt_hip_w)}"
    )


def bone_rest_world(arm: bpy.types.Object, bone_name: str) -> Matrix:
    return arm.matrix_world @ arm.data.bones[bone_name].matrix_local


def _unit_q(q):
    if q.magnitude < 0.25:
        return None
    q = q.copy()
    q.normalize()
    return q


def bone_aim_world(arm: bpy.types.Object, bone_name: str, *, rest: bool = False) -> Vector:
    if rest:
        b = arm.data.bones[bone_name]
        head = arm.matrix_world @ b.head_local
        tail = arm.matrix_world @ b.tail_local
    else:
        pb = arm.pose.bones[bone_name]
        head = arm.matrix_world @ pb.head
        tail = arm.matrix_world @ pb.tail
    d = tail - head
    return d.normalized() if d.length > 1e-8 else Vector((0.0, 0.0, -1.0))


def char_axes(arm: bpy.types.Object, left: str, right: str) -> tuple[Vector, Vector, Vector]:
    ls = bone_world_matrix(arm, left).translation
    rs = bone_world_matrix(arm, right).translation
    right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right_v.length < 1e-8:
        right_v = Vector((1.0, 0.0, 0.0))
    else:
        right_v.normalize()
    up = Vector((0.0, 0.0, 1.0))
    fwd = up.cross(right_v)
    if fwd.length < 1e-8:
        fwd = Vector((0.0, 1.0, 0.0))
    else:
        fwd.normalize()
    right_v = fwd.cross(up).normalized()
    return right_v, up, fwd


def to_char(v: Vector, right: Vector, up: Vector, fwd: Vector) -> Vector:
    return Vector((v.dot(right), v.dot(up), v.dot(fwd)))


def from_char(c: Vector, right: Vector, up: Vector, fwd: Vector) -> Vector:
    return (right * c.x + up * c.y + fwd * c.z).normalized()


def bake_local_rotations(
    src: bpy.types.Object,
    tgt: bpy.types.Object,
    frame_start: int,
    frame_end: int,
) -> None:
    """
    Mixamo FBX bind is T-pose, but Wave's *animation* already hangs arms down
    (A-pose). Dorothy MASTER bind is A-pose. Bind-relative basis copy / rest
    conjugation double-applies T→A and twists the arms 180°.

    Arm/forearm bones copy posed limb *aim* in character space (so frame 1
    stays down, the wave raises the right arm). Hands: aim swing + twist about
    aim so palm tracks Mixamo's facing axis (Dorothy ±X). Avoids FK palm-left
    and full-rebuild wrist folds. Other bones conjugate local FK. Hip location
    is bind-relative.
    """
    pairs = hierarchy_sorted_pairs(tgt, mapped_pairs(src, tgt))
    if not pairs:
        raise RuntimeError("No overlapping bones to bake")

    src_rest_q = {}
    tgt_rest_q = {}
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

    for name in [t for _, t in pairs]:
        pb = tgt.pose.bones[name]
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.rotation_mode = "QUATERNION"

    hip_src = next((s for s, t in pairs if t == "Hips"), None)
    tgt_hip_rest_w = bone_rest_world(tgt, "Hips").translation.copy()
    up_i = 2 if abs(tgt_hip_rest_w.z) >= abs(tgt_hip_rest_w.y) else 1
    tgt_up = tgt_hip_rest_w[up_i]
    min_src_up = tgt_up
    if hip_src:
        src_ups = []
        for frame in range(frame_start, frame_end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            src_ups.append(bone_world_matrix(src, hip_src).translation[up_i])
        min_src_up = min(src_ups)
        print(
            f"hip plant axis={up_i} src_up=[{min(src_ups):.4f}..{max(src_ups):.4f}] "
            f"tgt_rest_up={tgt_up:.4f} hop={max(src_ups) - min_src_up:.4f}"
        )
    print(f"bake pairs={len(pairs)} hip_src={hip_src}")

    src_l_sh = src_bone_name(src, "LeftShoulder")
    src_r_sh = src_bone_name(src, "RightShoulder")
    # Swing-only aim: arms hang correctly A↔T without 180° twist.
    CHAR_AIM = {
        "LeftArm",
        "RightArm",
        "LeftForeArm",
        "RightForeArm",
    }
    # Hands: aim swing (like arms) + twist around aim so palm faces character
    # forward. Full axis rebuild folded wrists ~165°; FK conjugate aimed palm left
    # (Mixamo Wave puts palm on +Z, Dorothy palm is ±X).
    CHAR_HAND = {
        "LeftHand",
        "RightHand",
    }
    tgt_rest_aim = {
        t: bone_aim_world(tgt, t, rest=True)
        for _, t in pairs
        if t in CHAR_AIM or t in CHAR_HAND
    }
    # Dorothy rest: RightHand +X toward facing, LeftHand −X toward facing.
    hand_palm_sign = {"LeftHand": -1.0, "RightHand": 1.0}

    def apply_world_rotation(pb: bpy.types.PoseBone, desired_q) -> None:
        arm_q = tgt.matrix_world.to_quaternion().inverted() @ desired_q
        mat = arm_q.to_matrix().to_4x4()
        mat.translation = pb.matrix.to_translation()
        pb.matrix = mat
        bpy.context.view_layer.update()
        _loc, rot, _scl = pb.matrix_basis.decompose()
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_quaternion = rot
        pb.scale = Vector((1.0, 1.0, 1.0))

    def hand_world_quat(src_name: str, tgt_name: str, src_axes, tgt_axes):
        """Swing aim like CHAR_AIM, then twist about aim so palm faces forward."""
        src_aim = bone_aim_world(src, src_name)
        aim_c = to_char(src_aim, *src_axes)
        if aim_c.length < 1e-6:
            return None
        desired_aim = from_char(aim_c.normalized(), *tgt_axes)
        rest_aim = tgt_rest_aim[tgt_name]
        swing = rest_aim.rotation_difference(desired_aim)
        base_q = swing @ tgt_rest_q[tgt_name]

        # Palm after swing-only (Dorothy ±X) → twist toward character facing.
        sign = hand_palm_sign.get(tgt_name, 1.0)
        base_m = base_q.to_matrix()
        cur_palm = (base_m @ Vector((sign, 0.0, 0.0))).normalized()
        desired_palm = tgt_axes[2].copy()  # character forward

        # Twist only around aim — project palms onto the aim-perpendicular plane.
        aim = desired_aim.normalized()
        a = cur_palm - aim * cur_palm.dot(aim)
        b = desired_palm - aim * desired_palm.dot(aim)
        if a.length < 1e-6 or b.length < 1e-6:
            return base_q
        a.normalize()
        b.normalize()
        # Signed angle about aim (short arc).
        ang = math.atan2(aim.dot(a.cross(b)), a.dot(b))
        if abs(ang) < math.radians(1.0):
            return base_q
        twist = Quaternion(aim, ang)
        return twist @ base_q

    def apply_retarget(_scene: bpy.types.Scene) -> None:
        bpy.context.view_layer.update()
        src_axes = char_axes(src, src_l_sh, src_r_sh) if src_l_sh and src_r_sh else None
        tgt_axes = char_axes(tgt, "LeftShoulder", "RightShoulder")
        for src_name, tgt_name in pairs:
            pb = tgt.pose.bones[tgt_name]
            if tgt_name in CHAR_HAND and src_axes is not None:
                desired_q = hand_world_quat(src_name, tgt_name, src_axes, tgt_axes)
                if desired_q is None:
                    continue
                apply_world_rotation(pb, desired_q)
                continue
            if tgt_name in CHAR_AIM and src_axes is not None:
                src_c = to_char(bone_aim_world(src, src_name), *src_axes)
                if src_c.length < 1e-6:
                    continue
                desired = from_char(src_c.normalized(), *tgt_axes)
                rest_aim = tgt_rest_aim[tgt_name]
                swing = rest_aim.rotation_difference(desired)
                desired_q = swing @ tgt_rest_q[tgt_name]
                apply_world_rotation(pb, desired_q)
                continue
            src_delta = _unit_q(src.pose.bones[src_name].matrix_basis.to_quaternion())
            if src_delta is None:
                continue
            align = _unit_q(src_rest_q[src_name].inverted() @ tgt_rest_q[tgt_name])
            if align is None:
                continue
            tgt_delta = _unit_q(align.inverted() @ src_delta @ align)
            if tgt_delta is None:
                continue
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
        arm_pb = tgt.pose.bones.get("LeftArm")
        hips_pb = tgt.pose.bones.get("Hips")
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

    print(f"baked frames {frame_start}..{frame_end}")


def hide_mixamo_source(src: bpy.types.Object) -> None:
    src.hide_render = True
    src.hide_viewport = True
    for child in list(src.children_recursive):
        if child.type == "MESH":
            bpy.data.objects.remove(child, do_unlink=True)
        else:
            child.hide_render = True
            child.hide_viewport = True


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type == "ARMATURE" and any(b.name.startswith("mixamorig") for b in o.data.bones):
            continue
        if o.type in {"ARMATURE", "MESH"}:
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
    print(f"WROTE {path} ({path.stat().st_size} bytes)")


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser(description="Bake Mixamo FBX onto Dorothy MASTER")
    p.add_argument("--src", type=Path, default=DEFAULT_SRC, help="Master Mixamo FBX")
    p.add_argument("--out-stem", default="Wave", help="Output filename stem")
    p.add_argument("--action-name", default="Wave", help="Baked action name")
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
    bpy.ops.import_scene.gltf(filepath=str(DOROTHY_GLB))
    tgt = find_armature(mixamo=False)
    tgt.name = "DorothyArmature"
    if tgt.animation_data:
        tgt.animation_data_clear()
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"TARGET {tgt.name} bones={len(tgt.data.bones)}")

    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(master_fbx),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in added if o.type == "ARMATURE")
    src.name = "MixamoSource"
    print(f"SOURCE {src.name} bones={len(src.data.bones)}")

    action = src.animation_data.action if src.animation_data else None
    if action is None:
        if not bpy.data.actions:
            raise SystemExit("No actions on Mixamo FBX")
        action = bpy.data.actions[0]
        if not src.animation_data:
            src.animation_data_create()
        src.animation_data.action = action

    frame_start = int(round(action.frame_range[0]))
    frame_end = int(round(action.frame_range[1]))
    scene = bpy.context.scene
    scene.render.fps = 60
    scene.render.fps_base = 1.0
    scene.frame_start = frame_start
    scene.frame_end = frame_end
    scene.frame_set(frame_start)
    print(f"ACTION {action.name} frames {frame_start}..{frame_end} fps={scene.render.fps}")

    align_source_to_target(src, tgt)
    bake_local_rotations(src, tgt, frame_start, frame_end)

    if tgt.animation_data and tgt.animation_data.action:
        tgt.animation_data.action.name = args.action_name

    hide_mixamo_source(src)
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE" and any(b.name.startswith("mixamorig") for b in o.data.bones):
            bpy.data.objects.remove(o, do_unlink=True)

    export_glb(out_glb)
    export_glb(out_studio)
    print(f"DONE {args.action_name} → {out_glb.name}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("BAKE FAILED:", e, file=sys.stderr)
        raise
