#!/usr/bin/env python3
"""
Verdict B fix: bake a constant world-+X limb counter-pose into key clips so
arms/legs read naturally under the upright (de-hunched) torso.

- Copy from dehunch working blend; masters / dehunch source untouched until we
  write the new limbs working file.
- Limb roots only: thighs + collarbones (children inherit; motion preserved).
- Orientation-only about each bone head — do NOT move hip/shoulder sockets.
- Do NOT touch GargPelvis keys or any vertex weights.
"""
from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_dehunch.blend"
PRE = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_feet_flyidle.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_limbs.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_limb_counter_report.md"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_limb_counter_report.json"
SPRITE_DIR = ROOT / "models/wingedmonkey/working/_limb_counter_sprites"

# Per-bone world-+X orientation counters (degrees).
# Arms: exact inverse of pelvis de-hunch. Legs on hover/idle loops: PRE-restore
# plus aesthetic so thighs hang/tuck under upright torso (not horizontal-back).
COUNTERS_DEFAULT = {
    "GargLArmCollarbone": 37.3,
    "GargRCollarbone": 37.3,
    "GargLLegThigh1": 55.0,
    "GargRThigh1": 55.0,
}
# Attack mid-frame thighs already near-natural — use pure PRE-restore only.
COUNTERS_ATTACK = {
    "GargLArmCollarbone": 37.3,
    "GargRCollarbone": 37.3,
    "GargLLegThigh1": 37.3,
    "GargRThigh1": 37.3,
}

LIMB_ROOTS = list(COUNTERS_DEFAULT.keys())

# Key clips first; Attack01 included as quick follow-on.
TARGET_CLIPS = ["Idle", "FlyIdleLoop", "FlyForward", "Attack01"]

AIM_BONES = [
    "GargLLegThigh1",
    "GargRThigh1",
    "GargLArmUpperarm1",
    "GargRUpperarm1",
    "GargLLegCalf1",
    "GargRCalf1",
    "GargLArmForearm1",
    "GargRForearm1",
]

ALL_KEEP = [
    "Idle",
    "Walk",
    "FlyIdleLoop",
    "FlyForward",
    "Attack01",
    "IdleToFly",
    "FlyToIdle",
    "FlyAttack02",
    "FlyHit",
    "Hit",
]


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


def body_pitch_deg(arm: bpy.types.Object) -> float:
    pel = bone_world_matrix(arm, "GargPelvis").translation
    head = bone_world_matrix(arm, "GargHead").translation
    d = (head - pel).normalized()
    return math.degrees(math.atan2(-d.y, d.z))


def bone_aim_stats(arm: bpy.types.Object, name: str) -> dict:
    """Bone +Y world aim vs world −Z (down) and +Y (forward)."""
    m = bone_world_matrix(arm, name)
    aim = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    down = Vector((0, 0, -1))
    fwd = Vector((0, 1, 0))
    from_down = math.degrees(aim.angle(down))
    from_fwd = math.degrees(aim.angle(fwd))
    return {
        "aim": [round(aim.x, 4), round(aim.y, 4), round(aim.z, 4)],
        "from_down": round(from_down, 2),
        "from_fwd": round(from_fwd, 2),
    }


def snapshot_weights(mesh: bpy.types.Object) -> dict:
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


def _remove_bone_fcurves(action: bpy.types.Action, bone: str) -> None:
    needle = f'pose.bones["{bone}"]'
    for fc in list(get_fcurves(action)):
        if needle not in fc.data_path:
            continue
        if "location" not in fc.data_path and "rotation" not in fc.data_path:
            continue
        try:
            action.fcurves.remove(fc)
        except Exception:
            for layer in getattr(action, "layers", []) or []:
                for strip in layer.strips:
                    for cb in getattr(strip, "channelbags", []) or []:
                        if fc in list(cb.fcurves):
                            cb.fcurves.remove(fc)


def set_bone_world_orient(arm: bpy.types.Object, name: str, world_quat: Quaternion) -> None:
    """Set world orientation; keep current world translation + scale."""
    pb = arm.pose.bones[name]
    cur = bone_world_matrix(arm, name)
    target = Matrix.LocRotScale(cur.translation, world_quat, cur.to_scale())
    pb.matrix = arm.matrix_world.inverted() @ target
    bpy.context.view_layer.update()


def apply_counter_frame(
    arm: bpy.types.Object, counters: dict[str, float]
) -> dict[str, tuple]:
    """Compose per-bone world-+X counters into limb-root orientations."""
    out = {}
    for name, deg in counters.items():
        pb = arm.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        counter_q = Quaternion(Vector((1, 0, 0)), math.radians(deg))
        cur_q = bone_world_matrix(arm, name).to_quaternion()
        set_bone_world_orient(arm, name, counter_q @ cur_q)
        out[name] = (pb.location.copy(), pb.rotation_quaternion.copy())
    return out


def bake_clip(arm: bpy.types.Object, name: str, counters: dict[str, float]) -> dict:
    act = bpy.data.actions[name]
    f0, f1 = action_frame_range(act)
    mid = (f0 + f1) // 2
    play_action(arm, name, mid)
    pitch_before = body_pitch_deg(arm)
    aim_before = {b: bone_aim_stats(arm, b) for b in AIM_BONES}

    frames: list[tuple[int, dict]] = []
    for fr in range(f0, f1 + 1):
        play_action(arm, name, fr)
        frames.append((fr, apply_counter_frame(arm, counters)))

    for bone in counters:
        _remove_bone_fcurves(act, bone)

    play_action(arm, name, f0)
    for fr, poses in frames:
        for bone, (loc, quat) in poses.items():
            pb = arm.pose.bones[bone]
            pb.rotation_mode = "QUATERNION"
            pb.location = loc
            pb.rotation_quaternion = quat
            pb.keyframe_insert(data_path="location", frame=fr)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=fr)

    play_action(arm, name, mid)
    pitch_after = body_pitch_deg(arm)
    aim_after = {b: bone_aim_stats(arm, b) for b in AIM_BONES}
    log(
        f"counter {name}: pitch {pitch_before:.1f}→{pitch_after:.1f} "
        f"(Δ{pitch_after - pitch_before:.2f}) frames {f0}-{f1} "
        f"thighL {aim_before['GargLLegThigh1']['from_down']}→"
        f"{aim_after['GargLLegThigh1']['from_down']}"
    )
    return {
        "frames": f1 - f0 + 1,
        "counters": counters,
        "pitch_before": round(pitch_before, 2),
        "pitch_after": round(pitch_after, 2),
        "aim_before": aim_before,
        "aim_after": aim_after,
    }


def measure_pre_aims() -> dict:
    """Load PRE blend briefly via temporary open — caller must restore OUT_BLEND."""
    bpy.ops.wm.open_mainfile(filepath=str(PRE))
    arm = bpy.data.objects["ARM_GargoyleNative"]
    out = {}
    for name in TARGET_CLIPS:
        if name not in bpy.data.actions:
            continue
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        mid = (f0 + f1) // 2
        play_action(arm, name, mid)
        out[name] = {
            "pitch": round(body_pitch_deg(arm), 2),
            "aims": {b: bone_aim_stats(arm, b) for b in AIM_BONES},
        }
    return out


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


def export_studio(arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    donor = bpy.data.objects.get("GargoyleAnimDonor")
    if donor:
        bpy.data.objects.remove(donor, do_unlink=True)
    keep = set(ALL_KEEP)
    for act in list(bpy.data.actions):
        if act.name not in keep:
            bpy.data.actions.remove(act)
    stash_nla(arm, ALL_KEEP)

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
        export_skins=True,
        export_morph=True,
        export_draco_mesh_compression_enable=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop("export_anim_single_armature", None)
        bpy.ops.export_scene.gltf(**kwargs)
    size = OUT_GLB.stat().st_size / (1024 * 1024)
    log(f"exported {OUT_GLB} ({size:.1f} MB)")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    for name in ALL_KEEP:
        act = bpy.data.actions.get(name)
        if not act:
            continue
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
        out = CLIP_DIR / f"{name}.glb"
        bpy.ops.object.select_all(action="DESELECT")
        mesh.select_set(True)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        ck = dict(
            filepath=str(out),
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_animations=True,
            export_nla_strips=False,
            export_cameras=False,
            export_lights=False,
            export_skins=True,
            export_draco_mesh_compression_enable=False,
        )
        try:
            bpy.ops.export_scene.gltf(**ck)
        except TypeError:
            bpy.ops.export_scene.gltf(**ck)
        log(f"clip {out.name}")


def ensure_camera_sprite(arm: bpy.types.Object) -> None:
    scene = bpy.context.scene
    cam = scene.camera
    if cam is None:
        cams = [o for o in bpy.data.objects if o.type == "CAMERA"]
        if cams:
            cam = cams[0]
            scene.camera = cam
        else:
            data = bpy.data.cameras.new("CAM_sprite")
            cam = bpy.data.objects.new("CAM_sprite", data)
            bpy.context.collection.objects.link(cam)
            scene.camera = cam
    # Side-ish hero framing for limb read
    mid = bone_world_matrix(arm, "GargRibcage").translation
    cam.location = (mid.x + 2.2, mid.y - 2.8, mid.z + 0.4)
    direction = mid - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    if hasattr(cam.data, "lens"):
        cam.data.lens = 50


def render_sprites(arm: bpy.types.Object, mesh: bpy.types.Object) -> list[str]:
    SPRITE_DIR.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except (TypeError, ValueError):
        scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 16
    scene.render.resolution_x = 128
    scene.render.resolution_y = 128
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True
    ensure_camera_sprite(arm)
    mesh.hide_render = False
    paths = []
    for name in ["Idle", "FlyIdleLoop", "FlyForward"]:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        f0, f1 = action_frame_range(act)
        mid = (f0 + f1) // 2
        play_action(arm, name, mid)
        ensure_camera_sprite(arm)
        path = SPRITE_DIR / f"{name}_128px.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(str(path))
        log(f"sprite {path}")
    return paths


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"missing source {SRC}")
    if OUT_BLEND.resolve() == SRC.resolve():
        raise SystemExit("refusing to overwrite dehunch source in place")

    log("=== measure PRE limb aims (feet_flyidle) ===")
    pre_aims = measure_pre_aims()

    log(f"=== copy {SRC.name} → {OUT_BLEND.name} ===")
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SRC, OUT_BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    arm = bpy.data.objects["ARM_GargoyleNative"]
    mesh = bpy.data.objects["SM_WingedMonkey_reskin"]
    for name in LIMB_ROOTS:
        if name not in arm.pose.bones:
            raise RuntimeError(f"missing limb bone {name}")

    w_before = snapshot_weights(mesh)
    log(f"weights before: {w_before}")

    # Pelvis pitch baseline on target clips (must stay unchanged)
    pitch_guard = {}
    for name in TARGET_CLIPS:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        f0, f1 = action_frame_range(act)
        play_action(arm, name, (f0 + f1) // 2)
        pitch_guard[name] = body_pitch_deg(arm)

    log(
        f"=== bake limb counters on {LIMB_ROOTS} for {TARGET_CLIPS} ==="
    )
    clip_reports = {}
    for name in TARGET_CLIPS:
        if name not in bpy.data.actions:
            log(f"skip missing {name}")
            continue
        counters = COUNTERS_ATTACK if name == "Attack01" else COUNTERS_DEFAULT
        log(f"  {name} counters={counters}")
        clip_reports[name] = bake_clip(arm, name, counters)

    # Verify pelvis pitch unchanged
    pitch_ok = {}
    for name, before in pitch_guard.items():
        act = bpy.data.actions[name]
        f0, f1 = action_frame_range(act)
        play_action(arm, name, (f0 + f1) // 2)
        after = body_pitch_deg(arm)
        pitch_ok[name] = {
            "before": round(before, 2),
            "after": round(after, 2),
            "delta": round(after - before, 3),
            "ok": abs(after - before) < 0.15,
        }
        log(f"pelvis pitch guard {name}: {before:.2f}→{after:.2f}")

    w_after = snapshot_weights(mesh)
    weights_ok = (
        w_before["top_hash"] == w_after["top_hash"]
        and w_before["weight_sum"] == w_after["weight_sum"]
        and w_before["wing_share"] == w_after["wing_share"]
        and w_before["foot_share"] == w_after["foot_share"]
        and w_before["head_share"] == w_after["head_share"]
        and w_before["torso_share"] == w_after["torso_share"]
    )
    log(f"weights after unchanged={weights_ok}")
    if not weights_ok:
        raise RuntimeError("weights changed — aborting")
    if not all(v["ok"] for v in pitch_ok.values()):
        raise RuntimeError(f"pelvis pitch drifted: {pitch_ok}")

    clear_pose(arm)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    log(f"saved {OUT_BLEND}")

    log("=== sprite-size renders (~128px) ===")
    sprite_paths = render_sprites(arm, mesh)

    log("=== export uncompressed Studio GLB + clips ===")
    # reload clean after render side-effects
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))
    arm = bpy.data.objects["ARM_GargoyleNative"]
    mesh = bpy.data.objects["SM_WingedMonkey_reskin"]
    export_studio(arm, mesh)

    report = {
        "counters_default": COUNTERS_DEFAULT,
        "counters_attack": COUNTERS_ATTACK,
        "limb_roots": LIMB_ROOTS,
        "clips": TARGET_CLIPS,
        "pre_aims": pre_aims,
        "clip_reports": clip_reports,
        "pelvis_pitch_guard": pitch_ok,
        "weights_before": w_before,
        "weights_after": w_after,
        "weights_unchanged": weights_ok,
        "sprites": sprite_paths,
        "out_blend": str(OUT_BLEND),
        "out_glb": str(OUT_GLB),
        "glb_mb": round(OUT_GLB.stat().st_size / (1024 * 1024), 2),
    }
    OUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        "# Reskin limb counter-pose (verdict B)",
        "",
        f"- Default counters: `{COUNTERS_DEFAULT}`",
        f"- Attack01 counters: `{COUNTERS_ATTACK}`",
        f"- Clips: {', '.join(TARGET_CLIPS)}",
        f"- Pelvis de-hunch untouched: {all(v['ok'] for v in pitch_ok.values())}",
        f"- Weights untouched: {weights_ok}",
        f"- Working blend: `{OUT_BLEND}`",
        f"- Studio GLB: `{OUT_GLB}` ({report['glb_mb']} MB, no Draco)",
        "",
        "## Idle mid-frame limb aim (from_down °)",
        "",
        "| Bone | PRE (hunched torso) | POST dehunch (before) | AFTER counter |",
        "|------|---------------------|------------------------|---------------|",
    ]
    idle_pre = pre_aims.get("Idle", {}).get("aims", {})
    idle_rep = clip_reports.get("Idle", {})
    for b in AIM_BONES:
        pre_v = idle_pre.get(b, {}).get("from_down", "—")
        bef = idle_rep.get("aim_before", {}).get(b, {}).get("from_down", "—")
        aft = idle_rep.get("aim_after", {}).get(b, {}).get("from_down", "—")
        lines.append(f"| {b} | {pre_v} | {bef} | {aft} |")
    lines += ["", "## Sprites", ""] + [f"- `{p}`" for p in sprite_paths]
    OUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"report {OUT_MD}")
    log("DONE limb counter-pose")


if __name__ == "__main__":
    main()
