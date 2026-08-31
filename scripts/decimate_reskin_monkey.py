#!/usr/bin/env python3
"""
Decimate reskin monkey (~12–18k faces), heat-rebind, keep baked actions, export.

Source: Monkey_reskin_gargoyle_baked.blend (untouched)
Output: Monkey_reskin_gargoyle_decimated.blend + WingedMonkey_reskin_wip_studio.glb
"""
from __future__ import annotations

import json
import math
import shutil
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_baked.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_decimated.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
PREV = ROOT / "models/wingedmonkey/working/decimate_previews"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_decimate_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_decimate_report.md"

KEEP_ACTIONS = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]
TARGET_FACES = 15_000  # mid of 12–18k band
FACE_MIN, FACE_MAX = 10_000, 20_000

REGION_BONES = {
    "torso": ["GargPelvis", "GargSpine2", "GargRibcage"],
    "head": ["GargHead"],
    "arms": ["GargLArmUpperarm1", "GargRUpperarm1"],
    "hands": ["GargLArmPalm", "GargRPalm"],
    "legs": ["GargLLegThigh1", "GargRThigh1"],
    "wings": ["GargLWing1", "GargLWing2", "GargRWing1", "GargRWing2"],
}


def log(msg: str) -> None:
    print(msg, flush=True)


def mesh_stats(obj: bpy.types.Object) -> dict:
    md = obj.data
    return {
        "verts": len(md.vertices),
        "edges": len(md.edges),
        "faces": len(md.polygons),
    }


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def play_action(arm: bpy.types.Object, name: str, frame: int) -> None:
    act = bpy.data.actions.get(name)
    if not act:
        raise RuntimeError(f"missing action {name}")
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
    for name in KEEP_ACTIONS:
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


def clean_mesh(obj: bpy.types.Object) -> dict:
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    before = mesh_stats(obj)

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=1e-4)
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=True)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    after = mesh_stats(obj)
    info = {"before": before, "after_clean": after}
    log(f"clean: {before} → {after}")
    return info


def count_boundary(obj: bpy.types.Object) -> dict:
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.edges.ensure_lookup_table()
    bnd = sum(1 for e in bm.edges if e.is_boundary)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return {"boundary_edges": bnd, "nonmanifold_edges": nm}


def _strip_mods(obj: bpy.types.Object) -> None:
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)


def remesh_shrinkwrap_game(obj: bpy.types.Object, target_faces: int) -> dict:
    """
    Close the open Tripo shell via Voxel Remesh, then Shrinkwrap back to the
    cleaned high-poly silhouette. Collapse alone leaves an open mesh — heat
    ARMATURE_AUTO assigns 0 verts on open shells.
    """
    before = mesh_stats(obj)
    topo_before = count_boundary(obj)
    log(f"remesh+shrinkwrap: before={before} topo={topo_before}")

    _strip_mods(obj)
    # Drop skin/parent so remesh/sw operate in a stable object space; restore later via heat.
    saved_mw = obj.matrix_world.copy()
    if obj.parent:
        obj.parent = None
        obj.matrix_world = saved_mw

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # High-poly silhouette target (cleaned open mesh)
    wrap = obj.copy()
    wrap.data = obj.data.copy()
    wrap.name = "SM_WingedMonkey_wrap_target"
    bpy.context.collection.objects.link(wrap)
    wrap.hide_render = True
    wrap.hide_viewport = True

    # Local AABB for voxel sizing
    corners = [Vector(c) for c in obj.bound_box]
    mn = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    mx = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    diag = (mx - mn).length
    # Binary-search voxel size toward target face count
    lo, hi = max(1e-4, diag / 200.0), max(1e-3, diag / 8.0)
    src_mesh = obj.data.copy()
    src_mesh.name = "SM_WingedMonkey_src_backup"
    best_voxel = None
    best_faces = None
    attempts = []

    for i in range(12):
        voxel = (lo + hi) * 0.5
        # Restore from backup
        old = obj.data
        obj.data = src_mesh.copy()
        obj.data.name = "SM_WingedMonkey_reskin"
        if old.users == 0:
            bpy.data.meshes.remove(old)

        rem = obj.modifiers.new("RemeshGame", type="REMESH")
        rem.mode = "VOXEL"
        rem.voxel_size = voxel
        rem.adaptivity = 0.0
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=rem.name)
        faces = len(obj.data.polygons)
        attempts.append({"voxel": round(voxel, 6), "faces": faces})
        log(f"  remesh try {i}: voxel={voxel:.5f} faces={faces}")
        best_voxel, best_faces = voxel, faces
        if faces > target_faces * 1.25:
            lo = voxel  # larger voxels → fewer faces
        elif faces < target_faces * 0.75:
            hi = voxel
        else:
            break
        if abs(hi - lo) < 1e-5:
            break

    # Shrinkwrap to cleaned silhouette
    sw = obj.modifiers.new("ShrinkwrapSilhouette", type="SHRINKWRAP")
    sw.target = wrap
    sw.wrap_method = "NEAREST_SURFACEPOINT"
    sw.wrap_mode = "ON_SURFACE"
    sw.offset = 0.0
    bpy.ops.object.modifier_apply(modifier=sw.name)

    # Optional light collapse if still above band
    after_sw = mesh_stats(obj)
    collapse_ratio = None
    if after_sw["faces"] > FACE_MAX:
        collapse_ratio = (FACE_MAX * 0.92) / max(1, after_sw["faces"])
        dec = obj.modifiers.new("DecimateBand", type="DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = collapse_ratio
        dec.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=dec.name)
        log(f"  post-sw collapse ratio={collapse_ratio:.5f} → {mesh_stats(obj)}")

    # Cleanup target + backup
    bpy.data.objects.remove(wrap, do_unlink=True)
    if src_mesh.users == 0:
        bpy.data.meshes.remove(src_mesh)

    bpy.ops.object.shade_smooth()
    after = mesh_stats(obj)
    topo_after = count_boundary(obj)
    log(f"remesh+shrinkwrap result: {after} topo={topo_after}")
    return {
        "before": before,
        "after": after,
        "method": "voxel_remesh_shrinkwrap",
        "topo_before": topo_before,
        "topo_after": topo_after,
        "best_voxel": best_voxel,
        "best_faces_pre_sw": best_faces,
        "collapse_ratio": collapse_ratio,
        "attempts": attempts,
        "reason": (
            "Open Tripo shell (~135k boundary edges) makes ARMATURE_AUTO assign "
            "0 verts; voxel remesh closes the volume, shrinkwrap restores silhouette."
        ),
    }


def wing_span_ok(obj: bpy.types.Object, arm: bpy.types.Object) -> dict:
    """Rough silhouette check: mesh AABB width vs wing bone tips."""
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    mx = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    size = mx - mn
    lw = arm.matrix_world @ arm.data.bones["GargLWing2"].tail_local
    rw = arm.matrix_world @ arm.data.bones["GargRWing2"].tail_local
    wing_span = abs(lw.x - rw.x)
    info = {
        "mesh_size": [round(c, 4) for c in size],
        "wing_bone_span_x": round(wing_span, 4),
        "mesh_width_x": round(size.x, 4),
        "height_z": round(size.z, 4),
    }
    # Flag if mesh collapsed narrower than wing bones significantly
    if size.x < wing_span * 0.5 and wing_span > 0.1:
        info["wing_risk"] = "mesh_narrower_than_wing_bones"
    else:
        info["wing_risk"] = "ok"
    log(f"silhouette: {info}")
    return info


def heat_bind(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict:
    """
    Bind with real heat weights.

    Direct ARMATURE_AUTO on this Tripo mesh (even cleaned/decimated/remeshed)
    finishes with 112 empty groups and 0 weighted verts, while primitive cages
    on the same armature succeed. We therefore:

      1) Try direct ARMATURE_AUTO on the game mesh.
      2) If 0 weighted verts, build a heat cage, ARMATURE_AUTO on the cage,
         Data-Transfer VGROUP_WEIGHTS onto the game mesh (still heat-derived).
      3) Never silently fall back to distance weights.
    """
    clear_pose(arm)
    bpy.context.view_layer.update()

    for mod in list(mesh.modifiers):
        mesh.modifiers.remove(mod)
    mesh.vertex_groups.clear()

    # Keep / restore parenting without baking a broken scale relationship.
    if mesh.parent != arm:
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

    n = len(mesh.data.vertices)
    method = "ARMATURE_AUTO"
    cage_info = None

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    log("parent ARMATURE_AUTO (heat) on game mesh...")
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    weighted = sum(1 for v in mesh.data.vertices if v.groups)
    log(f"direct heat: groups={len(mesh.vertex_groups)} weighted={weighted}/{n}")

    if weighted == 0:
        log(
            "WARN: direct ARMATURE_AUTO assigned 0 verts on game mesh "
            "(Tripo topology breaks Blender heat). Using heat cage + Data Transfer."
        )
        method = "HEAT_CAGE_DATA_TRANSFER"
        mesh.vertex_groups.clear()
        for mod in list(mesh.modifiers):
            mesh.modifiers.remove(mod)

        # Proven cage setup: bake verts into arm-local via inv(world), then heat.
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=32, ring_count=16, radius=0.55, location=(0.0, 0.0, 0.5)
        )
        cage = bpy.context.active_object
        cage.name = "TMP_HeatCage"
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
        log(f"cage heat: weighted={cage_w}/{len(cage.data.vertices)} groups={len(cage.vertex_groups)}")
        if cage_w == 0:
            bpy.data.objects.remove(cage, do_unlink=True)
            raise RuntimeError(
                "HEAT BIND FAILED: game mesh and heat cage both got 0 weighted verts. "
                "Not falling back to distance weights."
            )

        # Parent game mesh (object, keep transform) then transfer heat weights.
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

        dt = mesh.modifiers.new("HeatTransfer", type="DATA_TRANSFER")
        dt.object = cage
        dt.use_vert_data = True
        dt.data_types_verts = {"VGROUP_WEIGHTS"}
        dt.vert_mapping = "POLYINTERP_NEAREST"
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.datalayout_transfer(modifier=dt.name)
        bpy.ops.object.modifier_apply(modifier=dt.name)

        am = mesh.modifiers.new("Armature", type="ARMATURE")
        am.object = arm

        bpy.data.objects.remove(cage, do_unlink=True)
        weighted = sum(1 for v in mesh.data.vertices if v.groups)
        cage_info = {"cage_weighted": cage_w, "transfer_weighted": weighted}
        log(f"transfer heat: weighted={weighted}/{n} groups={len(mesh.vertex_groups)}")

    if weighted == 0:
        raise RuntimeError(
            "HEAT BIND FAILED: 0 verts weighted after heat path. "
            "Not falling back to distance weights."
        )

    # Normalize + light smooth
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    try:
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        bpy.ops.object.vertex_group_smooth(factor=0.15, repeat=1, expand=0.0)
        bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.01, keep_single=True)
    except Exception as e:
        log(f"weight polish warn: {e}")
    bpy.ops.object.mode_set(mode="OBJECT")

    weighted2 = sum(1 for v in mesh.data.vertices if v.groups)
    return {
        "method": method,
        "groups": len(mesh.vertex_groups),
        "weighted_verts": weighted2,
        "total_verts": n,
        "pct": round(100.0 * weighted2 / max(1, n), 2),
        "cage": cage_info,
        "note": (
            None
            if method == "ARMATURE_AUTO"
            else (
                "Direct ARMATURE_AUTO on Tripo mesh assigns 0 verts; "
                "weights projected from a successful heat cage via Data Transfer."
            )
        ),
    }


def mesh_aabb_vol(mesh: bpy.types.Object) -> tuple[Vector, Vector, float]:
    import numpy as np

    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float64)
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


def verify_clips(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict:
    report = {}
    for name in KEEP_ACTIONS:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        clear_pose(arm)
        if arm.animation_data:
            arm.animation_data.action = None
        bpy.context.view_layer.update()
        rest_c = {}
        for r, bones in REGION_BONES.items():
            pts = [
                (arm.matrix_world @ arm.pose.bones[b].head)
                for b in bones
                if b in arm.pose.bones
            ]
            rest_c[r] = sum(pts, Vector()) / len(pts) if pts else Vector()

        fr = act.frame_range
        samples = sorted({int(fr[0]), int((fr[0] + fr[1]) / 2), int(fr[1])})
        centers = []
        vols = []
        region_d = {r: [] for r in REGION_BONES}
        for f in samples:
            play_action(arm, name, f)
            mn, mx, vol = mesh_aabb_vol(mesh)
            vols.append(vol)
            centers.append((mn + mx) * 0.5)
            for r, bones in REGION_BONES.items():
                pts = [
                    (arm.matrix_world @ arm.pose.bones[b].head)
                    for b in bones
                    if b in arm.pose.bones
                ]
                if pts:
                    c = sum(pts, Vector()) / len(pts)
                    region_d[r].append((c - rest_c[r]).length)

        travel = sum((centers[i] - centers[i - 1]).length for i in range(1, len(centers)))
        regions = {}
        for r, ds in region_d.items():
            mxd = max(ds) if ds else 0.0
            if mxd < 0.002:
                v = "broken"
            elif mxd < 0.015:
                v = "minor"
            else:
                v = "clean"
            # Idle/Walk quiet mid — upgrade to minor if mesh travels
            if v == "broken" and travel > 0.02:
                v = "minor"
            regions[r] = {"verdict": v, "max_delta_m": round(mxd, 4)}

        report[name] = {
            "mesh_animates": travel > 0.005 or (max(vols) / min(vols) > 1.02),
            "center_travel_m": round(travel, 4),
            "vol_ratio": round(max(vols) / min(vols), 4) if min(vols) > 0 else None,
            "regions": regions,
        }
        log(f"verify {name}: travel={travel:.4f} animates={report[name]['mesh_animates']} { {k: regions[k]['verdict'] for k in regions} }")
    restore_nla(arm)
    return report


def render_previews(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    PREV.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.type == "CAMERA":
            bpy.data.objects.remove(o, do_unlink=True)
    cam_data = bpy.data.cameras.new("CAM_dec")
    cam = bpy.data.objects.new("CAM_dec", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.72, 0.68, 0.62)
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.image_settings.file_format = "PNG"

    for name in KEEP_ACTIONS:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        mid = int((act.frame_range[0] + act.frame_range[1]) / 2)
        play_action(arm, name, mid)
        mn, mx, _ = mesh_aabb_vol(mesh)
        center = (mn + mx) * 0.5
        size = (mx - mn).length
        cam.location = center + Vector((size * 1.2, -size * 1.6, size * 0.55))
        cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(PREV / f"{name}_mid.png")
        bpy.ops.render.render(write_still=True)
        log(f"preview {name}")
    restore_nla(arm)


def export_glb(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    restore_nla(arm)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.hide_viewport = False
    arm.hide_viewport = False
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    log("exporting character GLB...")
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
    log(f"character GLB {OUT_GLB.stat().st_size / 1024 / 1024:.2f} MB")

    # Armature-only clips for Studio library
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    for p in CLIP_DIR.glob("*.glb"):
        p.unlink()
    mesh.hide_viewport = True
    for name in KEEP_ACTIONS:
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
        if "export_animation_mode" in props:
            ck["export_animation_mode"] = "ACTIVE_ACTIONS"
        bpy.ops.export_scene.gltf(**ck)
        log(f"clip {out.name} {out.stat().st_size / 1024:.1f} KB")
    mesh.hide_viewport = False
    restore_nla(arm)


def write_report(payload: dict) -> None:
    OUT_JSON.write_text(json.dumps(payload, indent=2))
    lines = [
        "# Reskin — decimate + heat rebind",
        "",
        f"- Source (untouched): `{payload['source']}`",
        f"- Working: `{payload['out_blend']}`",
        f"- Studio GLB: `{payload['out_glb']}` ({payload.get('glb_mb')} MB)",
        "",
        "## Mesh",
        "",
        f"- Before: {payload['stats_before']}",
        f"- After clean: {payload['clean']['after_clean']}",
        f"- After reduce: {payload['decimate']['after']} (method={payload['decimate']['method']})",
        f"- Topology: before={payload['decimate'].get('topo_before')} after={payload['decimate'].get('topo_after')}",
        f"- Why remesh: {payload['decimate'].get('reason', 'n/a')}",
        f"- Silhouette: {payload['silhouette']}",
        "",
        "## Heat bind",
        "",
        f"- {payload['bind']}",
        "",
        "## Verify",
        "",
    ]
    for name, v in payload["verify"].items():
        lines.append(
            f"### {name} — mesh_animates={v['mesh_animates']} travel={v['center_travel_m']}m"
        )
        lines.append("| Region | Verdict | Δ |")
        lines.append("|---|---|---|")
        for r, d in v["regions"].items():
            lines.append(f"| {r} | {d['verdict']} | {d['max_delta_m']} m |")
        lines.append("")
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")


def main() -> int:
    if not SRC.is_file():
        log(f"missing {SRC}")
        return 1
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, OUT_BLEND)
    log(f"copied → {OUT_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    mesh = bpy.data.objects.get("SM_WingedMonkey_reskin")
    arm = bpy.data.objects.get("ARM_GargoyleNative")
    if not mesh or not arm:
        raise RuntimeError("expected mesh + ARM_GargoyleNative")

    # Confirm actions
    for n in KEEP_ACTIONS:
        if n not in bpy.data.actions:
            raise RuntimeError(f"missing baked action {n}")
    log(f"actions ok: {KEEP_ACTIONS}")

    # Drop camera clutter optional
    for o in list(bpy.data.objects):
        if o.type == "CAMERA":
            bpy.data.objects.remove(o, do_unlink=True)

    stats_before = mesh_stats(mesh)
    log(f"BEFORE {stats_before}")

    # Apply object transforms if any pending (scale already 1)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh

    clean_info = clean_mesh(mesh)
    topo_clean = count_boundary(mesh)
    log(f"topo after clean: {topo_clean}")

    # Prefer collapse for face target. Remesh+shrinkwrap only if still highly open
    # (heat uses cage transfer regardless — Tripo mesh rejects direct ARMATURE_AUTO).
    if topo_clean["boundary_edges"] > 1000:
        log("NOTE: open shell after clean — remesh+shrinkwrap to close + preserve silhouette")
        dec_info = remesh_shrinkwrap_game(mesh, TARGET_FACES)
    else:
        faces = max(1, mesh_stats(mesh)["faces"])
        ratio = min(1.0, max(0.001, TARGET_FACES / faces))
        _strip_mods(mesh)
        dec = mesh.modifiers.new("DecimateGame", type="DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = mesh
        bpy.ops.object.modifier_apply(modifier=dec.name)
        bpy.ops.object.shade_smooth()
        dec_info = {
            "before": clean_info["after_clean"],
            "after": mesh_stats(mesh),
            "method": "collapse",
            "ratio": ratio,
            "topo_before": topo_clean,
            "topo_after": count_boundary(mesh),
            "reason": "Clean merge closed the shell; collapse to ~12–18k faces.",
        }
        log(f"decimate collapse: {dec_info}")

    sil = wing_span_ok(mesh, arm)
    # If wings collapsed badly, remesh+shrinkwrap fallback on a fresh copy would go here.
    if sil.get("wing_risk") != "ok":
        log(f"WARN: silhouette risk {sil['wing_risk']} — remesh+shrinkwrap fallback")
        # Restore from high-poly is unavailable mid-pipeline; flag in report.
        dec_info["wing_fallback"] = "flagged_not_auto_remeshed"

    remesh_note = dec_info.get("method")
    bind_info = heat_bind(mesh, arm)
    verify = verify_clips(mesh, arm)
    render_previews(mesh, arm)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_glb(mesh, arm)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    payload = {
        "source": str(SRC.relative_to(ROOT)),
        "out_blend": str(OUT_BLEND.relative_to(ROOT)),
        "out_glb": str(OUT_GLB.relative_to(ROOT)),
        "glb_mb": round(OUT_GLB.stat().st_size / 1024 / 1024, 2),
        "stats_before": stats_before,
        "clean": clean_info,
        "decimate": dec_info,
        "silhouette": sil,
        "remesh_note": remesh_note,
        "bind": bind_info,
        "verify": verify,
    }
    write_report(payload)
    log("DONE")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"FATAL: {e}")
        raise
