#!/usr/bin/env python3
"""
Part 2+3: bake −37.3° world-+X de-hunch into every clip, register 5 more
bought gargoyle clips, export Studio GLB + native_wip clip library.

- Working copy only; masters / wingext / feet_flyidle source untouched
- Edit-bone rest untouched; weights untouched
- New clips: FBX Take 001 slices → ARM_GargoyleNative (same as prior bake)
"""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_feet_flyidle.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_dehunch.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_dehunch_report.md"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_dehunch_report.json"
FBX = ROOT / (
    "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/"
    "Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)

ROOT_BONE = "GargPelvis"
DEHUNCH_DEG = -37.3

EXISTING = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]
# Unity FBX.meta slices @ 30fps — same source as gargoyle/_bake_summary.json
NEW_CLIPS: list[tuple[str, int, int]] = [
    ("IdleToFly", 1330, 1390),
    ("FlyToIdle", 1240, 1300),
    ("FlyAttack02", 1520, 1600),
    ("FlyHit", 1990, 2065),
    ("Hit", 800, 885),
]
ALL_CLIPS = EXISTING + [n for n, _, _ in NEW_CLIPS]


def log(msg: str) -> None:
    print(msg, flush=True)


def get_fcurves(action: bpy.types.Action) -> list:
    if hasattr(action, "fcurves") and action.fcurves:
        return list(action.fcurves)
    out = []
    for layer in getattr(action, "layers", []) or []:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []) or []:
                out.extend(cb.fcurves)
    return out


def action_frame_range(action: bpy.types.Action) -> tuple[int, int]:
    return int(action.frame_range[0]), int(action.frame_range[1])


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def play_action(arm: bpy.types.Object, name: str, frame: int) -> None:
    if not arm.animation_data:
        arm.animation_data_create()
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    act = bpy.data.actions[name]
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


def bone_world_matrix(arm: bpy.types.Object, name: str) -> Matrix:
    return arm.matrix_world @ arm.pose.bones[name].matrix


def set_pelvis_world(arm: bpy.types.Object, world_m: Matrix) -> None:
    pb = arm.pose.bones[ROOT_BONE]
    pb.matrix = arm.matrix_world.inverted() @ world_m
    bpy.context.view_layer.update()


def body_pitch_deg(arm: bpy.types.Object) -> float:
    pel = (arm.matrix_world @ arm.pose.bones["GargPelvis"].matrix).translation
    head = (arm.matrix_world @ arm.pose.bones["GargHead"].matrix).translation
    d = (head - pel).normalized()
    return math.degrees(math.atan2(-d.y, d.z))


def mesh_world_aabb(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        pts = [ev.matrix_world @ v.co for v in me.vertices]
        mn = Vector(
            (min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))
        )
        mx = Vector(
            (max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))
        )
        return mn, mx
    finally:
        ev.to_mesh_clear()


def flat_forward(arm: bpy.types.Object) -> Vector | None:
    """Shoulder cross product facing — same as fix_reskin_facing_ground_weights."""
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
    aa = Vector((a.x, a.y)).normalized()
    bb = Vector((b.x, b.y)).normalized()
    return math.atan2(aa.x * bb.y - aa.y * bb.x, aa.x * bb.x + aa.y * bb.y)


def yaw_deg(v: Vector) -> float:
    return math.degrees(math.atan2(v.x, v.y))


def snapshot_weights(mesh: bpy.types.Object) -> dict:
    """Compact fingerprint: top influence name per vert + total weight sum."""
    idx_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    tops: list[str] = []
    tot = 0.0
    for v in mesh.data.vertices:
        best_n, best_w = "", -1.0
        for g in v.groups:
            n = idx_to_name.get(g.group, "")
            tot += g.weight
            if g.weight > best_w:
                best_w = g.weight
                best_n = n
        tops.append(best_n)
    # region share for head/wing/foot keywords
    def share(pred):
        w = 0.0
        t = 0.0
        for v in mesh.data.vertices:
            for g in v.groups:
                n = idx_to_name.get(g.group, "")
                t += g.weight
                if pred(n):
                    w += g.weight
        return round(w / t, 4) if t else 0.0

    return {
        "n_verts": len(mesh.data.vertices),
        "weight_sum": round(tot, 3),
        "top_hash": hash(tuple(tops)),
        "wing_share": share(lambda n: "Wing" in n),
        "foot_share": share(lambda n: any(k in n for k in ("Ankle", "Toe", "Digit"))),
        "head_share": share(lambda n: any(k in n for k in ("Head", "Neck"))),
        "torso_share": share(
            lambda n: any(k in n for k in ("Pelvis", "Spine", "Ribcage"))
        ),
    }


def _remove_pelvis_fcurves(action: bpy.types.Action, loc: bool, rot: bool) -> None:
    needle = f'pose.bones["{ROOT_BONE}"]'
    for fc in list(get_fcurves(action)):
        if needle not in fc.data_path:
            continue
        if loc and "location" in fc.data_path:
            pass
        elif rot and "rotation" in fc.data_path:
            pass
        else:
            continue
        try:
            action.fcurves.remove(fc)
        except Exception:
            for layer in getattr(action, "layers", []) or []:
                for strip in layer.strips:
                    for cb in getattr(strip, "channelbags", []) or []:
                        if fc in list(cb.fcurves):
                            cb.fcurves.remove(fc)


def sample_native_pose(donor: bpy.types.Object, tgt: bpy.types.Object, frame: int) -> None:
    scene = bpy.context.scene
    scene.frame_set(int(frame))
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = donor.evaluated_get(deps)
    sx, sy, sz = donor.scale
    for pb in tgt.pose.bones:
        src = ev.pose.bones.get(pb.name)
        if src is None:
            continue
        loc, rot, sc = src.matrix_basis.decompose()
        loc = Vector((loc.x * sx, loc.y * sy, loc.z * sz))
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix.LocRotScale(loc, rot, sc)
    bpy.context.view_layer.update()


def keyframe_pose(arm: bpy.types.Object, frame: int) -> None:
    for pb in arm.pose.bones:
        pb.keyframe_insert(data_path="location", frame=frame)
        pb.rotation_mode = "QUATERNION"
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        pb.keyframe_insert(data_path="scale", frame=frame)


def linearize_action(action: bpy.types.Action) -> None:
    for fc in get_fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def ensure_donor(fbx: Path) -> bpy.types.Object:
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.fbx(
        filepath=str(fbx), automatic_bone_orientation=False, use_anim=True
    )
    donor = None
    for o in bpy.data.objects:
        if o.name in before:
            continue
        if o.type == "ARMATURE" and "GargPelvis" in o.data.bones:
            donor = o
            break
    if donor is None:
        raise RuntimeError("FBX donor armature not found")
    donor.name = "GargoyleAnimDonor"
    if not donor.animation_data:
        donor.animation_data_create()
    take = None
    for a in bpy.data.actions:
        if "Take 001" in a.name:
            take = a
            break
    if take is None:
        raise RuntimeError("Take 001 not found on FBX import")
    donor.animation_data.action = take
    if hasattr(donor.animation_data, "action_slot"):
        slots = list(getattr(donor.animation_data, "action_suitable_slots", []) or [])
        if slots:
            donor.animation_data.action_slot = slots[0]
    donor.hide_render = True
    log(f"donor={donor.name} scale={tuple(donor.scale)} take={take.name}")
    return donor


def bake_clip(
    donor: bpy.types.Object, tgt: bpy.types.Object, name: str, f0: int, f1: int
) -> dict:
    if not tgt.animation_data:
        tgt.animation_data_create()
    tgt.animation_data.action = None
    for track in tgt.animation_data.nla_tracks:
        track.mute = True
    clear_pose(tgt)

    # Drop prior action with same name
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)

    sample_native_pose(donor, tgt, f0)
    keyframe_pose(tgt, 1)
    action = tgt.animation_data.action
    if action is None:
        raise RuntimeError(f"failed to create action {name}")
    action.name = name
    if hasattr(tgt.animation_data, "action_slot"):
        slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
        if slots:
            tgt.animation_data.action_slot = slots[0]

    local = 1
    for src_f in range(f0, f1 + 1):
        sample_native_pose(donor, tgt, src_f)
        keyframe_pose(tgt, local)
        local += 1
    linearize_action(action)
    n = f1 - f0 + 1
    tgt.animation_data.action = None
    clear_pose(tgt)
    log(f"baked {name}: donor {f0}-{f1} → 1-{n}")
    return {"name": name, "donor_start": f0, "donor_end": f1, "local_frames": n}


def fix_facing_ground(
    arm: bpy.types.Object, mesh: bpy.types.Object, names: list[str]
) -> dict:
    clear_pose(arm)
    rest_fwd = flat_forward(arm)
    if rest_fwd is None:
        raise RuntimeError("rest facing unavailable")
    rest_pelvis_w = bone_world_matrix(arm, ROOT_BONE).translation.copy()
    rest_mn, _ = mesh_world_aabb(mesh)
    rest_min_z = rest_mn.z
    pb = arm.pose.bones[ROOT_BONE]
    pb.rotation_mode = "QUATERNION"
    report: dict = {}

    for name in names:
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        corrected: list[tuple[int, Vector, Quaternion]] = []
        for fr in range(f0, f1 + 1):
            play_action(arm, name, fr)
            fwd = flat_forward(arm)
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
            bpy.context.view_layer.update()
            mn, _ = mesh_world_aabb(mesh)
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
            corrected.append((fr, pb.location.copy(), pb.rotation_quaternion.copy()))

        _remove_pelvis_fcurves(act, loc=True, rot=True)
        play_action(arm, name, f0)
        for fr, loc, quat in corrected:
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.keyframe_insert(data_path="location", frame=fr)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=fr)

        play_action(arm, name, (f0 + f1) // 2)
        post_fwd = flat_forward(arm)
        mn, mx = mesh_world_aabb(mesh)
        report[name] = {
            "yaw": round(yaw_deg(post_fwd), 2) if post_fwd else None,
            "min_z": round(mn.z, 4),
            "height": round((mx - mn).z, 4),
            "pitch": round(body_pitch_deg(arm), 2),
        }
        log(
            f"facing/ground {name}: yaw={report[name]['yaw']} "
            f"minz={report[name]['min_z']} pitch={report[name]['pitch']}"
        )
    clear_pose(arm)
    return report


def bake_dehunch_all(
    arm: bpy.types.Object, mesh: bpy.types.Object, names: list[str], delta_deg: float
) -> dict:
    """Compose constant world-+X pitch onto pelvis; re-ground mesh min Z."""
    clear_pose(arm)
    rest_mn, _ = mesh_world_aabb(mesh)
    rest_min_z = rest_mn.z
    rest_pelvis_xy = bone_world_matrix(arm, ROOT_BONE).translation.copy()
    delta = math.radians(delta_deg)
    pb = arm.pose.bones[ROOT_BONE]
    pb.rotation_mode = "QUATERNION"
    pre_post: dict = {}

    for name in names:
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        mid = (f0 + f1) // 2
        play_action(arm, name, mid)
        pre = body_pitch_deg(arm)

        corrected: list[tuple[int, Vector, Quaternion]] = []
        for fr in range(f0, f1 + 1):
            play_action(arm, name, fr)
            pw = bone_world_matrix(arm, ROOT_BONE)
            origin = pw.translation
            new_pw = (
                Matrix.Translation(origin)
                @ Matrix.Rotation(delta, 4, "X")
                @ Matrix.Translation(-origin)
                @ pw
            )
            set_pelvis_world(arm, new_pw)
            bpy.context.view_layer.update()
            # Re-ground + pin XY to rest (preserve grounded root)
            mn, _ = mesh_world_aabb(mesh)
            pw2 = bone_world_matrix(arm, ROOT_BONE)
            delta_t = Vector(
                (
                    rest_pelvis_xy.x - pw2.translation.x,
                    rest_pelvis_xy.y - pw2.translation.y,
                    rest_min_z - mn.z,
                )
            )
            set_pelvis_world(arm, Matrix.Translation(delta_t) @ pw2)
            bpy.context.view_layer.update()
            corrected.append((fr, pb.location.copy(), pb.rotation_quaternion.copy()))

        _remove_pelvis_fcurves(act, loc=True, rot=True)
        play_action(arm, name, f0)
        for fr, loc, quat in corrected:
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.keyframe_insert(data_path="location", frame=fr)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=fr)

        play_action(arm, name, mid)
        post = body_pitch_deg(arm)
        mn, mx = mesh_world_aabb(mesh)
        pre_post[name] = {
            "pre": round(pre, 2),
            "post": round(post, 2),
            "min_z": round(mn.z, 4),
            "height": round((mx - mn).z, 4),
        }
        log(f"dehunch {name}: {pre:.1f}°→{post:.1f}°  minz={mn.z:.4f}")

    clear_pose(arm)
    return pre_post


def stash_nla(arm: bpy.types.Object, names: list[str]) -> None:
    if not arm.animation_data:
        arm.animation_data_create()
    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    arm.animation_data.action = None
    cursor = 1
    for name in names:
        act = bpy.data.actions.get(name)
        if act is None:
            raise RuntimeError(f"missing action {name}")
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
        log(f"NLA {name} → {cursor - 2}")


def export_all(arm: bpy.types.Object, mesh: bpy.types.Object, names: list[str]) -> None:
    # Purge donor + stray actions
    donor = bpy.data.objects.get("GargoyleAnimDonor")
    if donor:
        bpy.data.objects.remove(donor, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.startswith("Gargoyle_"):
            bpy.data.objects.remove(o, do_unlink=True)
    keep = set(names)
    for act in list(bpy.data.actions):
        if act.name not in keep:
            try:
                bpy.data.actions.remove(act)
            except Exception:
                pass

    stash_nla(arm, names)

    bpy.ops.object.select_all(action="DESELECT")
    mesh.hide_viewport = False
    arm.hide_viewport = False
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
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
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if "export_animation_mode" in props:
        kwargs["export_animation_mode"] = "NLA_TRACKS"
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"exported {OUT_GLB} ({OUT_GLB.stat().st_size / 1024 / 1024:.2f} MB)")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    for p in CLIP_DIR.glob("*.glb"):
        p.unlink()
    mesh.hide_viewport = True
    mesh.hide_render = True
    for name in names:
        act = bpy.data.actions[name]
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
        if "export_animation_mode" in props:
            ck["export_animation_mode"] = "ACTIVE_ACTIONS"
        bpy.ops.export_scene.gltf(**ck)
        log(f"clip {out.name} ({out.stat().st_size / 1024:.1f} KB)")

    mesh.hide_viewport = False
    mesh.hide_render = False
    stash_nla(arm, names)


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"missing source {SRC}")
    if not FBX.exists():
        raise SystemExit(f"missing FBX {FBX}")

    shutil.copy2(SRC, OUT_BLEND)
    log(f"copied → {OUT_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    arm = bpy.data.objects["ARM_GargoyleNative"]
    mesh = bpy.data.objects["SM_WingedMonkey_reskin"]
    bpy.context.scene.render.fps = 30

    w_before = snapshot_weights(mesh)
    log(f"weights before: {w_before}")

    # Pitch table before
    pitches_before = {}
    for name in EXISTING:
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        play_action(arm, name, (f0 + f1) // 2)
        pitches_before[name] = round(body_pitch_deg(arm), 2)
    log(f"pitches before: {pitches_before}")

    # Part 3: bake new clips from FBX
    log("=== Part 3: bake 5 new clips from FBX ===")
    donor = ensure_donor(FBX)
    new_infos = []
    for name, f0, f1 in NEW_CLIPS:
        new_infos.append(bake_clip(donor, arm, name, f0, f1))

    log("=== facing/ground new clips ===")
    facing_new = fix_facing_ground(arm, mesh, [n for n, _, _ in NEW_CLIPS])

    # Part 2: de-hunch ALL clips
    log(f"=== Part 2: de-hunch {DEHUNCH_DEG}° into all {len(ALL_CLIPS)} clips ===")
    dehunch = bake_dehunch_all(arm, mesh, ALL_CLIPS, DEHUNCH_DEG)

    # Verify pitches
    pitches_after = {}
    for name in ALL_CLIPS:
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        play_action(arm, name, (f0 + f1) // 2)
        pitches_after[name] = round(body_pitch_deg(arm), 2)

    idle_p = pitches_after["Idle"]
    flyi_p = pitches_after["FlyIdleLoop"]
    flyf_p = pitches_after["FlyForward"]
    gap = round(flyf_p - flyi_p, 2)
    idle_ok = abs(idle_p) <= 5.0
    hover_ok = abs(flyi_p) <= 12.0
    dive_ok = flyf_p >= 8.0
    gap_ok = 15.0 <= gap <= 35.0
    log(
        f"verify Idle={idle_p} FlyIdle={flyi_p} FlyFwd={flyf_p} gap={gap} "
        f"idle_ok={idle_ok} hover_ok={hover_ok} dive_ok={dive_ok} gap_ok={gap_ok}"
    )
    if not (idle_ok and hover_ok and dive_ok and gap_ok):
        raise RuntimeError(
            f"pitch table failed: Idle={idle_p} FlyIdle={flyi_p} "
            f"FlyFwd={flyf_p} gap={gap}"
        )

    w_after = snapshot_weights(mesh)
    weights_ok = (
        w_before["n_verts"] == w_after["n_verts"]
        and w_before["top_hash"] == w_after["top_hash"]
        and w_before["wing_share"] == w_after["wing_share"]
        and w_before["foot_share"] == w_after["foot_share"]
        and w_before["head_share"] == w_after["head_share"]
        and w_before["torso_share"] == w_after["torso_share"]
    )
    log(f"weights after: {w_after} unchanged={weights_ok}")
    if not weights_ok:
        raise RuntimeError("weights changed — aborting export")

    # Measure height still ~1.3m
    clear_pose(arm)
    mn, mx = mesh_world_aabb(mesh)
    height = (mx - mn).z
    log(f"rest height={height:.3f}m")

    log("=== EXPORT ===")
    export_all(arm, mesh, ALL_CLIPS)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {
        "source": str(SRC.relative_to(ROOT)),
        "working": str(OUT_BLEND.relative_to(ROOT)),
        "glb": str(OUT_GLB.relative_to(ROOT)),
        "dehunch_deg": DEHUNCH_DEG,
        "pitches_before": pitches_before,
        "pitches_after": pitches_after,
        "gap_flyfwd_minus_flyidle": gap,
        "facing_new": facing_new,
        "dehunch": dehunch,
        "new_clips": new_infos,
        "weights_before": w_before,
        "weights_after": w_after,
        "weights_unchanged": weights_ok,
        "rest_height_m": round(height, 4),
        "verify": {
            "idle_upright": idle_ok,
            "flyidle_level": hover_ok,
            "flyfwd_pitched": dive_ok,
            "hover_dive_gap_ok": gap_ok,
        },
    }
    OUT_JSON.write_text(json.dumps(report, indent=2))
    lines = [
        "# Reskin — de-hunch (−37.3°) + 5 extra clips",
        "",
        f"- Source: `{report['source']}`",
        f"- Working: `{report['working']}`",
        f"- GLB: `{report['glb']}` ({OUT_GLB.stat().st_size / 1024 / 1024:.2f} MB)",
        "",
        "## Pitch (mid-frame)",
        f"- Before (existing 5): `{pitches_before}`",
        f"- After (all 10): `{pitches_after}`",
        f"- FlyFwd − FlyIdle gap: **{gap}°** (target ~23°)",
        "",
        "## Verify",
        f"- Idle upright (~0°): {idle_ok} ({idle_p}°)",
        f"- Fly Idle level hover: {hover_ok} ({flyi_p}°)",
        f"- Fly Forward still pitched: {dive_ok} ({flyf_p}°)",
        f"- Hover-vs-dive gap: {gap_ok} ({gap}°)",
        f"- Weights unchanged: {weights_ok}",
        f"- Rest height: {height:.3f} m",
        "",
        "## New clips",
    ]
    for info in new_infos:
        lines.append(
            f"- **{info['name']}**: donor {info['donor_start']}-{info['donor_end']} "
            f"→ {info['local_frames']} frames"
        )
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")
    log("DONE")


if __name__ == "__main__":
    main()
