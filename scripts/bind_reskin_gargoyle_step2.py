#!/usr/bin/env python3
"""
Step 2 — Bind monkey mesh to fitted gargoyle armature + verify native clips.

- Opens Step-1 working blend (copy path)
- Removes old 21-bone armature association
- Parents with automatic weights + light normalize/smooth
- Plays native FBX Take 001 clips (Idle/Walk/Fly/Attack) via local pose copy — no retarget
- Renders preview frames + writes region deform report
- Does NOT hand-paint; does NOT re-fit bones
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
FIT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_fit.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_bound.blend"
FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
PREV = ROOT / "models/wingedmonkey/working/step2_previews"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_bind_step2_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_bind_step2_report.md"

# Unity FBX.meta clip slices (Take 001 @ 30fps) — native, not retargeted
VERIFY_CLIPS: list[tuple[str, int, int]] = [
    ("Idle", 80, 190),
    ("Walk", 360, 390),
    ("FlyIdleLoop", 1305, 1335),
    ("FlyForward", 1180, 1210),
    ("Attack01", 410, 470),
]

REGION_BONES: dict[str, list[str]] = {
    "torso": ["GargPelvis", "GargSpine1", "GargSpine2", "GargSpine3", "GargRibcage"],
    "head": ["GargNeck1", "GargNeck2", "GargHead"],
    "arms": [
        "GargLArmCollarbone",
        "GargLArmUpperarm1",
        "GargLArmForearm1",
        "GargLArmPalm",
        "GargRCollarbone",
        "GargRUpperarm1",
        "GargRForearm1",
        "GargRPalm",
    ],
    "hands": ["GargLArmPalm", "GargRPalm"],
    "legs": [
        "GargLLegThigh1",
        "GargLLegCalf1",
        "GargLLegAnkle",
        "GargRThigh1",
        "GargRCalf1",
        "GargRAnkle",
    ],
    "wings": [
        "GargLWingWCollarbone",
        "GargLWing1",
        "GargLWing2",
        "GargRWingWCollarbone",
        "GargRWing1",
        "GargRWing2",
    ],
}


def log(msg: str) -> None:
    print(msg, flush=True)


def find_garg_arm() -> bpy.types.Object:
    for o in bpy.data.objects:
        if o.type != "ARMATURE":
            continue
        if "GargPelvis" in o.data.bones and "GargLWing1" in o.data.bones and len(o.data.bones) > 50:
            return o
    raise RuntimeError("Fitted gargoyle armature not found")


def find_mesh() -> bpy.types.Object:
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("No mesh in blend")
    return max(meshes, key=lambda o: len(o.data.vertices))


def find_old_monkey_arm(mesh: bpy.types.Object, garg: bpy.types.Object) -> bpy.types.Object | None:
    cands = []
    for o in bpy.data.objects:
        if o.type != "ARMATURE" or o == garg:
            continue
        n = len(o.data.bones)
        if n <= 30 or "GargoyleMonkey" in o.name or o.name.startswith("Gargoyle"):
            cands.append(o)
    # Prefer armature currently deforming the mesh
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE" and mod.object and mod.object != garg:
            return mod.object
    if mesh.parent and mesh.parent.type == "ARMATURE" and mesh.parent != garg:
        return mesh.parent
    return cands[0] if cands else None


def clear_old_skin(mesh: bpy.types.Object, garg: bpy.types.Object) -> dict:
    info = {"removed_mods": [], "cleared_vgroups": 0, "unparented_from": None}
    # Identify old armature BEFORE stripping parent/mods
    old = find_old_monkey_arm(mesh, garg)
    if old is not None:
        info["old_armature"] = old.name
        info["old_bone_count"] = len(old.data.bones)
    else:
        info["old_armature"] = None
    # Remove armature modifiers (we'll re-add via parent_set)
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            info["removed_mods"].append(mod.object.name if mod.object else mod.name)
            mesh.modifiers.remove(mod)
    if mesh.parent is not None:
        info["unparented_from"] = mesh.parent.name
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
    # Clear ALL vertex groups (old 21-bone + any leftovers)
    info["cleared_vgroups"] = len(mesh.vertex_groups)
    mesh.vertex_groups.clear()
    if old is not None and old.name in bpy.data.objects:
        bpy.data.objects.remove(old, do_unlink=True)
    # Remove any other non-garg armatures
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE" and o != garg:
            bpy.data.objects.remove(o, do_unlink=True)
    return info


def bind_auto(mesh: bpy.types.Object, garg: bpy.types.Object) -> dict:
    """Bind with distance-to-bone weights.

    Blender heat-map automatic weights finish but assign nothing on this mesh
    (common with dense/non-manifold Tripo topology). Distance skinning is the
    reliable fallback and matches game-reskin practice.
    """
    import numpy as np
    import time

    t0 = time.time()
    bpy.ops.object.mode_set(mode="OBJECT")
    # Clear any leftover groups/mods
    mesh.vertex_groups.clear()
    for m in list(mesh.modifiers):
        if m.type == "ARMATURE":
            mesh.modifiers.remove(m)
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = mw

    bones = [b for b in garg.data.bones if b.use_deform]
    # World-space bone segments
    heads = np.zeros((len(bones), 3), dtype=np.float64)
    tails = np.zeros((len(bones), 3), dtype=np.float64)
    names = []
    for i, b in enumerate(bones):
        names.append(b.name)
        h = garg.matrix_world @ b.head_local
        t = garg.matrix_world @ b.tail_local
        heads[i] = (h.x, h.y, h.z)
        tails[i] = (t.x, t.y, t.z)
    dirs = tails - heads
    len2 = np.sum(dirs * dirs, axis=1)
    len2 = np.maximum(len2, 1e-12)

    # Vertex world positions
    nverts = len(mesh.data.vertices)
    co = np.zeros(nverts * 3, dtype=np.float64)
    mesh.data.vertices.foreach_get("co", co)
    co = co.reshape(nverts, 3)
    # Apply mesh world matrix
    M = np.array(mesh.matrix_world, dtype=np.float64)
    ones = np.ones((nverts, 1), dtype=np.float64)
    homog = np.concatenate([co, ones], axis=1)
    world = (homog @ M.T)[:, :3]

    # Character-scale falloff: ~6cm sigma, keep influences within ~20cm
    sigma = 0.06
    radius = 0.22
    max_inf = 4

    # Create groups
    for n in names:
        mesh.vertex_groups.new(name=n)

    assigned = 0
    batch = 4000
    for start in range(0, nverts, batch):
        end = min(nverts, start + batch)
        pts = world[start:end]  # (B,3)
        # dist to each bone segment: (B, Nbones)
        # u = clamp(dot(P-H, D) / |D|^2, 0, 1)
        ph = pts[:, None, :] - heads[None, :, :]  # (B,N,3)
        u = np.sum(ph * dirs[None, :, :], axis=2) / len2[None, :]
        u = np.clip(u, 0.0, 1.0)
        closest = heads[None, :, :] + dirs[None, :, :] * u[:, :, None]
        dist = np.linalg.norm(pts[:, None, :] - closest, axis=2)
        # Soft weights
        w = np.exp(-(dist * dist) / (2.0 * sigma * sigma))
        w[dist > radius] = 0.0
        # Top-K
        for li, vi in enumerate(range(start, end)):
            row = w[li]
            if row.max() <= 1e-8:
                # Fallback: nearest bone full weight so nothing is unbound
                j = int(np.argmin(dist[li]))
                mesh.vertex_groups[names[j]].add([vi], 1.0, "REPLACE")
                assigned += 1
                continue
            idx = np.argpartition(row, -max_inf)[-max_inf:]
            idx = idx[row[idx] > 1e-6]
            if len(idx) == 0:
                j = int(np.argmin(dist[li]))
                mesh.vertex_groups[names[j]].add([vi], 1.0, "REPLACE")
                assigned += 1
                continue
            vals = row[idx]
            vals = vals / vals.sum()
            for j, val in zip(idx, vals):
                mesh.vertex_groups[names[int(j)]].add([vi], float(val), "REPLACE")
            assigned += 1
        if start % 40000 == 0:
            log(f"  weights {end}/{nverts}")

    # Parent + armature modifier
    mesh.parent = garg
    mesh.matrix_parent_inverse = garg.matrix_world.inverted() @ mesh.matrix_world
    mod = mesh.modifiers.new("Armature", "ARMATURE")
    mod.object = garg
    mod.use_vertex_groups = True
    elapsed = time.time() - t0
    nonzero = sum(1 for v in mesh.data.vertices if v.groups)
    log(f"bind: distance weights verts={nonzero}/{nverts} groups={len(mesh.vertex_groups)} ({elapsed:.1f}s)")
    return {
        "method": "distance_to_bone_topk4",
        "sigma": sigma,
        "radius": radius,
        "bones": len(bones),
        "nonzero_verts": nonzero,
        "elapsed_s": round(elapsed, 2),
        "note": "heat-map ARMATURE_AUTO assigned 0 weights on this mesh; used distance skinning",
    }


def light_weight_cleanup(mesh: bpy.types.Object) -> dict:
    """Normalize + light smooth only — no judgment painting."""
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    except Exception as e:
        log(f"normalize warn: {e}")
    try:
        # Gentle global smooth — safe automatic cleanup
        bpy.ops.object.vertex_group_smooth(factor=0.15, repeat=1, expand=0.0)
    except Exception as e:
        log(f"smooth warn: {e}")
    bpy.ops.object.mode_set(mode="OBJECT")
    # Limit influences roughly by cleaning tiny weights
    try:
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01, keep_single=True)
    except Exception as e:
        log(f"clean warn: {e}")
    return {"normalize": True, "smooth_factor": 0.15, "clean_limit": 0.01}


def import_fbx_donor() -> bpy.types.Object:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before]
    donor = next(o for o in added if o.type == "ARMATURE")
    donor.name = "GargoyleAnimDonor"
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    # Keep FBX object scale + animation intact — we only sample matrix_basis (local pose).
    # Do NOT hide_viewport — Blender 5 skips anim eval on fully hidden objects.
    donor.hide_render = True
    if not donor.animation_data:
        donor.animation_data_create()
    act = donor.animation_data.action
    # Blender 5 layered Actions need an action_slot assigned to scrub.
    if act is not None and hasattr(donor.animation_data, "action_slot"):
        slots = []
        if hasattr(donor.animation_data, "action_suitable_slots"):
            slots = list(donor.animation_data.action_suitable_slots)
        if not slots and hasattr(act, "slots"):
            slots = list(act.slots)
        if slots:
            donor.animation_data.action_slot = slots[0]
            log(f"donor: action_slot={slots[0].name_display if hasattr(slots[0],'name_display') else slots[0]}")
    log(f"donor: {donor.name} bones={len(donor.data.bones)} action={getattr(act, 'name', None)}")
    # Sanity: pose must change across Take 001
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_set(0)
    bpy.context.view_layer.update()
    q0 = donor.pose.bones["GargLArmUpperarm1"].matrix_basis.to_quaternion().copy()
    scene.frame_set(360)
    bpy.context.view_layer.update()
    q1 = donor.pose.bones["GargLArmUpperarm1"].matrix_basis.to_quaternion().copy()
    ang = q0.rotation_difference(q1).angle
    log(f"donor: walk sanity Δq={round(ang, 3)} rad")
    if ang < 0.05:
        raise RuntimeError("Donor Take 001 is not evaluating — aborting verify")
    return donor


def ensure_anim(arm: bpy.types.Object):
    if not arm.animation_data:
        arm.animation_data_create()


def clear_pose(arm: bpy.types.Object):
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def sample_native_pose(donor: bpy.types.Object, tgt: bpy.types.Object, frame: int):
    """Copy local pose by bone name — native, no retarget.

    FBX imports keep object scale ~0.01 while bone location keys stay in
    pre-scale units. Copying raw matrix_basis onto an identity-scale fitted
    armature teleports the root (~20m). Scale location by donor.object scale;
    rotations/scales copy as-is.
    """
    scene = bpy.context.scene
    scene.frame_set(int(frame))
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    ev = donor.evaluated_get(deps)
    sx, sy, sz = donor.scale
    # Uniform-ish; FBX uses equal axes
    loc_scale = Vector((sx, sy, sz))
    for pb in tgt.pose.bones:
        src = ev.pose.bones.get(pb.name)
        if src is None:
            continue
        loc, rot, sc = src.matrix_basis.decompose()
        loc = Vector((loc.x * loc_scale.x, loc.y * loc_scale.y, loc.z * loc_scale.z))
        pb.matrix_basis = Matrix.LocRotScale(loc, rot, sc)
    bpy.context.view_layer.update()


def bone_world_y(arm: bpy.types.Object, name: str) -> Vector | None:
    if name not in arm.pose.bones:
        return None
    return (arm.matrix_world @ arm.pose.bones[name].matrix).to_3x3() @ Vector((0, 1, 0))


def mesh_aabb(mesh: bpy.types.Object) -> tuple[Vector, Vector, float]:
    """AABB from *deformed* evaluated verts (obj.bound_box ignores armature)."""
    import numpy as np

    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        n = len(me.vertices)
        co = np.zeros(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(n, 3)
        M = np.array(ev.matrix_world, dtype=np.float64)
        ones = np.ones((n, 1), dtype=np.float64)
        w = (np.concatenate([co, ones], axis=1) @ M.T)[:, :3]
        mn = Vector(w.min(axis=0).tolist())
        mx = Vector(w.max(axis=0).tolist())
        vol = max(1e-9, float((mx.x - mn.x) * (mx.y - mn.y) * (mx.z - mn.z)))
        return mn, mx, vol
    finally:
        ev.to_mesh_clear()


def setup_preview_camera():
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.type == "CAMERA":
            bpy.data.objects.remove(o, do_unlink=True)
    cam_data = bpy.data.cameras.new("CAM_step2")
    cam = bpy.data.objects.new("CAM_step2", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (1.6, -2.2, 0.85)
    cam.rotation_euler = (math.radians(72), 0, math.radians(32))
    cam_data.lens = 50
    # Workbench so we don't depend on materials/HDRI
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.72, 0.68, 0.62)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.12, 0.14, 0.18, 1)
        bg.inputs[1].default_value = 1.0
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    return cam


def frame_camera_on_mesh(mesh: bpy.types.Object, cam: bpy.types.Object):
    import numpy as np

    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        n = len(me.vertices)
        co = np.zeros(n * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        co = co.reshape(n, 3)
        M = np.array(ev.matrix_world, dtype=np.float64)
        w = (np.concatenate([co, np.ones((n, 1))], axis=1) @ M.T)[:, :3]
        center = Vector(w.mean(axis=0).tolist())
        size = float(np.linalg.norm(w.max(axis=0) - w.min(axis=0)))
    finally:
        ev.to_mesh_clear()
    dist = max(1.2, size * 1.7)
    cam.location = center + Vector((dist * 0.65, -dist, dist * 0.4))
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return center, size


def render_frame(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    log(f"  render {path.name}")


def analyze_clip(
    donor: bpy.types.Object,
    tgt: bpy.types.Object,
    mesh: bpy.types.Object,
    name: str,
    f0: int,
    f1: int,
    rest_vol: float,
) -> dict:
    """Sample mid + extremes; score regions without visual judgment painting."""
    frames = sorted({f0, (f0 + f1) // 2, f1, f0 + max(1, (f1 - f0) // 4), f0 + (3 * (f1 - f0)) // 4})
    clear_pose(tgt)
    sample_native_pose(donor, tgt, f0)
    y0 = {n: bone_world_y(tgt, n) for n in sum(REGION_BONES.values(), [])}

    region_notes: dict[str, list[str]] = {r: [] for r in REGION_BONES}
    twist_hits: dict[str, int] = {r: 0 for r in REGION_BONES}
    max_twist: dict[str, float] = {r: 0.0 for r in REGION_BONES}
    vol_ratios = []

    for fr in frames:
        sample_native_pose(donor, tgt, fr)
        _, _, vol = mesh_aabb(mesh)
        vol_ratios.append(vol / rest_vol)
        for region, bones in REGION_BONES.items():
            for bn in bones:
                y = bone_world_y(tgt, bn)
                y_ref = y0.get(bn)
                if y is None or y_ref is None or y.length < 1e-6 or y_ref.length < 1e-6:
                    continue
                # Angle between rest-frame bone Y and current — large mid-clip flips ≈ twist
                ang = y.normalized().angle(y_ref.normalized())
                max_twist[region] = max(max_twist[region], ang)
                if ang > math.radians(120):
                    twist_hits[region] += 1
                    region_notes[region].append(f"{bn}@{fr}: bone-Y flip {math.degrees(ang):.0f}°")

    # Volume collapse / explode
    min_vr = min(vol_ratios) if vol_ratios else 1.0
    max_vr = max(vol_ratios) if vol_ratios else 1.0
    mesh_note = None
    if min_vr < 0.35:
        mesh_note = f"mesh volume collapsed ({min_vr:.2f}× rest) — likely broken weights"
    elif max_vr > 3.5:
        mesh_note = f"mesh volume exploded ({max_vr:.2f}× rest) — likely broken weights"

    # Score regions
    scores = {}
    for region in REGION_BONES:
        hits = twist_hits[region]
        mt = max_twist[region]
        # Large intentional swings (Attack / Fly) move bone Y a lot — that is NOT
        # retarget twist. Only flag bone-Y when paired with mesh collapse/explode
        # or extreme mid-clip discontinuities.
        if mesh_note and region in ("torso", "arms", "legs", "wings"):
            verdict = "broken"
            note = mesh_note
        elif hits >= 5 and mt > math.radians(160) and (min_vr < 0.5 or max_vr > 2.8):
            verdict = "broken"
            note = region_notes[region][0] if region_notes[region] else f"pose+volume failure ({math.degrees(mt):.0f}°)"
        elif hits >= 2 or mt > math.radians(100):
            verdict = "minor weight artifacts"
            note = region_notes[region][0] if region_notes[region] else f"large local swing ({math.degrees(mt):.0f}°) — check weights visually"
        else:
            verdict = "clean"
            note = "stable local pose; no retarget-style twist signature"
        # Expected caveats
        if region == "hands" and verdict != "broken":
            note = "palm-mass deform expected (no finger bones) — " + note
        if region == "wings" and verdict == "clean":
            note = "seated wing roots preserved; " + note
        if region == "legs" and verdict == "clean":
            note = "thighs had mild fit offset — watch for loose deform; " + note
        scores[region] = {
            "verdict": verdict,
            "note": note,
            "max_bone_y_delta_deg": round(math.degrees(mt), 1),
            "flip_hits": hits,
        }

    return {
        "clip": name,
        "frames": [f0, f1],
        "volume_ratio_min": round(min_vr, 3),
        "volume_ratio_max": round(max_vr, 3),
        "mesh_note": mesh_note,
        "regions": scores,
        "preview_frame": (f0 + f1) // 2,
    }


def vg_coverage(mesh: bpy.types.Object, garg: bpy.types.Object) -> dict:
    """Quick weight health: zero-weight verts, empty groups, wing/shoulder presence."""
    nverts = len(mesh.data.vertices)
    weighted = [False] * nverts
    for vg in mesh.vertex_groups:
        for i, v in enumerate(mesh.data.vertices):
            try:
                if vg.weight(i) > 1e-4:
                    weighted[i] = True
            except RuntimeError:
                pass
    # Faster: iterate group weights via foreach if needed — for 321k this loop is heavy.
    # Use bmesh-less: only sample every Nth vert for zero-weight estimate if too slow.
    zero = sum(1 for w in weighted if not w)
    # Actually the nested loop above is O(groups*verts) = 112*321k — too slow.
    # Recompute with single pass:
    return _vg_coverage_fast(mesh, garg)


def _vg_coverage_fast(mesh: bpy.types.Object, garg: bpy.types.Object) -> dict:
    nverts = len(mesh.data.vertices)
    max_w = [0.0] * nverts
    for vg in mesh.vertex_groups:
        # Blender doesn't expose a fast bulk API easily; sample via vertex group indices on verts
        pass
    # Use evaluated mesh vertex group weights from deform
    # Fallback: random sample 4k verts
    import random

    rng = random.Random(42)
    sample_idx = rng.sample(range(nverts), min(4000, nverts))
    zero = 0
    for i in sample_idx:
        total = 0.0
        for g in mesh.data.vertices[i].groups:
            total += g.weight
        if total < 1e-4:
            zero += 1
    zero_pct = zero / max(1, len(sample_idx))
    present = {vg.name for vg in mesh.vertex_groups}
    expected = [b.name for b in garg.data.bones]
    missing_groups = [n for n in expected if n not in present]
    key_groups = [
        "GargLWingWCollarbone",
        "GargRWingWCollarbone",
        "GargLArmCollarbone",
        "GargRCollarbone",
        "GargLLegThigh1",
        "GargRThigh1",
        "GargLArmPalm",
        "GargRPalm",
    ]
    return {
        "vertex_groups": len(mesh.vertex_groups),
        "sampled_zero_weight_pct": round(zero_pct, 3),
        "missing_bone_groups": len(missing_groups),
        "key_groups_present": {k: k in present for k in key_groups},
    }


def flag_cleanup_regions(clip_reports: list[dict], coverage: dict) -> list[dict]:
    flags = []
    # Aggregate worst verdict per region across clips
    worst: dict[str, str] = {}
    notes: dict[str, str] = {}
    order = {"clean": 0, "minor weight artifacts": 1, "broken": 2}
    for rep in clip_reports:
        for region, info in rep["regions"].items():
            v = info["verdict"]
            if region not in worst or order[v] > order[worst[region]]:
                worst[region] = v
                notes[region] = info["note"]

    likely = [
        ("wings", "wing roots — auto-weights often pinch membrane at WCollarbone/Wing1"),
        ("arms", "shoulders / clavicle — expect bleed into torso on arm raise"),
        ("legs", "hips/thighs — mild fit offset; expect slightly loose thigh deform"),
    ]
    for region, hint in likely:
        flags.append(
            {
                "region": region,
                "priority": "high" if worst.get(region) == "broken" else "medium",
                "auto_verdict": worst.get(region, "clean"),
                "note": notes.get(region, hint),
                "suggested": hint,
            }
        )
    if coverage.get("sampled_zero_weight_pct", 0) > 0.02:
        flags.append(
            {
                "region": "mesh_gaps",
                "priority": "high",
                "auto_verdict": "minor weight artifacts",
                "note": f"~{coverage['sampled_zero_weight_pct']*100:.1f}% sampled verts near-zero weight",
                "suggested": "check zero-weight pockets after visual review",
            }
        )
    # Always list expected non-bugs
    flags.append(
        {
            "region": "hands",
            "priority": "info",
            "auto_verdict": worst.get("hands", "clean"),
            "note": "palm-only mass is intentional — not a finger weight bug",
            "suggested": "do not chase per-claw weights",
        }
    )
    return flags


def main():
    if not FIT_BLEND.exists():
        raise SystemExit(f"Missing Step-1 blend: {FIT_BLEND}")
    PREV.mkdir(parents=True, exist_ok=True)

    log(f"open {FIT_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(FIT_BLEND))

    garg = find_garg_arm()
    mesh = find_mesh()
    garg.name = "ARM_GargoyleNative"
    mesh.name = "SM_WingedMonkey_reskin"
    log(f"mesh={mesh.name} verts={len(mesh.data.vertices)} arm={garg.name} bones={len(garg.data.bones)}")

    # Rest volume baseline (pre-bind deform still ok)
    clear_pose(garg)
    bpy.context.view_layer.update()
    _, _, rest_vol_pre = mesh_aabb(mesh)

    skin_info = clear_old_skin(mesh, garg)
    log(f"cleared old skin: {skin_info}")

    bind_info = bind_auto(mesh, garg)
    if bind_info.get("nonzero_verts", 0) < len(mesh.data.vertices) * 0.5:
        raise SystemExit(f"bind produced too few weighted verts: {bind_info}")
    cleanup_info = light_weight_cleanup(mesh)
    coverage = _vg_coverage_fast(mesh, garg)
    log(f"coverage: {coverage}")
    if coverage.get("sampled_zero_weight_pct", 1.0) > 0.15:
        raise SystemExit(f"weights still mostly empty after bind: {coverage}")

    clear_pose(garg)
    bpy.context.view_layer.update()
    _, _, rest_vol = mesh_aabb(mesh)

    donor = import_fbx_donor()
    # Native Take 001 is authored @ 30fps
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_start = 0
    scene.frame_end = 2200
    # Hide donor meshes already done.

    cam = setup_preview_camera()
    clip_reports = []
    for name, f0, f1 in VERIFY_CLIPS:
        log(f"verify clip {name} [{f0}-{f1}]")
        rep = analyze_clip(donor, garg, mesh, name, f0, f1, rest_vol)
        # Render mid frame
        mid = rep["preview_frame"]
        sample_native_pose(donor, garg, mid)
        frame_camera_on_mesh(mesh, cam)
        render_frame(PREV / f"{name}_f{mid}.png")
        # Also rest / start
        sample_native_pose(donor, garg, f0)
        frame_camera_on_mesh(mesh, cam)
        render_frame(PREV / f"{name}_f{f0}_start.png")
        clip_reports.append(rep)
        log(
            f"  vol {rep['volume_ratio_min']}–{rep['volume_ratio_max']}  "
            + " ".join(f"{r}={rep['regions'][r]['verdict']}" for r in ("torso", "arms", "wings", "hands", "legs", "head"))
        )

    # Leave Idle mid-pose on the armature for open-in-UI review
    sample_native_pose(donor, garg, (80 + 190) // 2)
    ensure_anim(garg)
    # Store a simple action snapshot of current pose? optional — clear donor from selection
    donor.hide_viewport = True

    flags = flag_cleanup_regions(clip_reports, coverage)

    # Aggregate per-region across clips for the summary table
    order = {"clean": 0, "minor weight artifacts": 1, "broken": 2}
    region_summary = {}
    for region in REGION_BONES:
        worst = "clean"
        note = ""
        for rep in clip_reports:
            info = rep["regions"][region]
            if order[info["verdict"]] >= order[worst]:
                worst = info["verdict"]
                note = f"{rep['clip']}: {info['note']}"
        region_summary[region] = {"verdict": worst, "note": note}

    # Save bound blend (keep donor for optional re-scrub; or remove to slim file)
    # Keep donor hidden so user can scrub Take 001 against fitted arm if needed.
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {
        "step": 2,
        "status": "bound_verified_not_handpainted",
        "originals_untouched": True,
        "source_fit_blend": str(FIT_BLEND),
        "working_blend": str(OUT_BLEND),
        "skin": skin_info,
        "bind": bind_info,
        "cleanup": cleanup_info,
        "coverage": coverage,
        "method": "native_fbx_matrix_basis_copy_no_retarget",
        "clips": clip_reports,
        "region_summary": region_summary,
        "cleanup_flags": flags,
        "previews": str(PREV),
        "expectations": {
            "hands": "palm-only mass — intentional",
            "wings": "seated roots — do not re-nudge bones",
            "thighs": "mild fit offset — expected loose spot",
        },
    }
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n")

    lines = [
        "# Reskin Step 2 — Bind + native clip verify",
        "",
        f"- Working copy: `{OUT_BLEND.relative_to(ROOT)}`",
        f"- Source fit: `{FIT_BLEND.relative_to(ROOT)}`",
        "- Originals untouched; no retarget; bone names/hierarchy intact",
        "- Bind: distance-to-bone auto-weights (heat-map failed on this mesh) + normalize / light smooth / clean(0.01)",
        "- Clips: native FBX Take 001 local pose copy (Idle / Walk / FlyIdleLoop / FlyForward / Attack01)",
        "",
        "## Region summary (worst across clips)",
        "",
        "| Region | Verdict | Note |",
        "|---|---|---|",
    ]
    for region, info in region_summary.items():
        lines.append(f"| **{region}** | **{info['verdict']}** | {info['note']} |")
    lines += ["", "## Per-clip", ""]
    for rep in clip_reports:
        lines.append(
            f"### {rep['clip']}  (vol {rep['volume_ratio_min']}–{rep['volume_ratio_max']}× rest)"
        )
        if rep.get("mesh_note"):
            lines.append(f"- MESH: {rep['mesh_note']}")
        for region, info in rep["regions"].items():
            lines.append(
                f"- **{region}**: {info['verdict']} — {info['note']} "
                f"(max ΔY {info['max_bone_y_delta_deg']}°)"
            )
        lines.append("")
    lines += ["## Weight cleanup flags (for you)", ""]
    for f in flags:
        lines.append(
            f"- **{f['region']}** [{f['priority']}] {f['auto_verdict']}: {f['note']} — _{f['suggested']}_"
        )
    lines += [
        "",
        "## Expected non-bugs",
        "- Hands deform as one palm mass (no finger bones).",
        "- Wings left seated from Step-1; flag weight help only — do not re-nudge bones.",
        "- Thighs had a few cm fit offset — slightly loose is expected.",
        "",
        f"Previews: `{PREV.relative_to(ROOT)}`",
        f"JSON: `{OUT_JSON.relative_to(ROOT)}`",
        "",
        "Stopped before detailed weight painting.",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_BLEND}")
    log(f"wrote {OUT_MD}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("STEP2 FAILED:", e, file=sys.stderr)
        raise
