#!/usr/bin/env python3
"""
Fix winged-monkey reskin WIP in one pass (true-scale normalized space):

  A) Re-express all 5 actions so animated facing matches rest (no residual yaw).
  B) Ground / in-place root: strip world height + XY travel (game owns z).
  C) Rebind torso + head weights only; keep existing wing weights untouched.

Works on a COPY of Monkey_reskin_gargoyle_normalized.blend. Masters untouched.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/fix_reskin_facing_ground_weights.py
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
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_normalized.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_polished.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_polish_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_polish_report.md"

KEEP = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]
ARM_NAME = "ARM_GargoyleNative"
MESH_NAME = "SM_WingedMonkey_reskin"
ROOT_BONE = "GargPelvis"

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


def flat_forward(arm: bpy.types.Object) -> Vector | None:
    left = "GargLArmUpperarm1"
    right = "GargRUpperarm1"
    if left not in arm.pose.bones or right not in arm.pose.bones:
        return None
    ls = arm.matrix_world @ arm.pose.bones[left].head
    rs = arm.matrix_world @ arm.pose.bones[right].head
    right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right_v.length < 1e-8:
        return None
    right_v.normalize()
    fwd = Vector((0.0, 0.0, 1.0)).cross(right_v)
    if fwd.length < 1e-8:
        return None
    return fwd.normalized()


def signed_yaw(a: Vector, b: Vector) -> float:
    """Radians about +Z from a → b (horizontal)."""
    aa = Vector((a.x, a.y)).normalized()
    bb = Vector((b.x, b.y)).normalized()
    return math.atan2(aa.x * bb.y - aa.y * bb.x, aa.x * bb.x + aa.y * bb.y)


def yaw_deg(v: Vector) -> float:
    return math.degrees(math.atan2(v.x, v.y))


def bone_world_matrix(arm: bpy.types.Object, name: str) -> Matrix:
    return arm.matrix_world @ arm.pose.bones[name].matrix


def set_pelvis_world(arm: bpy.types.Object, world_m: Matrix) -> None:
    """Set GargPelvis pose so its world matrix matches world_m (location+rot)."""
    pb = arm.pose.bones[ROOT_BONE]
    # pose.matrix is armature-local; convert desired world → armature space
    arm_local = arm.matrix_world.inverted() @ world_m
    pb.matrix = arm_local
    bpy.context.view_layer.update()


def snapshot_weights(mesh: bpy.types.Object) -> list[list[tuple[str, float]]]:
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    out: list[list[tuple[str, float]]] = []
    for v in mesh.data.vertices:
        out.append([(idx_to_name[g.group], g.weight) for g in v.groups if g.group in idx_to_name])
    return out


def ensure_groups(mesh: bpy.types.Object, names: set[str]) -> dict[str, bpy.types.VertexGroup]:
    existing = {vg.name: vg for vg in mesh.vertex_groups}
    for n in names:
        if n not in existing:
            existing[n] = mesh.vertex_groups.new(name=n)
    return existing


def classify_wing_verts(mesh: bpy.types.Object, arm: bpy.types.Object) -> set[int]:
    """
    Verts that currently belong to wings — do not touch.
    Never lock head/torso core verts even if heat wrongly weighted them to wings.
    """
    me = mesh.data
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    wing_idxs: set[int] = set()
    arm_inv = arm.matrix_world.inverted()
    locals_: list[Vector] = []
    for v in me.vertices:
        locals_.append(arm_inv @ (mesh.matrix_world @ v.co))
    zs = [p.z for p in locals_]
    xs = [p.x for p in locals_]
    zmin, zmax = min(zs), max(zs)
    z_span = zmax - zmin or 1.0
    x_span = max(xs) - min(xs) or 1.0

    for i, v in enumerate(me.vertices):
        p = locals_[i]
        # Head / central torso: always eligible for rebind (Fix C target).
        in_head = p.z > zmin + 0.68 * z_span and abs(p.x) < 0.16
        in_torso_core = (
            abs(p.x) < 0.11
            and (zmin + 0.18 * z_span) < p.z < (zmin + 0.70 * z_span)
        )
        if in_head or in_torso_core:
            continue

        wing_w = 0.0
        tot = 0.0
        for g in v.groups:
            n = idx_to_name.get(g.group, "")
            tot += g.weight
            if WING_RE.search(n):
                wing_w += g.weight
        share = wing_w / tot if tot > 1e-8 else 0.0
        lateral = abs(p.x) > 0.14
        in_wing_band = (zmin + 0.12 * z_span) < p.z < (zmin + 0.98 * z_span)
        if share >= 0.25 or (lateral and in_wing_band and share >= 0.10):
            wing_idxs.add(i)
    return wing_idxs


def _bone_segments_arm_local(
    arm: bpy.types.Object, names: list[str]
) -> list[tuple[str, Vector, Vector]]:
    segs: list[tuple[str, Vector, Vector]] = []
    inv = arm.matrix_world.inverted()
    for n in names:
        if n not in arm.data.bones:
            continue
        b = arm.data.bones[n]
        h = inv @ (arm.matrix_world @ b.head_local)
        t = inv @ (arm.matrix_world @ b.tail_local)
        segs.append((n, h, t))
    return segs


def _dist_point_segment(p: Vector, a: Vector, b: Vector) -> float:
    ab = b - a
    denom = ab.length_squared
    if denom < 1e-12:
        return (p - a).length
    t = max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length


def reinforce_head_torso_weights(
    mesh: bpy.types.Object, arm: bpy.types.Object, wing_verts: set[int]
) -> None:
    """
    After cage transfer, force head/torso-core verts onto nearby body bones
    (strips residual wing/brow bleed that the ellipsoid cage still leaks).
    """
    clear_pose(arm)
    arm_inv = arm.matrix_world.inverted()
    locals_ = [arm_inv @ (mesh.matrix_world @ v.co) for v in mesh.data.vertices]
    zs = [p.z for p in locals_]
    zmin, zmax = min(zs), max(zs)
    z_span = zmax - zmin or 1.0

    head_bones = [
        "GargHead",
        "GargNeck2",
        "GargNeck1",
        "GargJaw",
        "GargSpine3",
        "GargRibcage",
    ]
    torso_bones = [
        "GargPelvis",
        "GargSpine1",
        "GargSpine2",
        "GargSpine3",
        "GargRibcage",
        "GargTail1",
    ]
    head_segs = _bone_segments_arm_local(arm, head_bones)
    torso_segs = _bone_segments_arm_local(arm, torso_bones)
    groups = ensure_groups(mesh, set(head_bones + torso_bones))

    reinforced = 0
    for i, p in enumerate(locals_):
        if i in wing_verts:
            continue
        in_head = p.z > zmin + 0.68 * z_span and abs(p.x) < 0.16
        in_torso = (
            abs(p.x) < 0.11
            and (zmin + 0.18 * z_span) < p.z < (zmin + 0.70 * z_span)
        )
        if not (in_head or in_torso):
            continue
        segs = head_segs if in_head else torso_segs
        if not segs:
            continue
        # Softmax-ish inverse-distance weights to nearest body bones
        dists = [(n, max(_dist_point_segment(p, a, b), 1e-4)) for n, a, b in segs]
        dists.sort(key=lambda x: x[1])
        use = dists[:4]
        invs = [1.0 / (d ** 2) for _, d in use]
        s = sum(invs) or 1.0
        # Clear existing, assign body
        for vg in list(mesh.vertex_groups):
            try:
                vg.remove([i])
            except RuntimeError:
                pass
        for (n, _), w in zip(use, invs):
            groups[n].add([i], w / s, type="REPLACE")
        reinforced += 1
    log(f"reinforced head/torso verts: {reinforced}")


def heat_bind_body_cage(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict:
    """
    Fresh heat-derived weights for non-wing verts via a body-fitting cage.
    Temporarily disables wing-bone deform so heat prefers spine/head/limbs.
    """
    clear_pose(arm)
    wing_verts = classify_wing_verts(mesh, arm)
    old = snapshot_weights(mesh)
    log(f"wing verts locked: {len(wing_verts)}/{len(mesh.data.vertices)}")

    # Disable wing deform during heat so body mass binds to torso/head.
    deform_flags: dict[str, bool] = {}
    for b in arm.data.bones:
        deform_flags[b.name] = b.use_deform
        if WING_RE.search(b.name):
            b.use_deform = False

    # AABB-fitted ellipsoid cage in arm space (better than a unit sphere).
    mn, mx = mesh_world_aabb(mesh)
    center = (mn + mx) * 0.5
    size = mx - mn
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=48, ring_count=24, radius=1.0, location=center
    )
    cage = bpy.context.active_object
    cage.name = "TMP_BodyHeatCage"
    cage.scale = Vector(
        (
            max(size.x * 0.52, 0.08),
            max(size.y * 0.52, 0.08),
            max(size.z * 0.52, 0.08),
        )
    )
    bpy.context.view_layer.update()
    cage.data.transform(arm.matrix_world.inverted() @ cage.matrix_world)
    cage.matrix_world = arm.matrix_world.copy()
    cage.parent = arm
    cage.matrix_parent_inverse = Matrix.Identity(4)

    bpy.ops.object.select_all(action="DESELECT")
    cage.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    cage_w = sum(1 for v in cage.data.vertices if v.groups)
    log(f"body cage heat weighted={cage_w}/{len(cage.data.vertices)}")
    if cage_w == 0:
        for b in arm.data.bones:
            b.use_deform = deform_flags[b.name]
        bpy.data.objects.remove(cage, do_unlink=True)
        raise RuntimeError("body heat cage produced 0 weights")

    # Temp mesh receiving transfer (full mesh), then splice.
    # Clear game mesh groups then transfer.
    for mod in list(mesh.modifiers):
        if mod.type != "ARMATURE":
            mesh.modifiers.remove(mod)
    mesh.vertex_groups.clear()

    if mesh.parent != arm:
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

    dt = mesh.modifiers.new("BodyHeatTransfer", type="DATA_TRANSFER")
    dt.object = cage
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.datalayout_transfer(modifier=dt.name)
    bpy.ops.object.modifier_apply(modifier=dt.name)

    bpy.data.objects.remove(cage, do_unlink=True)

    # Restore wing deform flags
    for b in arm.data.bones:
        b.use_deform = deform_flags[b.name]

    # Ensure armature modifier
    if not any(m.type == "ARMATURE" for m in mesh.modifiers):
        am = mesh.modifiers.new("Armature", type="ARMATURE")
        am.object = arm
    else:
        for m in mesh.modifiers:
            if m.type == "ARMATURE":
                m.object = arm

    new_snap = snapshot_weights(mesh)
    # Rebuild: wing verts ← old; body ← new (strip wing influences on body)
    all_names = set()
    for rows in old:
        for n, _ in rows:
            all_names.add(n)
    for rows in new_snap:
        for n, _ in rows:
            all_names.add(n)
    mesh.vertex_groups.clear()
    groups = ensure_groups(mesh, all_names)

    body_fixed = 0
    wings_kept = 0
    for i, v in enumerate(mesh.data.vertices):
        # clear via replace assignment
        if i in wing_verts:
            rows = old[i]
            wings_kept += 1
        else:
            rows = [(n, w) for n, w in new_snap[i] if not WING_RE.search(n)]
            # if body got empty, fall back to non-wing old weights
            if not rows:
                rows = [(n, w) for n, w in old[i] if not WING_RE.search(n)]
            body_fixed += 1
        # normalize
        tot = sum(w for _, w in rows) or 1.0
        for n, w in rows:
            groups[n].add([i], w / tot, type="REPLACE")

    reinforce_head_torso_weights(mesh, arm, wing_verts)

    # Soften body only: select non-wing, smooth lightly
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i, v in enumerate(mesh.data.vertices):
        v.select = i not in wing_verts
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        # smooth only once lightly — wings locked by not selecting? smooth is global in some versions
        bpy.ops.object.vertex_group_smooth(factor=0.12, repeat=1, expand=0.0)
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01, keep_single=True)
        # Re-apply wing snapshot after smooth (smooth can bleed)
        for i in wing_verts:
            for vg in mesh.vertex_groups:
                try:
                    vg.remove([i])
                except RuntimeError:
                    pass
            rows = old[i]
            tot = sum(w for _, w in rows) or 1.0
            for n, w in rows:
                if n not in mesh.vertex_groups:
                    mesh.vertex_groups.new(name=n)
                mesh.vertex_groups[n].add([i], w / tot, type="REPLACE")
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    except Exception as e:
        log(f"weight polish warn: {e}")
    bpy.ops.object.mode_set(mode="OBJECT")

    return {
        "wing_locked": wings_kept,
        "body_rebound": body_fixed,
        "cage_weighted": cage_w,
    }


def region_weight_share(mesh: bpy.types.Object, idxs: list[int]) -> dict:
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    wing_w = head_w = torso_w = other_w = 0.0
    for i in idxs:
        for g in mesh.data.vertices[i].groups:
            n = idx_to_name.get(g.group, "")
            w = g.weight
            if WING_RE.search(n):
                wing_w += w
            elif HEAD_RE.search(n):
                head_w += w
            elif TORSO_RE.search(n):
                torso_w += w
            else:
                other_w += w
    tot = wing_w + head_w + torso_w + other_w or 1.0
    return {
        "wing": round(wing_w / tot, 3),
        "head": round(head_w / tot, 3),
        "torso": round(torso_w / tot, 3),
        "other": round(other_w / tot, 3),
        "n": len(idxs),
    }


def body_region_indices(mesh: bpy.types.Object, arm: bpy.types.Object) -> tuple[list[int], list[int]]:
    arm_inv = arm.matrix_world.inverted()
    locals_ = [arm_inv @ (mesh.matrix_world @ v.co) for v in mesh.data.vertices]
    zs = [p.z for p in locals_]
    zmin, zmax = min(zs), max(zs)
    zspan = zmax - zmin or 1.0
    head = [
        i
        for i, p in enumerate(locals_)
        if p.z > zmin + 0.70 * zspan and abs(p.x) < 0.15
    ]
    torso = [
        i
        for i, p in enumerate(locals_)
        if zmin + 0.20 * zspan < p.z < zmin + 0.68 * zspan and abs(p.x) < 0.12
    ]
    return head, torso


def _remove_pelvis_fcurves(action: bpy.types.Action) -> None:
    needle = f'pose.bones["{ROOT_BONE}"]'
    for fc in list(get_fcurves(action)):
        if needle in fc.data_path and (
            "location" in fc.data_path or "rotation" in fc.data_path
        ):
            try:
                action.fcurves.remove(fc)
            except Exception:
                # Blender 5 layered: remove via channelbag
                removed = False
                for layer in getattr(action, "layers", []) or []:
                    for strip in layer.strips:
                        for cb in getattr(strip, "channelbags", []) or []:
                            if fc in list(cb.fcurves):
                                cb.fcurves.remove(fc)
                                removed = True
                                break
                        if removed:
                            break
                    if removed:
                        break


def fix_actions_facing_and_ground(
    arm: bpy.types.Object, mesh: bpy.types.Object
) -> dict:
    """
    Re-key GargPelvis only on each action:
      - yaw so shoulder facing matches rest (Fix A)
      - pin pelvis XY to rest + shift Z so mesh min Z ≈ rest ground (Fix B)
    All other bone channels stay untouched (wings / limbs keep their motion).
    """
    clear_pose(arm)
    rest_fwd = flat_forward(arm)
    if rest_fwd is None:
        raise RuntimeError("could not measure rest facing")
    rest_pelvis_w = bone_world_matrix(arm, ROOT_BONE).translation.copy()
    rest_mn, _ = mesh_world_aabb(mesh)
    rest_min_z = rest_mn.z
    log(
        f"rest facing yaw={yaw_deg(rest_fwd):.1f} "
        f"pelvis={tuple(round(c, 4) for c in rest_pelvis_w)} minz={rest_min_z:.4f}"
    )

    report: dict = {"rest_yaw": round(yaw_deg(rest_fwd), 2), "actions": {}}
    pb = arm.pose.bones[ROOT_BONE]
    pb.rotation_mode = "QUATERNION"

    for name in KEEP:
        act = bpy.data.actions.get(name)
        if not act:
            raise RuntimeError(f"missing action {name}")
        f0, f1 = action_frame_range(act)
        mid = (f0 + f1) // 2
        log(f"rebake pelvis {name} frames {f0}-{f1}")

        play_action(arm, name, mid)
        pre_fwd = flat_forward(arm)
        pre_mn, pre_mx = mesh_world_aabb(mesh)
        pre = {
            "yaw": round(yaw_deg(pre_fwd), 2) if pre_fwd else None,
            "min_z": round(pre_mn.z, 4),
            "max_z": round(pre_mx.z, 4),
            "height": round((pre_mx - pre_mn).z, 4),
            "pelvis_z": round(bone_world_matrix(arm, ROOT_BONE).translation.z, 4),
        }

        # Evaluate original action → corrected pelvis loc/quat per frame
        corrected: list[tuple[int, Vector, Quaternion]] = []
        yaw_applied: list[float] = []
        minzs: list[float] = []
        for fr in range(f0, f1 + 1):
            play_action(arm, name, fr)

            fwd = flat_forward(arm)
            yaw = 0.0
            if fwd is not None:
                yaw = signed_yaw(fwd, rest_fwd)
                if abs(yaw) >= math.radians(0.25):
                    pw = bone_world_matrix(arm, ROOT_BONE)
                    origin = pw.translation
                    new_pw = (
                        Matrix.Translation(origin)
                        @ Matrix.Rotation(yaw, 4, "Z")
                        @ Matrix.Translation(-origin)
                        @ pw
                    )
                    set_pelvis_world(arm, new_pw)
            yaw_applied.append(math.degrees(yaw))

            bpy.context.view_layer.update()
            mn, _mx = mesh_world_aabb(mesh)
            pw = bone_world_matrix(arm, ROOT_BONE)
            delta = Vector(
                (
                    rest_pelvis_w.x - pw.translation.x,
                    rest_pelvis_w.y - pw.translation.y,
                    rest_min_z - mn.z,
                )
            )
            set_pelvis_world(arm, Matrix.Translation(delta) @ pw)
            bpy.context.view_layer.update()
            mn2, _ = mesh_world_aabb(mesh)
            minzs.append(mn2.z)
            corrected.append(
                (fr, pb.location.copy(), pb.rotation_quaternion.copy())
            )

        # Rewrite only pelvis loc/rot channels on this action
        _remove_pelvis_fcurves(act)
        play_action(arm, name, f0)  # keep action assigned
        for fr, loc, quat in corrected:
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.keyframe_insert(data_path="location", frame=fr)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=fr)

        play_action(arm, name, mid)
        post_fwd = flat_forward(arm)
        post_mn, post_mx = mesh_world_aabb(mesh)
        post = {
            "yaw": round(yaw_deg(post_fwd), 2) if post_fwd else None,
            "min_z": round(post_mn.z, 4),
            "max_z": round(post_mx.z, 4),
            "height": round((post_mx - post_mn).z, 4),
            "pelvis_z": round(bone_world_matrix(arm, ROOT_BONE).translation.z, 4),
            "yaw_correction_mean_deg": round(sum(yaw_applied) / len(yaw_applied), 2),
            "min_z_mean": round(sum(minzs) / len(minzs), 4),
            "min_z_max": round(max(minzs), 4),
        }
        report["actions"][name] = {"pre": pre, "post": post, "frames": [f0, f1]}
        log(
            f"  {name}: yaw {pre['yaw']}→{post['yaw']}  "
            f"minz {pre['min_z']}→{post['min_z']}  h {pre['height']}→{post['height']}"
        )

    clear_pose(arm)
    return report


def verify(arm: bpy.types.Object, mesh: bpy.types.Object, rest_fwd: Vector) -> dict:
    out = {}
    clear_pose(arm)
    rest_mn, rest_mx = mesh_world_aabb(mesh)
    out["rest"] = {
        "yaw": round(yaw_deg(rest_fwd), 2),
        "min_z": round(rest_mn.z, 4),
        "height": round((rest_mx - rest_mn).z, 4),
    }
    for name in ["FlyIdleLoop", "FlyForward", "Attack01", "Idle", "Walk"]:
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        mid = (f0 + f1) // 2
        samples = []
        for fr in (f0, mid, f1):
            play_action(arm, name, fr)
            fwd = flat_forward(arm)
            mn, mx = mesh_world_aabb(mesh)
            yaw_err = abs(math.degrees(signed_yaw(fwd, rest_fwd))) if fwd else 999
            samples.append(
                {
                    "frame": fr,
                    "yaw": round(yaw_deg(fwd), 2) if fwd else None,
                    "yaw_err_deg": round(yaw_err, 2),
                    "min_z": round(mn.z, 4),
                    "height": round((mx - mn).z, 4),
                    "center": [
                        round(0.5 * (mn.x + mx.x), 3),
                        round(0.5 * (mn.y + mx.y), 3),
                        round(0.5 * (mn.z + mx.z), 3),
                    ],
                }
            )
        heights = [s["height"] for s in samples]
        minzs = [s["min_z"] for s in samples]
        yaw_errs = [s["yaw_err_deg"] for s in samples]
        facing_ok = max(yaw_errs) < 25.0
        grounded_ok = max(abs(z) for z in minzs) < 0.35 and max(minzs) < 0.5
        stable = max(heights) / max(min(heights), 1e-3) < 1.8
        out[name] = {
            "samples": samples,
            "facing_ok": facing_ok,
            "grounded_ok": grounded_ok,
            "stable_size": stable,
            "max_yaw_err": round(max(yaw_errs), 2),
            "max_min_z": round(max(minzs), 4),
        }
        log(
            f"VERIFY {name}: facing={facing_ok} grounded={grounded_ok} "
            f"stable={stable} yaw_err={max(yaw_errs):.1f} max_minz={max(minzs):.3f}"
        )
    clear_pose(arm)
    return out


def export_glb(arm: bpy.types.Object, mesh: bpy.types.Object) -> float:
    # Purge donor / extra actions
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

    # Clip library
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
        if hasattr(arm.animation_data, "action_slot"):
            slots = list(getattr(arm.animation_data, "action_suitable_slots", []) or [])
            if slots:
                try:
                    arm.animation_data.action_slot = slots[0]
                except Exception:
                    pass
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
        log(f"  clip {out.name} {out.stat().st_size/1024:.1f} KB")
    mesh.hide_viewport = False
    mesh.hide_render = False
    restore_nla(arm)
    return mb


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"missing source {SRC}")
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    if OUT_BLEND.resolve() != SRC.resolve():
        shutil.copy2(SRC, OUT_BLEND)
        log(f"copied → {OUT_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    arm = bpy.data.objects.get(ARM_NAME)
    mesh = bpy.data.objects.get(MESH_NAME)
    if not arm or not mesh:
        raise SystemExit("expected ARM_GargoyleNative + SM_WingedMonkey_reskin")

    # Scale sanity
    log(
        f"scales mesh={tuple(round(c,4) for c in mesh.scale)} "
        f"arm={tuple(round(c,4) for c in arm.scale)} "
        f"mesh_local={tuple(round(c,4) for c in mesh.matrix_local.to_scale())}"
    )

    clear_pose(arm)
    head_idx, torso_idx = body_region_indices(mesh, arm)
    weights_before = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
    }
    log(f"weights before head={weights_before['head']} torso={weights_before['torso']}")

    # Fix C first (weights), then A+B (actions on stable mesh)
    log("=== Fix C: torso+head weights (wings locked) ===")
    weight_info = heat_bind_body_cage(mesh, arm)
    clear_pose(arm)
    head_idx, torso_idx = body_region_indices(mesh, arm)
    weights_after = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
    }
    log(f"weights after head={weights_after['head']} torso={weights_after['torso']}")

    log("=== Fix A+B: facing + grounded in-place root ===")
    action_report = fix_actions_facing_and_ground(arm, mesh)

    clear_pose(arm)
    rest_fwd = flat_forward(arm)
    assert rest_fwd is not None
    log("=== VERIFY ===")
    verify_report = verify(arm, mesh, rest_fwd)

    log("=== EXPORT ===")
    mb = export_glb(arm, mesh)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {
        "source": str(SRC.relative_to(ROOT)),
        "working": str(OUT_BLEND.relative_to(ROOT)),
        "glb": str(OUT_GLB.relative_to(ROOT)),
        "glb_mb": round(mb, 2),
        "weight_info": weight_info,
        "weights_before": weights_before,
        "weights_after": weights_after,
        "actions": action_report,
        "verify": verify_report,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2))
    lines = [
        "# Reskin polish — facing + ground + torso/head weights",
        "",
        f"- Source: `{report['source']}`",
        f"- Working: `{report['working']}`",
        f"- Studio GLB: `{report['glb']}` ({mb:.2f} MB, Draco off)",
        "",
        "## Weights (head / torso region share)",
        f"- Before head: {weights_before['head']}",
        f"- After head:  {weights_after['head']}",
        f"- Before torso: {weights_before['torso']}",
        f"- After torso:  {weights_after['torso']}",
        f"- Wing verts locked: {weight_info['wing_locked']}",
        "",
        "## Actions (pre → post mid-frame)",
    ]
    for n, d in action_report.get("actions", {}).items():
        p, q = d["pre"], d["post"]
        lines.append(
            f"- **{n}**: yaw {p['yaw']}→{q['yaw']}, min_z {p['min_z']}→{q['min_z']}, "
            f"h {p['height']}→{q['height']}"
        )
    lines.append("")
    lines.append("## Verify")
    for n in ["FlyIdleLoop", "FlyForward", "Attack01"]:
        v = verify_report[n]
        lines.append(
            f"- **{n}**: facing_ok={v['facing_ok']} grounded_ok={v['grounded_ok']} "
            f"stable={v['stable_size']} max_yaw_err={v['max_yaw_err']} "
            f"max_min_z={v['max_min_z']}"
        )
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")
    log("DONE")


if __name__ == "__main__":
    main()
