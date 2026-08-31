#!/usr/bin/env python3
"""
Feet paddle fix + level Fly Idle pitch (bounded).

1) Extend L/R toe chains to membrane/foot tips; reweight feet only.
2) Reduce Fly IdleLoop forward body pitch toward Idle hover (not Fly Forward dive).

Wings / torso / head / body weights untouched. Source: wingext blend copy.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/fix_reskin_feet_flyidle.py
"""
from __future__ import annotations

import json
import math
import re
import shutil
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_wingext.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_feet_flyidle.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_feet_flyidle_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_feet_flyidle_report.md"

KEEP = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]
ARM_NAME = "ARM_GargoyleNative"
MESH_NAME = "SM_WingedMonkey_reskin"
ROOT_BONE = "GargPelvis"

# Foot chains: ankle → primary toe → tip (extend Toe2 to mesh tip)
FOOT = {
    "L": {
        "ankle": "GargLLegAnkle",
        "toe1": "GargLLegToe1",
        "toe2": "GargLLegToe2",
        "extra": ["GargLLegDigit21", "GargLLegDigit22"],
    },
    "R": {
        "ankle": "GargRAnkle",
        "toe1": "GargRToe1",
        "toe2": "GargRToe2",
        "extra": ["GargRToe011", "GargRToe012"],
    },
}

WING_RE = re.compile(r"Wing", re.I)
HEAD_RE = re.compile(r"(Head|Jaw|Neck|Brow|Eye|Lid|Tongue)", re.I)
TORSO_RE = re.compile(r"(Pelvis|Spine|Rib|Tail)", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


def get_fcurves(action: bpy.types.Action) -> list:
    fcs = list(action.fcurves) if hasattr(action, "fcurves") else []
    if fcs:
        return fcs
    out = []
    for layer in getattr(action, "layers", []) or []:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []) or []:
                out.extend(cb.fcurves)
    return out


def action_frame_range(action: bpy.types.Action) -> tuple[int, int]:
    frames: list[float] = []
    for fc in get_fcurves(action):
        for kp in fc.keyframe_points:
            frames.append(kp.co[0])
    if not frames:
        return 1, 1
    return int(round(min(frames))), int(round(max(frames)))


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    if arm.animation_data:
        arm.animation_data.action = None
        for t in arm.animation_data.nla_tracks:
            t.mute = True
    bpy.context.view_layer.update()


def play_action(arm: bpy.types.Object, name: str, frame: int) -> None:
    act = bpy.data.actions[name]
    if not arm.animation_data:
        arm.animation_data_create()
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    arm.animation_data.action = act
    if hasattr(arm.animation_data, "action_slot"):
        slots = list(getattr(arm.animation_data, "action_suitable_slots", []) or [])
        if slots:
            try:
                arm.animation_data.action_slot = slots[0]
            except Exception:
                pass
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def restore_nla(arm: bpy.types.Object) -> None:
    if not arm.animation_data:
        arm.animation_data_create()
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)
    arm.animation_data.action = None
    cursor = 1
    for name in KEEP:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, start=cursor, action=act)
        if hasattr(strip, "action_slot"):
            slots = list(getattr(arm.animation_data, "action_suitable_slots", []) or [])
            if slots:
                try:
                    strip.action_slot = slots[0]
                except Exception:
                    pass
        cursor = int(strip.frame_end) + 2


def mesh_world_aabb(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        co = [ev.matrix_world @ v.co for v in me.vertices]
        mn = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
        mx = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
        return mn, mx
    finally:
        ev.to_mesh_clear()


def verts_arm_local(mesh: bpy.types.Object, arm: bpy.types.Object) -> list[Vector]:
    inv = arm.matrix_world.inverted()
    return [inv @ (mesh.matrix_world @ v.co) for v in mesh.data.vertices]


def body_region_indices(mesh: bpy.types.Object, arm: bpy.types.Object) -> tuple[set[int], set[int]]:
    locals_ = verts_arm_local(mesh, arm)
    zs = [p.z for p in locals_]
    zmin, zmax = min(zs), max(zs)
    zspan = zmax - zmin or 1.0
    head = {
        i
        for i, p in enumerate(locals_)
        if p.z > zmin + 0.68 * zspan and abs(p.x) < 0.16
    }
    torso = {
        i
        for i, p in enumerate(locals_)
        if zmin + 0.18 * zspan < p.z < zmin + 0.70 * zspan and abs(p.x) < 0.11
    }
    return head, torso


def wing_vert_indices(mesh: bpy.types.Object, arm: bpy.types.Object) -> set[int]:
    """Lateral wing membrane — do not touch (already fixed)."""
    locals_ = verts_arm_local(mesh, arm)
    zs = [p.z for p in locals_]
    zmin, zmax = min(zs), max(zs)
    zspan = zmax - zmin or 1.0
    out: set[int] = set()
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    for i, p in enumerate(locals_):
        if abs(p.x) < 0.14:
            continue
        if p.z < zmin + 0.12 * zspan:
            continue  # feet
        wing_w = tot = 0.0
        for g in mesh.data.vertices[i].groups:
            n = idx_to_name.get(g.group, "")
            tot += g.weight
            if WING_RE.search(n):
                wing_w += g.weight
        share = wing_w / tot if tot > 1e-8 else 0.0
        if share >= 0.2 or abs(p.x) > 0.18:
            out.add(i)
    return out


def foot_vert_indices(mesh: bpy.types.Object, arm: bpy.types.Object, side: str) -> list[int]:
    locals_ = verts_arm_local(mesh, arm)
    zs = [p.z for p in locals_]
    zmin, zmax = min(zs), max(zs)
    zspan = zmax - zmin or 1.0
    sign = 1.0 if side == "L" else -1.0
    out = []
    for i, p in enumerate(locals_):
        if p.z > zmin + 0.14 * zspan:
            continue
        if sign * p.x < 0.01:
            continue
        out.append(i)
    return out


def foot_mesh_tip(mesh: bpy.types.Object, arm: bpy.types.Object, side: str) -> Vector:
    """Farthest forward (−Y) low point of the foot mesh, arm-local."""
    idxs = foot_vert_indices(mesh, arm, side)
    locals_ = verts_arm_local(mesh, arm)
    if not idxs:
        raise RuntimeError(f"no foot verts for {side}")
    best_i = max(idxs, key=lambda i: (-locals_[i].y, -abs(locals_[i].z)))
    return locals_[best_i].copy()


def align_roll_like(eb_child, eb_parent) -> None:
    axis = (eb_child.tail - eb_child.head)
    if axis.length < 1e-8:
        return
    axis.normalize()
    parent_y = eb_parent.y_axis.copy()
    guide = parent_y - axis * parent_y.dot(axis)
    if guide.length < 1e-6:
        guide = Vector((0, 0, 1)) - axis * axis.z
    if guide.length < 1e-6:
        guide = Vector((0, 1, 0))
    try:
        eb_child.align_roll(guide.normalized())
    except Exception:
        pass


def extend_foot_bones(arm: bpy.types.Object, mesh: bpy.types.Object) -> dict:
    """
    Stretch primary Toe1→Toe2 to the foot tip, and realign secondary toe rays
    (L Digits / R Toe011) forward along the foot so they no longer point up
    and paddle the mesh. All new/edited bones keep inherit_rotation (FK).
    """
    clear_pose(arm)
    report: dict = {"sides": {}}

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    for side, cfg in FOOT.items():
        ankle_n = cfg["ankle"]
        t1_n = cfg["toe1"]
        t2_n = cfg["toe2"]
        extras = list(cfg.get("extra", []))
        if ankle_n not in eb or t1_n not in eb or t2_n not in eb:
            raise RuntimeError(f"missing foot bones {side}: {ankle_n}/{t1_n}/{t2_n}")

        tip = foot_mesh_tip(mesh, arm, side)
        ankle = eb[ankle_n]
        # Plant start near ankle head, slightly forward/down toward tip
        plant = ankle.head.copy()
        plant.z = min(plant.z, tip.z + 0.02)
        plant = plant.lerp(tip, 0.15)
        mid = plant.lerp(tip, 0.55)
        end = tip.copy()
        end.z = max(end.z, 0.005)

        t1 = eb[t1_n]
        t2 = eb[t2_n]
        before_len = (t2.tail - t1.head).length

        t1.parent = ankle
        t1.use_connect = False
        t1.use_inherit_rotation = True
        t1.use_deform = True
        t1.head = plant
        t1.tail = mid
        if (t1.tail - t1.head).length < 1e-4:
            t1.tail = t1.head + Vector((0.02 if side == "L" else -0.02, -0.04, -0.01))
        align_roll_like(t1, ankle)

        t2.parent = t1
        t2.use_connect = True
        t2.use_inherit_rotation = True
        t2.use_deform = True
        t2.head = mid.copy()
        t2.tail = end
        if (t2.tail - t2.head).length < 1e-4:
            t2.tail = t2.head + (mid - plant).normalized() * 0.03
        align_roll_like(t2, t1)

        # Secondary toe rays: fan slightly left/right of the primary axis
        axis = (end - plant)
        if axis.length < 1e-6:
            axis = Vector((0, -1, 0))
        axis.normalize()
        lateral = Vector((1, 0, 0)) if side == "L" else Vector((-1, 0, 0))
        lateral = (lateral - axis * lateral.dot(axis))
        if lateral.length < 1e-6:
            lateral = Vector((0, 0, 1)).cross(axis)
        lateral.normalize()

        # extras come in pairs [proximal, distal]
        if len(extras) >= 2 and all(n in eb for n in extras[:2]):
            e1, e2 = eb[extras[0]], eb[extras[1]]
            bias = lateral * (0.025 if side == "L" else 0.025)
            e_start = plant + bias * 0.4 + axis * 0.02
            e_mid = plant.lerp(tip, 0.5) + bias
            e_end = tip.lerp(plant, 0.1) + bias * 1.2
            e_end.z = max(e_end.z, 0.005)
            e1.parent = ankle
            e1.use_connect = False
            e1.use_inherit_rotation = True
            e1.use_deform = True
            e1.head = e_start
            e1.tail = e_mid
            align_roll_like(e1, ankle)
            e2.parent = e1
            e2.use_connect = True
            e2.use_inherit_rotation = True
            e2.use_deform = True
            e2.head = e_mid.copy()
            e2.tail = e_end
            align_roll_like(e2, e1)

        after_len = (t2.tail - t1.head).length
        report["sides"][side] = {
            "tip": [round(c, 4) for c in tip],
            "before_chain_len": round(before_len, 4),
            "after_chain_len": round(after_len, 4),
            "bones": [t1_n, t2_n] + extras[:2],
        }
        log(
            f"{side} foot chain {before_len:.3f}→{after_len:.3f}m  tip={[round(c,3) for c in tip]}"
        )

    bpy.ops.object.mode_set(mode="OBJECT")
    clear_pose(arm)
    return report


def _dist_point_segment(p: Vector, a: Vector, b: Vector) -> float:
    ab = b - a
    d2 = ab.length_squared
    if d2 < 1e-12:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / d2))
    return (p - (a + t * ab)).length


def bone_segments(arm: bpy.types.Object, names: list[str]) -> list[tuple[str, Vector, Vector]]:
    inv = arm.matrix_world.inverted()
    segs = []
    for n in names:
        if n not in arm.data.bones:
            continue
        b = arm.data.bones[n]
        segs.append(
            (
                n,
                inv @ (arm.matrix_world @ b.head_local),
                inv @ (arm.matrix_world @ b.tail_local),
            )
        )
    return segs


def snapshot_weights(mesh: bpy.types.Object) -> list[list[tuple[str, float]]]:
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    return [
        [(idx_to_name[g.group], g.weight) for g in v.groups if g.group in idx_to_name]
        for v in mesh.data.vertices
    ]


def reweight_feet_only(
    mesh: bpy.types.Object,
    arm: bpy.types.Object,
    frozen: set[int],
    old_weights: list,
) -> dict:
    """Assign foot verts to ankle/toe bones; restore frozen verts exactly."""
    clear_pose(arm)
    groups = {vg.name: vg for vg in mesh.vertex_groups}
    touched = 0

    for side, cfg in FOOT.items():
        names = [cfg["ankle"], cfg["toe1"], cfg["toe2"]] + list(cfg.get("extra", []))
        for n in names:
            if n not in groups and n in arm.data.bones:
                mesh.vertex_groups.new(name=n)
        groups = {vg.name: vg for vg in mesh.vertex_groups}
        segs = bone_segments(arm, names)
        idxs = [i for i in foot_vert_indices(mesh, arm, side) if i not in frozen]
        arm_inv = arm.matrix_world.inverted()
        for i in idxs:
            p = arm_inv @ (mesh.matrix_world @ mesh.data.vertices[i].co)
            dists = [(n, max(_dist_point_segment(p, a, b), 1e-4)) for n, a, b in segs]
            dists.sort(key=lambda x: x[1])
            use = dists[:3]
            invs = [1.0 / (d * d) for _, d in use]
            s = sum(invs) or 1.0
            for vg in mesh.vertex_groups:
                try:
                    vg.remove([i])
                except RuntimeError:
                    pass
            for (n, _), w in zip(use, invs):
                groups[n].add([i], w / s, type="REPLACE")
            touched += 1

    # Restore frozen (wings + body + head)
    for i in frozen:
        for vg in mesh.vertex_groups:
            try:
                vg.remove([i])
            except RuntimeError:
                pass
        rows = old_weights[i]
        tot = sum(w for _, w in rows) or 1.0
        for n, w in rows:
            if n not in groups:
                mesh.vertex_groups.new(name=n)
                groups = {vg.name: vg for vg in mesh.vertex_groups}
            groups[n].add([i], w / tot, type="REPLACE")

    # Light smooth on feet only, then re-freeze
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    for v in mesh.data.vertices:
        v.select = False
    for side in ("L", "R"):
        for i in foot_vert_indices(mesh, arm, side):
            if i not in frozen:
                mesh.data.vertices[i].select = True
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        bpy.ops.object.vertex_group_smooth(factor=0.12, repeat=1, expand=0.0)
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01, keep_single=True)
    except Exception as e:
        log(f"foot smooth warn: {e}")
    bpy.ops.object.mode_set(mode="OBJECT")

    for i in frozen:
        for vg in mesh.vertex_groups:
            try:
                vg.remove([i])
            except RuntimeError:
                pass
        rows = old_weights[i]
        tot = sum(w for _, w in rows) or 1.0
        for n, w in rows:
            groups[n].add([i], w / tot, type="REPLACE")

    return {"foot_reweighted": touched}


def region_weight_share(mesh: bpy.types.Object, idxs: set[int] | list[int]) -> dict:
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    foot_w = wing_w = head_w = torso_w = other_w = 0.0
    for i in idxs:
        for g in mesh.data.vertices[i].groups:
            n = idx_to_name.get(g.group, "")
            w = g.weight
            if any(x in n for x in ("Ankle", "Toe", "Digit2", "LegDigit")):
                foot_w += w
            elif WING_RE.search(n):
                wing_w += w
            elif HEAD_RE.search(n):
                head_w += w
            elif TORSO_RE.search(n):
                torso_w += w
            else:
                other_w += w
    tot = foot_w + wing_w + head_w + torso_w + other_w or 1.0
    return {
        "foot": round(foot_w / tot, 3),
        "wing": round(wing_w / tot, 3),
        "head": round(head_w / tot, 3),
        "torso": round(torso_w / tot, 3),
        "other": round(other_w / tot, 3),
        "n": len(idxs),
    }


def body_pitch_deg(arm: bpy.types.Object) -> float:
    """Forward pitch of pelvis→head axis from +Z toward −Y (degrees)."""
    pel = (arm.matrix_world @ arm.pose.bones["GargPelvis"].matrix).translation
    head = (arm.matrix_world @ arm.pose.bones["GargHead"].matrix).translation
    d = (head - pel).normalized()
    return math.degrees(math.atan2(-d.y, d.z))


def bone_world_matrix(arm: bpy.types.Object, name: str) -> Matrix:
    return arm.matrix_world @ arm.pose.bones[name].matrix


def set_pelvis_world(arm: bpy.types.Object, world_m: Matrix) -> None:
    pb = arm.pose.bones[ROOT_BONE]
    pb.matrix = arm.matrix_world.inverted() @ world_m
    bpy.context.view_layer.update()


def _remove_pelvis_rot_fcurves(action: bpy.types.Action) -> None:
    needle = f'pose.bones["{ROOT_BONE}"]'
    for fc in list(get_fcurves(action)):
        if needle in fc.data_path and "rotation" in fc.data_path:
            try:
                action.fcurves.remove(fc)
            except Exception:
                for layer in getattr(action, "layers", []) or []:
                    for strip in layer.strips:
                        for cb in getattr(strip, "channelbags", []) or []:
                            if fc in list(cb.fcurves):
                                cb.fcurves.remove(fc)


def level_fly_idle(arm: bpy.types.Object, mesh: bpy.types.Object) -> dict:
    """
    Bake pelvis pitch correction into FlyIdleLoop so body pitch ≈ Idle hover,
    clearly less pitched than FlyForward. Location keys untouched (grounded).
    """
    clear_pose(arm)
    # Reference pitch from Idle mid-frame
    idle = bpy.data.actions["Idle"]
    if0, if1 = action_frame_range(idle)
    play_action(arm, "Idle", (if0 + if1) // 2)
    target_pitch = body_pitch_deg(arm)
    # Slightly more upright than Idle for a clearer "hover" read
    target_pitch = target_pitch - 8.0

    play_action(arm, "FlyForward", 16)
    fwd_pitch = body_pitch_deg(arm)
    play_action(arm, "FlyIdleLoop", 16)
    pre_pitch = body_pitch_deg(arm)

    act = bpy.data.actions["FlyIdleLoop"]
    f0, f1 = action_frame_range(act)
    pb = arm.pose.bones[ROOT_BONE]
    pb.rotation_mode = "QUATERNION"

    corrected: list[tuple[int, Quaternion]] = []
    pitches_pre: list[float] = []
    pitches_post: list[float] = []

    for fr in range(f0, f1 + 1):
        play_action(arm, "FlyIdleLoop", fr)
        cur = body_pitch_deg(arm)
        pitches_pre.append(cur)
        delta = math.radians(target_pitch - cur)
        # Pitch about world +X (right) reduces forward lean for −Y facing
        if abs(delta) >= math.radians(0.15):
            pw = bone_world_matrix(arm, ROOT_BONE)
            origin = pw.translation
            R = Matrix.Rotation(delta, 4, "X")
            new_pw = Matrix.Translation(origin) @ R @ Matrix.Translation(-origin) @ pw
            set_pelvis_world(arm, new_pw)
        bpy.context.view_layer.update()
        pitches_post.append(body_pitch_deg(arm))
        corrected.append((fr, pb.rotation_quaternion.copy()))

    _remove_pelvis_rot_fcurves(act)
    play_action(arm, "FlyIdleLoop", f0)
    for fr, quat in corrected:
        pb.rotation_quaternion = quat
        pb.keyframe_insert(data_path="rotation_quaternion", frame=fr)

    play_action(arm, "FlyIdleLoop", (f0 + f1) // 2)
    post_pitch = body_pitch_deg(arm)
    play_action(arm, "FlyForward", 16)
    fwd_after = body_pitch_deg(arm)  # should be unchanged

    report = {
        "target_pitch": round(target_pitch, 2),
        "idle_ref_pitch": round(target_pitch + 8.0, 2),
        "flyidle_pre": round(pre_pitch, 2),
        "flyidle_post": round(post_pitch, 2),
        "flyforward": round(fwd_pitch, 2),
        "flyforward_unchanged": round(fwd_after, 2),
        "delta_mean": round(
            sum(a - b for a, b in zip(pitches_post, pitches_pre)) / len(pitches_pre), 2
        ),
        "frames": [f0, f1],
    }
    log(
        f"FlyIdle pitch {pre_pitch:.1f}°→{post_pitch:.1f}° "
        f"(target {target_pitch:.1f}°, FlyFwd {fwd_pitch:.1f}°)"
    )
    clear_pose(arm)
    return report


def foot_spread_ratio(arm: bpy.types.Object, mesh: bpy.types.Object, action: str, frames: list[int]) -> float:
    """Cluster radius of foot tip verts — ~1.0 = no paddle stretch."""
    spreads = []
    for fr in frames:
        play_action(arm, action, fr)
        deps = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(deps)
        me = ev.to_mesh()
        try:
            for side in ("L", "R"):
                idxs = foot_vert_indices(mesh, arm, side)
                # tip-most by -Y at rest classification already; use all foot
                pts = [ev.matrix_world @ me.vertices[i].co for i in idxs[:80]]
                if not pts:
                    continue
                c = sum(pts, Vector()) / len(pts)
                spreads.append(max((p - c).length for p in pts))
        finally:
            ev.to_mesh_clear()
    if not spreads:
        return 999.0
    return max(spreads) / max(min(spreads), 1e-6)


def verify(arm: bpy.types.Object, mesh: bpy.types.Object) -> dict:
    clear_pose(arm)
    head_idx, torso_idx = body_region_indices(mesh, arm)
    out = {
        "body": {
            "head": region_weight_share(mesh, head_idx),
            "torso": region_weight_share(mesh, torso_idx),
        },
        "feet": {},
        "pitch": {},
        "foot_spread": {},
    }
    for side in ("L", "R"):
        idxs = foot_vert_indices(mesh, arm, side)
        tip = sorted(idxs, key=lambda i: verts_arm_local(mesh, arm)[i].y)[:80]
        out["feet"][side] = region_weight_share(mesh, tip)

    for name, fr in [("Idle", 56), ("FlyIdleLoop", 16), ("FlyForward", 16)]:
        play_action(arm, name, fr)
        out["pitch"][name] = round(body_pitch_deg(arm), 2)

    for clip in ["Idle", "FlyIdleLoop", "FlyForward"]:
        act = bpy.data.actions[clip]
        f0, f1 = action_frame_range(act)
        mid = (f0 + f1) // 2
        ratio = foot_spread_ratio(arm, mesh, clip, [f0, mid, f1])
        out["foot_spread"][clip] = round(ratio, 3)

    clear_pose(arm)
    # Distinctness: FlyIdle should be clearly less pitched than FlyForward
    out["hover_distinct"] = out["pitch"]["FlyIdleLoop"] + 5.0 < out["pitch"]["FlyForward"]
    return out


def export_glb(arm: bpy.types.Object, mesh: bpy.types.Object) -> float:
    donor = bpy.data.objects.get("GargoyleAnimDonor")
    if donor:
        bpy.data.objects.remove(donor, do_unlink=True)
    for act in list(bpy.data.actions):
        if act.name not in KEEP:
            bpy.data.actions.remove(act)
    restore_nla(arm)

    bpy.ops.object.select_all(action="DESELECT")
    mesh.hide_viewport = False
    arm.hide_viewport = False
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    kwargs = dict(
        filepath=str(OUT_GLB),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_nla_strips=True,
        export_anim_single_armature=True,
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=False,
        export_skins=True,
        export_morph=False,
    )
    if "export_animation_mode" in bpy.ops.export_scene.gltf.get_rna_type().properties.keys():
        kwargs["export_animation_mode"] = "NLA_TRACKS"
    bpy.ops.export_scene.gltf(**kwargs)
    mb = OUT_GLB.stat().st_size / 1024 / 1024
    log(f"exported {OUT_GLB} ({mb:.2f} MB)")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    for p in CLIP_DIR.glob("*.glb"):
        p.unlink()
    mesh.hide_viewport = True
    mesh.hide_render = True
    for name in KEEP:
        act = bpy.data.actions.get(name)
        for t in arm.animation_data.nla_tracks:
            t.mute = True
        arm.animation_data.action = act
        bpy.ops.object.select_all(action="DESELECT")
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        out = CLIP_DIR / f"{name}.glb"
        ck = dict(
            filepath=str(out),
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_animations=True,
            export_nla_strips=False,
            export_anim_single_armature=True,
            export_cameras=False,
            export_lights=False,
            export_draco_mesh_compression_enable=False,
            export_skins=True,
            export_morph=False,
        )
        if "export_animation_mode" in bpy.ops.export_scene.gltf.get_rna_type().properties.keys():
            ck["export_animation_mode"] = "ACTIVE_ACTIONS"
        bpy.ops.export_scene.gltf(**ck)
    mesh.hide_viewport = False
    mesh.hide_render = False
    restore_nla(arm)
    return mb


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"missing {SRC}")
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    if OUT_BLEND.resolve() != SRC.resolve():
        shutil.copy2(SRC, OUT_BLEND)
        log(f"copied → {OUT_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    arm = bpy.data.objects[ARM_NAME]
    mesh = bpy.data.objects[MESH_NAME]
    clear_pose(arm)

    head_idx, torso_idx = body_region_indices(mesh, arm)
    wing_idx = wing_vert_indices(mesh, arm)
    frozen = head_idx | torso_idx | wing_idx
    old_weights = snapshot_weights(mesh)

    before_feet = {
        "L": region_weight_share(mesh, foot_vert_indices(mesh, arm, "L")),
        "R": region_weight_share(mesh, foot_vert_indices(mesh, arm, "R")),
    }
    before_body = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
    }
    log(f"before feet L={before_feet['L']} R={before_feet['R']}")
    log(f"before body {before_body}")

    log("=== Fix 1: extend foot bones + reweight feet ===")
    bone_report = extend_foot_bones(arm, mesh)
    weight_report = reweight_feet_only(mesh, arm, frozen, old_weights)
    after_feet = {
        "L": region_weight_share(mesh, foot_vert_indices(mesh, arm, "L")),
        "R": region_weight_share(mesh, foot_vert_indices(mesh, arm, "R")),
    }
    after_body = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
    }
    log(f"after feet L={after_feet['L']} R={after_feet['R']}")
    log(f"after body {after_body}")

    log("=== Fix 2: level Fly Idle pitch ===")
    pitch_report = level_fly_idle(arm, mesh)

    log("=== VERIFY ===")
    verify_report = verify(arm, mesh)
    log(f"pitch {verify_report['pitch']} hover_distinct={verify_report['hover_distinct']}")
    log(f"foot_spread {verify_report['foot_spread']}")

    log("=== EXPORT ===")
    mb = export_glb(arm, mesh)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {
        "source": str(SRC.relative_to(ROOT)),
        "working": str(OUT_BLEND.relative_to(ROOT)),
        "glb": str(OUT_GLB.relative_to(ROOT)),
        "glb_mb": round(mb, 2),
        "bones": bone_report,
        "weights": {
            "before_feet": before_feet,
            "after_feet": after_feet,
            "before_body": before_body,
            "after_body": after_body,
            **weight_report,
        },
        "pitch": pitch_report,
        "verify": verify_report,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2))
    lines = [
        "# Reskin — feet + Fly Idle pitch",
        "",
        f"- Source: `{report['source']}`",
        f"- Working: `{report['working']}`",
        f"- GLB: `{report['glb']}` ({mb:.2f} MB)",
        "",
        "## Feet",
        f"- Before L: {before_feet['L']}",
        f"- After L:  {after_feet['L']}",
        f"- Before R: {before_feet['R']}",
        f"- After R:  {after_feet['R']}",
        f"- Body head/torso unchanged: {before_body == after_body}",
        "",
        "## Fly Idle pitch",
        f"- Pre→post: {pitch_report['flyidle_pre']}→{pitch_report['flyidle_post']} "
        f"(target {pitch_report['target_pitch']}, FlyFwd {pitch_report['flyforward']})",
        "",
        "## Verify",
        f"- Pitch: {verify_report['pitch']}",
        f"- Hover distinct from FlyFwd: {verify_report['hover_distinct']}",
        f"- Foot spread ratios: {verify_report['foot_spread']}",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")
    log("DONE")


if __name__ == "__main__":
    main()
