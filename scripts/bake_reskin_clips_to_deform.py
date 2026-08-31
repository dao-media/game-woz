#!/usr/bin/env python3
"""
Bake GargoyleAnimDonor Take 001 slices onto ARM_GargoyleNative as named actions.

- Working copy only; mesh/weights untouched
- Donor location keys scaled by donor.object scale (0.01)
- Verifies mesh AABB motion with donor muted
- Exports studio GLB + per-clip anim GLBs for Studio pass-through
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
SRC_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_bound.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_baked.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
PREV = ROOT / "models/wingedmonkey/working/bake_clip_previews"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_bake_clips_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_bake_clips_report.md"

# Unity FBX.meta slices @ 30fps — same as Step 2 verify set
BAKE_CLIPS: list[tuple[str, int, int]] = [
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


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def sample_native_pose(donor: bpy.types.Object, tgt: bpy.types.Object, frame: int) -> None:
    """Copy local pose; scale location by donor object scale (FBX 0.01)."""
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


def ensure_donor_evaluates(donor: bpy.types.Object) -> None:
    if not donor.animation_data:
        donor.animation_data_create()
    act = donor.animation_data.action
    if act is None:
        # Prefer Take 001 action already in file
        for a in bpy.data.actions:
            if "Take 001" in a.name:
                donor.animation_data.action = a
                act = a
                break
    if act is None:
        raise RuntimeError("Donor has no Take 001 action")
    if hasattr(donor.animation_data, "action_slot"):
        slots = list(getattr(donor.animation_data, "action_suitable_slots", []) or [])
        if slots:
            donor.animation_data.action_slot = slots[0]
            log(f"donor action_slot set ({len(slots)} suitable)")
    donor.hide_viewport = False
    donor.hide_render = True


def keyframe_pose(arm: bpy.types.Object, frame: int) -> None:
    for pb in arm.pose.bones:
        pb.keyframe_insert(data_path="location", frame=frame)
        pb.rotation_mode = "QUATERNION"
        pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
        pb.keyframe_insert(data_path="scale", frame=frame)


def linearize_action(action: bpy.types.Action) -> None:
    fcurves = []
    if hasattr(action, "fcurves"):
        fcurves = list(action.fcurves)
    else:
        for layer in action.layers:
            for strip in layer.strips:
                if hasattr(strip, "channelbags"):
                    for cb in strip.channelbags:
                        fcurves.extend(cb.fcurves)
    for fc in fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def bake_clip(
    donor: bpy.types.Object,
    tgt: bpy.types.Object,
    name: str,
    f0: int,
    f1: int,
) -> dict:
    ensure_anim = tgt.animation_data_create() if not tgt.animation_data else tgt.animation_data
    # Clear active action / NLA influence while baking this clip
    tgt.animation_data.action = None
    for track in list(tgt.animation_data.nla_tracks):
        track.mute = True

    clear_pose(tgt)
    bpy.context.view_layer.update()

    # New action via first keyframe
    sample_native_pose(donor, tgt, f0)
    keyframe_pose(tgt, 1)
    action = tgt.animation_data.action
    if action is None:
        raise RuntimeError(f"Failed to create action for {name}")
    action.name = name

    # Blender 5: assign action slot if needed
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
    n_frames = f1 - f0 + 1
    log(f"baked {name}: donor {f0}-{f1} → local 1-{n_frames} action={action.name}")

    # Push to NLA strip (unmuted track) so glTF export_nla_strips finds it
    for track in list(tgt.animation_data.nla_tracks):
        tgt.animation_data.nla_tracks.remove(track)
    # Keep all clips: we rebuild NLA after all bakes — here just stash action by name
    tgt.animation_data.action = None
    clear_pose(tgt)

    return {
        "name": name,
        "donor_start": f0,
        "donor_end": f1,
        "local_frames": n_frames,
        "action": action.name,
    }


def stash_actions_to_nla(tgt: bpy.types.Object, clip_infos: list[dict]) -> None:
    if not tgt.animation_data:
        tgt.animation_data_create()
    for track in list(tgt.animation_data.nla_tracks):
        tgt.animation_data.nla_tracks.remove(track)
    tgt.animation_data.action = None

    cursor = 1
    for info in clip_infos:
        act = bpy.data.actions.get(info["action"])
        if act is None:
            raise RuntimeError(f"Missing action {info['action']}")
        track = tgt.animation_data.nla_tracks.new()
        track.name = info["name"]
        track.mute = False
        strip = track.strips.new(info["name"], start=cursor, action=act)
        strip.action_frame_start = act.frame_range[0]
        strip.action_frame_end = act.frame_range[1]
        # Blender 5 action slot on strip if present
        if hasattr(strip, "action_slot") and hasattr(tgt.animation_data, "action_suitable_slots"):
            slots = list(tgt.animation_data.action_suitable_slots or [])
            # Prefer slots matching this action
            for s in slots:
                try:
                    strip.action_slot = s
                    break
                except Exception:
                    pass
        info["nla_start"] = cursor
        info["nla_end"] = int(strip.frame_end)
        cursor = int(strip.frame_end) + 2
        log(f"NLA {info['name']}: frames {info['nla_start']}-{info['nla_end']}")


def mesh_aabb(mesh: bpy.types.Object) -> tuple[Vector, Vector, float]:
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


def play_action(tgt: bpy.types.Object, action_name: str, local_frame: int) -> None:
    act = bpy.data.actions.get(action_name)
    if act is None:
        raise RuntimeError(f"No action {action_name}")
    if not tgt.animation_data:
        tgt.animation_data_create()
    for track in tgt.animation_data.nla_tracks:
        track.mute = True
    tgt.animation_data.action = act
    if hasattr(tgt.animation_data, "action_slot"):
        slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
        if slots:
            tgt.animation_data.action_slot = slots[0]
    bpy.context.scene.frame_set(int(local_frame))
    bpy.context.view_layer.update()


def verify_clips(
    mesh: bpy.types.Object,
    tgt: bpy.types.Object,
    donor: bpy.types.Object,
    clip_infos: list[dict],
) -> dict:
    # Mute / hide donor so it cannot drive anything
    donor.hide_viewport = True
    donor.hide_render = True
    if donor.animation_data:
        donor.animation_data.action = None

    report: dict = {"donor_hidden": True, "clips": {}}
    for info in clip_infos:
        name = info["name"]
        n = info["local_frames"]
        samples = sorted({1, max(1, n // 2), n})
        vols = []
        centers = []
        bone_deltas = {}
        # Rest reference
        clear_pose(tgt)
        if tgt.animation_data:
            tgt.animation_data.action = None
        bpy.context.view_layer.update()
        rest_bones = {}
        for rname, bones in REGION_BONES.items():
            pts = []
            for b in bones:
                if b in tgt.pose.bones:
                    pts.append((tgt.matrix_world @ tgt.pose.bones[b].head).copy())
            if pts:
                rest_bones[rname] = sum(pts, Vector()) / len(pts)

        for lf in samples:
            play_action(tgt, info["action"], lf)
            mn, mx, vol = mesh_aabb(mesh)
            vols.append(vol)
            centers.append((mn + mx) * 0.5)
            for rname, bones in REGION_BONES.items():
                pts = []
                for b in bones:
                    if b in tgt.pose.bones:
                        pts.append((tgt.matrix_world @ tgt.pose.bones[b].head).copy())
                if not pts:
                    continue
                c = sum(pts, Vector()) / len(pts)
                d = (c - rest_bones.get(rname, c)).length
                bone_deltas.setdefault(rname, []).append(d)

        # Mesh motion: center travel across samples
        travel = 0.0
        for i in range(1, len(centers)):
            travel += (centers[i] - centers[i - 1]).length
        region_verdict = {}
        for rname, ds in bone_deltas.items():
            mxd = max(ds) if ds else 0.0
            if mxd < 0.002:
                verdict = "broken"
            elif mxd < 0.01:
                verdict = "minor artifacts"
            else:
                verdict = "mesh moves + deforms"
            region_verdict[rname] = {"max_bone_delta_m": round(mxd, 4), "verdict": verdict}

        mesh_moves = travel > 0.005 or (max(vols) / min(vols) > 1.02 if min(vols) > 0 else False)
        report["clips"][name] = {
            "mesh_center_travel_m": round(travel, 4),
            "volume_ratio": round(max(vols) / min(vols), 4) if min(vols) > 0 else None,
            "mesh_animates": mesh_moves,
            "regions": region_verdict,
        }
        log(
            f"verify {name}: travel={travel:.4f} vol_ratio={report['clips'][name]['volume_ratio']} "
            f"mesh_animates={mesh_moves}"
        )

    # Restore NLA for export
    stash_actions_to_nla(tgt, clip_infos)
    return report


def setup_preview_cam() -> bpy.types.Object:
    scene = bpy.context.scene
    for o in list(bpy.data.objects):
        if o.type == "CAMERA" and o.name.startswith("CAM_"):
            bpy.data.objects.remove(o, do_unlink=True)
    cam_data = bpy.data.cameras.new("CAM_bake")
    cam = bpy.data.objects.new("CAM_bake", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (1.6, -2.2, 0.85)
    cam.rotation_euler = (math.radians(72), 0, math.radians(32))
    cam_data.lens = 50
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.72, 0.68, 0.62)
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.image_settings.file_format = "PNG"
    return cam


def render_previews(mesh: bpy.types.Object, tgt: bpy.types.Object, clip_infos: list[dict]) -> None:
    PREV.mkdir(parents=True, exist_ok=True)
    cam = setup_preview_cam()
    for info in clip_infos:
        mid = max(1, info["local_frames"] // 2)
        play_action(tgt, info["action"], mid)
        # Frame camera loosely
        mn, mx, _ = mesh_aabb(mesh)
        center = (mn + mx) * 0.5
        size = (mx - mn).length
        cam.location = center + Vector((size * 1.2, -size * 1.6, size * 0.55))
        direction = center - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        path = PREV / f"{info['name']}_mid.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        log(f"preview {path.name}")
    stash_actions_to_nla(tgt, clip_infos)


def export_character_glb(tgt: bpy.types.Object, mesh: bpy.types.Object, donor: bpy.types.Object) -> None:
    # Hide donor so it is not exported
    donor.hide_viewport = True
    donor.hide_render = True
    donor.hide_select = True
    # Also unlink donor from view layer for export selection
    bpy.ops.object.select_all(action="DESELECT")
    tgt.hide_viewport = False
    mesh.hide_viewport = False
    tgt.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = tgt

    OUT_GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
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
    size_mb = OUT_GLB.stat().st_size / (1024 * 1024)
    log(f"exported character GLB: {OUT_GLB} ({size_mb:.2f} MB)")


def export_clip_glbs(tgt: bpy.types.Object, mesh: bpy.types.Object, clip_infos: list[dict]) -> list[str]:
    """Export armature+mesh per clip as Studio library GLBs (Garg* bone tracks)."""
    if CLIP_DIR.exists():
        # Only clear our WIP dir contents we own
        for p in CLIP_DIR.glob("*.glb"):
            p.unlink()
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for info in clip_infos:
        act = bpy.data.actions.get(info["action"])
        if act is None:
            continue
        # Solo this action on armature (no NLA)
        if not tgt.animation_data:
            tgt.animation_data_create()
        for track in tgt.animation_data.nla_tracks:
            track.mute = True
        tgt.animation_data.action = act
        if hasattr(tgt.animation_data, "action_slot"):
            slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
            if slots:
                tgt.animation_data.action_slot = slots[0]

        bpy.ops.object.select_all(action="DESELECT")
        tgt.select_set(True)
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = tgt
        out = CLIP_DIR / f"{info['name']}.glb"
        bpy.ops.export_scene.gltf(
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
        written.append(str(out.relative_to(ROOT)))
        log(f"clip GLB {out.name} ({out.stat().st_size/1024:.1f} KB)")

    stash_actions_to_nla(tgt, clip_infos)
    return written


def write_report(clip_infos: list[dict], verify: dict, clip_paths: list[str]) -> None:
    payload = {
        "source_blend": str(SRC_BLEND.relative_to(ROOT)),
        "out_blend": str(OUT_BLEND.relative_to(ROOT)),
        "out_glb": str(OUT_GLB.relative_to(ROOT)),
        "clip_dir": str(CLIP_DIR.relative_to(ROOT)),
        "clips": clip_infos,
        "verify": verify,
        "clip_glbs": clip_paths,
        "notes": [
            "Mesh geometry and vertex weights untouched (Part B deferred).",
            "Donor location keys scaled by object scale 0.01 when baking.",
            "Verify ran with donor hidden and no donor action.",
        ],
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2))
    lines = [
        "# Reskin — bake clips onto deform armature",
        "",
        f"- Source (untouched): `{payload['source_blend']}`",
        f"- Working bake blend: `{payload['out_blend']}`",
        f"- Studio character GLB: `{payload['out_glb']}`",
        f"- Native clip GLBs: `{payload['clip_dir']}/`",
        "- Mesh / weights: **unchanged** (Part B deferred)",
        "",
        "## Baked clips",
        "",
        "| Clip | Donor frames | Local frames |",
        "|---|---|---|",
    ]
    for c in clip_infos:
        lines.append(
            f"| {c['name']} | {c['donor_start']}-{c['donor_end']} | {c['local_frames']} |"
        )
    lines += ["", "## Verify (donor hidden)", ""]
    for name, v in verify.get("clips", {}).items():
        lines.append(
            f"### {name} — mesh_animates={v['mesh_animates']} "
            f"(travel={v['mesh_center_travel_m']} m, vol_ratio={v['volume_ratio']})"
        )
        lines.append("")
        lines.append("| Region | Verdict | max bone Δ |")
        lines.append("|---|---|---|")
        for r, d in v["regions"].items():
            lines.append(f"| {r} | {d['verdict']} | {d['max_bone_delta_m']} m |")
        lines.append("")
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")


def main() -> int:
    if not SRC_BLEND.is_file():
        log(f"missing source {SRC_BLEND}")
        return 1

    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC_BLEND, OUT_BLEND)
    log(f"copied → {OUT_BLEND}")

    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    tgt = bpy.data.objects.get("ARM_GargoyleNative")
    donor = bpy.data.objects.get("GargoyleAnimDonor")
    mesh = bpy.data.objects.get("SM_WingedMonkey_reskin")
    if not tgt or not donor or not mesh:
        raise RuntimeError("Expected ARM_GargoyleNative, GargoyleAnimDonor, SM_WingedMonkey_reskin")

    # Sanity: do not touch weights
    n_vg = len(mesh.vertex_groups)
    n_vert = len(mesh.data.vertices)
    log(f"mesh intact: verts={n_vert} vgroups={n_vg} (will not modify)")

    ensure_donor_evaluates(donor)
    bpy.context.scene.render.fps = 30

    # Remove any prior baked actions we may re-run against
    for name, _, _ in BAKE_CLIPS:
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)

    clip_infos = []
    for name, f0, f1 in BAKE_CLIPS:
        clip_infos.append(bake_clip(donor, tgt, name, f0, f1))

    stash_actions_to_nla(tgt, clip_infos)
    verify = verify_clips(mesh, tgt, donor, clip_infos)
    render_previews(mesh, tgt, clip_infos)

    # Drop leftover helper mesh if present
    ico = bpy.data.objects.get("Icosphere")
    if ico:
        bpy.data.objects.remove(ico, do_unlink=True)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    log(f"saved {OUT_BLEND}")

    export_character_glb(tgt, mesh, donor)
    clip_paths = export_clip_glbs(tgt, mesh, clip_infos)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    write_report(clip_infos, verify, clip_paths)
    log("DONE")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        log(f"FATAL: {e}")
        raise
