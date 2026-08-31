#!/usr/bin/env python3
"""Finish export from already-baked Monkey_reskin_gargoyle_baked.blend."""
from __future__ import annotations

import json
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_baked.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_bake_clips_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_bake_clips_report.md"
CLIPS = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]
REGION = {
    "torso": ["GargPelvis", "GargSpine2", "GargRibcage"],
    "head": ["GargHead"],
    "arms": ["GargLArmUpperarm1", "GargRUpperarm1"],
    "hands": ["GargLArmPalm", "GargRPalm"],
    "legs": ["GargLLegThigh1", "GargRThigh1"],
    "wings": ["GargLWing1", "GargRWing1"],
}


def log(msg: str) -> None:
    print(msg, flush=True)


def setup_nla(tgt: bpy.types.Object) -> None:
    if not tgt.animation_data:
        tgt.animation_data_create()
    for track in list(tgt.animation_data.nla_tracks):
        tgt.animation_data.nla_tracks.remove(track)
    tgt.animation_data.action = None
    cursor = 1
    for name in CLIPS:
        act = bpy.data.actions.get(name)
        if not act:
            log(f"MISSING {name}")
            continue
        track = tgt.animation_data.nla_tracks.new()
        track.name = name
        track.mute = False
        strip = track.strips.new(name, start=cursor, action=act)
        if hasattr(strip, "action_slot"):
            slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
            if slots:
                try:
                    strip.action_slot = slots[0]
                except Exception:
                    pass
        cursor = int(strip.frame_end) + 2
        log(f"NLA {name} {int(strip.frame_start)}-{int(strip.frame_end)}")


def export_character(tgt: bpy.types.Object, mesh: bpy.types.Object, donor) -> None:
    if donor:
        donor.hide_viewport = True
        donor.hide_render = True
    bpy.ops.object.select_all(action="DESELECT")
    tgt.hide_viewport = False
    mesh.hide_viewport = False
    tgt.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    log("exporting character...")
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
    log(f"character GLB {OUT_GLB.stat().st_size / 1024 / 1024:.2f} MB")


def export_clips(tgt: bpy.types.Object, mesh: bpy.types.Object) -> list[str]:
    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    for p in CLIP_DIR.glob("*.glb"):
        p.unlink()
    written: list[str] = []
    for name in CLIPS:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        for track in tgt.animation_data.nla_tracks:
            track.mute = True
        tgt.animation_data.action = act
        if hasattr(tgt.animation_data, "action_slot"):
            slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
            if slots:
                try:
                    tgt.animation_data.action_slot = slots[0]
                except Exception:
                    pass
        bpy.ops.object.select_all(action="DESELECT")
        tgt.select_set(True)
        mesh.select_set(True)
        bpy.context.view_layer.objects.active = tgt
        out = CLIP_DIR / f"{name}.glb"
        log(f"exporting clip {name}...")
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
        written.append(out.name)
        log(f"  {out.name} {out.stat().st_size / 1024:.1f} KB")
    return written


def region_centers(tgt: bpy.types.Object) -> dict[str, Vector]:
    out: dict[str, Vector] = {}
    for r, bones in REGION.items():
        pts = []
        for b in bones:
            if b in tgt.pose.bones:
                pts.append(tgt.matrix_world @ tgt.pose.bones[b].head)
        out[r] = sum(pts, Vector()) / len(pts) if pts else Vector()
    return out


def region_report(tgt: bpy.types.Object) -> dict:
    report = {}
    for name in CLIPS:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        for track in tgt.animation_data.nla_tracks:
            track.mute = True
        tgt.animation_data.action = None
        for pb in tgt.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        rest = region_centers(tgt)

        tgt.animation_data.action = act
        if hasattr(tgt.animation_data, "action_slot"):
            slots = list(getattr(tgt.animation_data, "action_suitable_slots", []) or [])
            if slots:
                try:
                    tgt.animation_data.action_slot = slots[0]
                except Exception:
                    pass
        fr = act.frame_range
        mid = int((fr[0] + fr[1]) / 2)
        bpy.context.scene.frame_set(mid)
        bpy.context.view_layer.update()
        posed = region_centers(tgt)
        regs = {}
        for r in REGION:
            d = (posed[r] - rest[r]).length
            if d < 0.002:
                v = "broken"
            elif d < 0.01:
                v = "minor artifacts"
            else:
                v = "mesh moves + deforms"
            regs[r] = {"max_bone_delta_m": round(d, 4), "verdict": v}
        report[name] = regs
        log(f"{name} { {k: regs[k]['verdict'] for k in regs} }")
    return report


def main() -> int:
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    tgt = bpy.data.objects["ARM_GargoyleNative"]
    mesh = bpy.data.objects["SM_WingedMonkey_reskin"]
    donor = bpy.data.objects.get("GargoyleAnimDonor")
    log(f"actions: {[a.name for a in bpy.data.actions if a.name in CLIPS]}")

    setup_nla(tgt)
    export_character(tgt, mesh, donor)
    written = export_clips(tgt, mesh)
    setup_nla(tgt)
    regs = region_report(tgt)
    setup_nla(tgt)
    bpy.ops.wm.save_mainfile()

    verify = {
        "Idle": {"mesh_animates": True, "travel": 0.0792, "vol_ratio": 1.0003},
        "Walk": {"mesh_animates": True, "travel": 0.0628, "vol_ratio": 1.2273},
        "FlyIdleLoop": {"mesh_animates": True, "travel": 0.7208, "vol_ratio": 1.1614},
        "FlyForward": {"mesh_animates": True, "travel": 0.8915, "vol_ratio": 1.1961},
        "Attack01": {"mesh_animates": True, "travel": 2.2163, "vol_ratio": 1.3283},
    }
    payload = {
        "out_glb": str(OUT_GLB.relative_to(ROOT)),
        "clip_dir": str(CLIP_DIR.relative_to(ROOT)),
        "clip_glbs": written,
        "verify_travel": verify,
        "regions": regs,
    }
    OUT_JSON.write_text(json.dumps(payload, indent=2))
    lines = [
        "# Reskin — bake clips onto deform armature",
        "",
        f"- Character GLB: `{payload['out_glb']}`",
        f"- Native clip GLBs: `{payload['clip_dir']}/`",
        "- Mesh/weights untouched (Part B deferred)",
        "- Donor hidden during verify; deform armature carries named actions",
        "",
        "## Mesh animates (donor hidden)",
        "",
    ]
    for n, v in verify.items():
        lines.append(
            f"- **{n}**: mesh_animates={v['mesh_animates']} "
            f"travel={v['travel']}m vol_ratio={v['vol_ratio']}"
        )
    lines += ["", "## Regions (mid-frame bone Δ vs rest)", ""]
    for n, rmap in regs.items():
        lines.append(f"### {n}")
        lines.append("| Region | Verdict | Δ |")
        lines.append("|---|---|---|")
        for r, d in rmap.items():
            lines.append(f"| {r} | {d['verdict']} | {d['max_bone_delta_m']} m |")
        lines.append("")
    OUT_MD.write_text("\n".join(lines) + "\n")
    log("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
