#!/usr/bin/env python3
"""
Extend reskin monkey wing bones to membrane wingtips (wings only).

Adds GargLWing3/4 + GargRWing3/4 parented to the Wing2 chain with standard FK
inherit (no new action keys — clips drive Wing2, children follow). Re-weights
only lateral wing-membrane verts; torso/head/body weights are frozen.

Source: Monkey_reskin_gargoyle_polished.blend (untouched copy first).

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/extend_reskin_wingtips.py
"""
from __future__ import annotations

import json
import math
import re
import shutil
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_polished.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_wingext.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_wingext_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_wingext_report.md"

KEEP = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]
ARM_NAME = "ARM_GargoyleNative"
MESH_NAME = "SM_WingedMonkey_reskin"

WING2 = {"L": "GargLWing2", "R": "GargRWing2"}
WING3 = {"L": "GargLWing3", "R": "GargRWing3"}
WING4 = {"L": "GargLWing4", "R": "GargRWing4"}
WING_CHAIN = {
    "L": ["GargLWing2", "GargLWing3", "GargLWing4"],
    "R": ["GargRWing2", "GargRWing3", "GargRWing4"],
}

WING_RE = re.compile(r"Wing", re.I)
HEAD_RE = re.compile(r"(Head|Jaw|Neck|Brow|Eye|Lid|Tongue)", re.I)
TORSO_RE = re.compile(r"(Pelvis|Spine|Rib|Tail)", re.I)


def log(msg: str) -> None:
    print(msg, flush=True)


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


def snapshot_weights(mesh: bpy.types.Object) -> list[list[tuple[str, float]]]:
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    out: list[list[tuple[str, float]]] = []
    for v in mesh.data.vertices:
        out.append([(idx_to_name[g.group], g.weight) for g in v.groups if g.group in idx_to_name])
    return out


def body_region_indices(mesh: bpy.types.Object, arm: bpy.types.Object) -> tuple[set[int], set[int]]:
    """Head + torso core verts — never reweight."""
    arm_inv = arm.matrix_world.inverted()
    locals_ = [arm_inv @ (mesh.matrix_world @ v.co) for v in mesh.data.vertices]
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


def wing_membrane_tip(
    mesh: bpy.types.Object, arm: bpy.types.Object, side: str, w2_name: str
) -> Vector:
    """Farthest membrane point from Wing2 tail in armature-local space."""
    arm_inv = arm.matrix_world.inverted()
    w2 = arm.data.bones[w2_name]
    w2_tail = arm_inv @ (arm.matrix_world @ w2.tail_local)
    w2_head = arm_inv @ (arm.matrix_world @ w2.head_local)
    sign = 1.0 if side == "L" else -1.0
    zs = []
    locals_ = []
    for v in mesh.data.vertices:
        p = arm_inv @ (mesh.matrix_world @ v.co)
        locals_.append(p)
        zs.append(p.z)
    zmin, zmax = min(zs), max(zs)
    zspan = zmax - zmin or 1.0

    best: Vector | None = None
    best_score = -1.0
    for i, p in enumerate(locals_):
        if sign * p.x < 0.12:
            continue
        if p.z > zmin + 0.92 * zspan and abs(p.y) > 0.18:
            continue  # digit feathers
        if (p - w2_tail).length < 0.06:
            continue
        lateral = abs(p.x) - abs(w2_head.x)
        if lateral < 0.02:
            continue
        score = (p - w2_tail).length + 0.25 * lateral
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        raise RuntimeError(f"no wing membrane tip for {side}")
    return best


def align_roll_like(eb_child, eb_parent) -> None:
    axis = (eb_child.tail - eb_child.head).normalized()
    if axis.length < 1e-8:
        return
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


def extend_wing_bones(arm: bpy.types.Object, mesh: bpy.types.Object) -> dict:
    """Add Wing3/Wing4 on both sides; parented for FK inherit (glTF-safe)."""
    clear_pose(arm)
    report: dict = {"sides": {}}

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    for side in ("L", "R"):
        w2n = WING2[side]
        w3n = WING3[side]
        w4n = WING4[side]
        if w2n not in eb:
            raise RuntimeError(f"missing {w2n}")

        tip = wing_membrane_tip(mesh, arm, side, w2n)
        w2 = eb[w2n]
        start = w2.tail.copy()
        mid = start.lerp(tip, 0.55)
        end = tip.copy()

        for name in (w3n, w4n):
            if name in eb:
                eb.remove(eb[name])

        b3 = eb.new(w3n)
        b3.parent = w2
        b3.use_connect = False
        b3.use_inherit_rotation = True
        b3.use_local_location = True
        b3.head = start.copy()
        b3.tail = mid.copy()
        if (b3.tail - b3.head).length < 1e-4:
            b3.tail = b3.head + Vector((0.05 if side == "L" else -0.05, 0, 0))
        align_roll_like(b3, w2)

        b4 = eb.new(w4n)
        b4.parent = b3
        b4.use_connect = True
        b4.use_inherit_rotation = True
        b4.use_local_location = True
        b4.head = mid.copy()
        b4.tail = end.copy()
        if (b4.tail - b4.head).length < 1e-4:
            b4.tail = b4.head + (b3.tail - b3.head).normalized() * 0.05
        align_roll_like(b4, b3)

        for b in (b3, b4):
            b.use_deform = True

        span = (end - start).length
        report["sides"][side] = {
            "w2_tail": [round(c, 4) for c in start],
            "w4_tip": [round(c, 4) for c in end],
            "span_added": round(span, 4),
            "bones": [w3n, w4n],
        }
        log(
            f"{side} wing +{span:.3f}m  {w3n}/{w4n}  "
            f"tip {[round(c,3) for c in end]}"
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


def bone_segments_arm_local(arm: bpy.types.Object, names: list[str]) -> list[tuple[str, Vector, Vector]]:
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


def membrane_vert_indices(
    mesh: bpy.types.Object, arm: bpy.types.Object, side: str, w2_name: str
) -> list[int]:
    arm_inv = arm.matrix_world.inverted()
    w2 = arm.data.bones[w2_name]
    w2_tail = arm_inv @ (arm.matrix_world @ w2.tail_local)
    sign = 1.0 if side == "L" else -1.0
    zs = []
    locals_ = []
    for v in mesh.data.vertices:
        p = arm_inv @ (mesh.matrix_world @ v.co)
        locals_.append(p)
        zs.append(p.z)
    zmin, zmax = min(zs), max(zs)
    zspan = zmax - zmin or 1.0
    out = []
    for i, p in enumerate(locals_):
        if sign * p.x < 0.12:
            continue
        if p.z > zmin + 0.92 * zspan and abs(p.y) > 0.18:
            continue
        if (p - w2_tail).length < 0.04:
            continue
        out.append(i)
    return out


def reweight_wing_membrane(
    mesh: bpy.types.Object, arm: bpy.types.Object, frozen: set[int], old_weights: list
) -> dict:
    """Assign membrane verts to Wing2/3/4 only; restore frozen verts exactly."""
    clear_pose(arm)
    chain_names = []
    for side in ("L", "R"):
        chain_names.extend(WING_CHAIN[side])
    groups = {vg.name: vg for vg in mesh.vertex_groups}
    for n in chain_names:
        if n not in groups:
            mesh.vertex_groups.new(name=n)
    groups = {vg.name: vg for vg in mesh.vertex_groups}

    touched = 0
    for side in ("L", "R"):
        idxs = membrane_vert_indices(mesh, arm, side, WING2[side])
        idxs = [i for i in idxs if i not in frozen]
        segs = bone_segments_arm_local(arm, WING_CHAIN[side])
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

    # Restore frozen body/head exactly
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

    # Light smooth on membrane only
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    for v in mesh.data.vertices:
        v.select = False
    for side in ("L", "R"):
        for i in membrane_vert_indices(mesh, arm, side, WING2[side]):
            if i not in frozen:
                mesh.data.vertices[i].select = True
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        bpy.ops.object.vertex_group_smooth(factor=0.1, repeat=1, expand=0.0)
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01, keep_single=True)
    except Exception as e:
        log(f"smooth warn: {e}")
    bpy.ops.object.mode_set(mode="OBJECT")

    # Re-freeze body after smooth bleed
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

    return {"membrane_reweighted": touched}


def region_weight_share(mesh: bpy.types.Object, idxs: set[int]) -> dict:
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


def wing_tip_weight_share(mesh: bpy.types.Object, arm: bpy.types.Object, side: str) -> dict:
    idxs = membrane_vert_indices(mesh, arm, side, WING2[side])
    if not idxs:
        return {}
    arm_inv = arm.matrix_world.inverted()
    w2_tail = arm_inv @ (arm.matrix_world @ arm.data.bones[WING2[side]].tail_local)
    tips = sorted(idxs, key=lambda i: (arm_inv @ (mesh.matrix_world @ mesh.data.vertices[i].co) - w2_tail).length, reverse=True)[:120]
    return region_weight_share(mesh, set(tips))


def bone_world_quat(arm: bpy.types.Object, name: str) -> Vector:
    pb = arm.pose.bones[name]
    q = (arm.matrix_world @ pb.matrix).to_quaternion()
    return Vector((q.w, q.x, q.y, q.z))


def verify_wing_ext(arm: bpy.types.Object, mesh: bpy.types.Object) -> dict:
    clear_pose(arm)
    rest_fwd = None  # body check via height only
    head_idx, torso_idx = body_region_indices(mesh, arm)
    body_share = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
    }

    def tip_spread_metric(action: str, frames: list[int]) -> dict:
        """Max/min cluster radius on lateral tip verts — 1.0 = no stretch."""
        spreads = []
        w4_travel = []
        w2_travel = []
        clear_pose(arm)
        w2_rest = (arm.matrix_world @ arm.pose.bones[WING2["L"]].matrix).translation.copy()
        w4_rest = (arm.matrix_world @ arm.pose.bones[WING4["L"]].matrix).translation.copy()

        def cluster_spread(side: str) -> float:
            arm_inv = arm.matrix_world.inverted()
            idxs = sorted(
                [
                    i
                    for i, v in enumerate(mesh.data.vertices)
                    if (1 if side == "L" else -1) * (arm_inv @ (mesh.matrix_world @ v.co)).x > 0.22
                ]
            )[:60]
            deps = bpy.context.evaluated_depsgraph_get()
            ev = mesh.evaluated_get(deps)
            me = ev.to_mesh()
            try:
                pts = [ev.matrix_world @ me.vertices[i].co for i in idxs]
                c = sum(pts, Vector()) / len(pts)
                return max((p - c).length for p in pts)
            finally:
                ev.to_mesh_clear()

        for fr in frames:
            play_action(arm, action, fr)
            spreads.append(0.5 * (cluster_spread("L") + cluster_spread("R")))
            w2_travel.append(
                ((arm.matrix_world @ arm.pose.bones[WING2["L"]].matrix).translation - w2_rest).length
            )
            w4_travel.append(
                ((arm.matrix_world @ arm.pose.bones[WING4["L"]].matrix).translation - w4_rest).length
            )

        mn, mx = min(spreads), max(spreads)
        return {
            "spread_ratio": round(mx / max(mn, 1e-6), 3),
            "spread_min": round(mn, 4),
            "spread_max": round(mx, 4),
            "w2_tail_travel_max": round(max(w2_travel), 4),
            "w4_tail_travel_max": round(max(w4_travel), 4),
            "w4_tracks_w2": round(max(w4_travel) / max(max(w2_travel), 1e-6), 3),
        }

    out = {"body": body_share, "clips": {}, "wing_tip_weights": {}}
    for side in ("L", "R"):
        out["wing_tip_weights"][side] = wing_tip_weight_share(mesh, arm, side)

    # inherit flap: new tip bones move when Wing2 is animated (no keys on Wing3/4)
    fly_frames = [1, 8, 16, 24, 31]
    fly_metric = tip_spread_metric("FlyIdleLoop", fly_frames)
    out["inherit_flap"] = {
        "w2_tail_travel": fly_metric["w2_tail_travel_max"],
        "w4_tail_travel": fly_metric["w4_tail_travel_max"],
        "w4_tracks_w2": fly_metric["w4_tracks_w2"],
        "pass": fly_metric["w4_tail_travel_max"] > 0.05
        and fly_metric["w4_tracks_w2"] > 0.25,
    }

    for clip in ["FlyIdleLoop", "FlyForward", "Attack01"]:
        act = bpy.data.actions[clip]
        f1 = int(act.frame_range[0])
        fmid = int((act.frame_range[0] + act.frame_range[1]) / 2)
        fend = int(act.frame_range[1])
        out["clips"][clip] = tip_spread_metric(clip, [f1, fmid, fend])

    clear_pose(arm)
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
    frozen = head_idx | torso_idx
    old_weights = snapshot_weights(mesh)
    before = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
        "L_tip": wing_tip_weight_share(mesh, arm, "L"),
        "R_tip": wing_tip_weight_share(mesh, arm, "R"),
    }
    log(f"before body head={before['head']} torso={before['torso']}")
    log(f"before tip L={before['L_tip']} R={before['R_tip']}")

    log("=== extend wing bones ===")
    bone_report = extend_wing_bones(arm, mesh)

    log("=== reweight wing membrane only ===")
    weight_report = reweight_wing_membrane(mesh, arm, frozen, old_weights)
    after = {
        "head": region_weight_share(mesh, head_idx),
        "torso": region_weight_share(mesh, torso_idx),
        "L_tip": wing_tip_weight_share(mesh, arm, "L"),
        "R_tip": wing_tip_weight_share(mesh, arm, "R"),
    }
    log(f"after body head={after['head']} torso={after['torso']}")
    log(f"after tip L={after['L_tip']} R={after['R_tip']}")

    log("=== verify ===")
    verify = verify_wing_ext(arm, mesh)
    log(f"inherit_flap {verify['inherit_flap']}")
    for clip, v in verify["clips"].items():
        log(
            f"  {clip} spread_ratio={v.get('spread_ratio')} "
            f"w4_travel={v.get('w4_tail_travel_max')}"
        )

    log("=== export ===")
    mb = export_glb(arm, mesh)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {
        "source": str(SRC.relative_to(ROOT)),
        "working": str(OUT_BLEND.relative_to(ROOT)),
        "glb": str(OUT_GLB.relative_to(ROOT)),
        "glb_mb": round(mb, 2),
        "bones": bone_report,
        "weights": {"before": before, "after": after, **weight_report},
        "verify": verify,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2))
    lines = [
        "# Reskin wing extension",
        "",
        f"- Source: `{report['source']}`",
        f"- Working: `{report['working']}`",
        f"- GLB: `{report['glb']}` ({mb:.2f} MB)",
        "",
        "## Tip weights (wing share)",
        f"- Before L: {before['L_tip']}",
        f"- After L:  {after['L_tip']}",
        f"- Before R: {before['R_tip']}",
        f"- After R:  {after['R_tip']}",
        "",
        "## Body (unchanged)",
        f"- Head before/after: {before['head']} / {after['head']}",
        f"- Torso before/after: {before['torso']} / {after['torso']}",
        "",
        "## Verify",
        f"- Inherit flap: {verify['inherit_flap']}",
    ]
    for clip in ["FlyIdleLoop", "FlyForward", "Attack01"]:
        v = verify["clips"][clip]
        lines.append(
            f"- **{clip}** spread_ratio={v.get('spread_ratio')} "
            f"(1.0 = no tip stretch), w4_travel={v.get('w4_tail_travel_max')}"
        )
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")
    log("DONE")


if __name__ == "__main__":
    main()
