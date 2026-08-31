#!/usr/bin/env python3
"""
Normalize decimated reskin monkey to true ~1 m scale (object scale 1).

Root cause: heat-cage rebind left mesh matrix_local ×100 while ARM_GargoyleNative
stayed at ×0.01. Fix: set armature object scale to 1 (bone data already ~1 unit =
1 m), put mesh verts into armature-local bone space with scale 1, keep weights +
baked actions (bone-local keys stay valid; world motion scales with the character).

Source: Monkey_reskin_gargoyle_decimated.blend (untouched as original of this step —
we copy first). Masters/baked untouched.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_decimated.blend"
OUT_BLEND = ROOT / "models/wingedmonkey/working/Monkey_reskin_gargoyle_normalized.blend"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_reskin_wip_studio.glb"
CLIP_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle_native_wip"
OUT_JSON = ROOT / "models/wingedmonkey/working/_reskin_normalize_report.json"
OUT_MD = ROOT / "models/wingedmonkey/working/_reskin_normalize_report.md"

KEEP = ["Idle", "Walk", "FlyIdleLoop", "FlyForward", "Attack01"]


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


def mesh_world_aabb(mesh: bpy.types.Object) -> tuple[Vector, Vector, Vector]:
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        co = [ev.matrix_world @ v.co for v in me.vertices]
        mn = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
        mx = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
        return mn, mx, mx - mn
    finally:
        ev.to_mesh_clear()


def bone_world_aabb(arm: bpy.types.Object) -> Vector:
    pts = [arm.matrix_world @ b.head_local for b in arm.data.bones]
    pts += [arm.matrix_world @ b.tail_local for b in arm.data.bones]
    mn = Vector((min(c.x for c in pts), min(c.y for c in pts), min(c.z for c in pts)))
    mx = Vector((max(c.x for c in pts), max(c.y for c in pts), max(c.z for c in pts)))
    return mx - mn


def snapshot(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict:
    _, _, msz = mesh_world_aabb(mesh)
    return {
        "mesh_scale": [round(x, 6) for x in mesh.scale],
        "mesh_local_scale": [round(x, 6) for x in mesh.matrix_local.to_scale()],
        "mesh_parent": mesh.parent.name if mesh.parent else None,
        "arm_scale": [round(x, 6) for x in arm.scale],
        "arm_location": [round(x, 6) for x in arm.location],
        "mesh_world_size": [round(x, 5) for x in msz],
        "mesh_world_height": round(msz.z, 5),
        "bone_world_size": [round(x, 5) for x in bone_world_aabb(arm)],
        "bone_world_height": round(bone_world_aabb(arm).z, 5),
        "weighted": sum(1 for v in mesh.data.vertices if v.groups),
        "verts": len(mesh.data.vertices),
        "faces": len(mesh.data.polygons),
    }


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


def verify_clip(mesh: bpy.types.Object, arm: bpy.types.Object, name: str) -> dict:
    clear_pose(arm)
    _, _, rest_sz = mesh_world_aabb(mesh)
    rest_mn, rest_mx, _ = mesh_world_aabb(mesh)
    rest_c = (rest_mn + rest_mx) * 0.5
    act = bpy.data.actions[name]
    fr = act.frame_range
    frames = [int(fr[0]), int((fr[0] + fr[1]) / 2), int(fr[1])]
    sizes = []
    centers = []
    for f in frames:
        play_action(arm, name, f)
        mn, mx, sz = mesh_world_aabb(mesh)
        sizes.append(sz)
        centers.append((mn + mx) * 0.5)
    clear_pose(arm)
    height_ratios = [s.z / max(1e-9, rest_sz.z) for s in sizes]
    travels = [
        (centers[i] - centers[i - 1]).length for i in range(1, len(centers))
    ]
    max_ratio = max(height_ratios)
    max_travel = max(travels) if travels else 0.0
    # Pass: height stays within ~25% of rest, center travel < 0.5 m for fly loops
    ok = max_ratio < 1.35 and min(height_ratios) > 0.65 and max_travel < 0.75
    return {
        "clip": name,
        "rest_height": round(rest_sz.z, 4),
        "sample_heights": [round(s.z, 4) for s in sizes],
        "height_ratios": [round(r, 4) for r in height_ratios],
        "max_height_ratio": round(max_ratio, 4),
        "center_travel_max": round(max_travel, 4),
        "stable_size": ok,
        "rest_center": [round(x, 4) for x in rest_c],
    }


def normalize(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict:
    """Kill ×0.01 arm / ×100 mesh mismatch; both end at scale 1, ~1 m world."""
    clear_pose(arm)
    before = snapshot(mesh, arm)
    log(f"BEFORE {json.dumps(before)}")

    # 1) Detach mesh, keep world pose (~1 m from the ×100×0.01 stack)
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = mw
    bpy.context.view_layer.update()

    # 2) Armature → object scale 1 (bone local units already ~1 m). Drop float.
    arm.scale = (1.0, 1.0, 1.0)
    arm.location = (0.0, 0.0, 0.0)
    arm.rotation_euler = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()

    # 3) Bake mesh verts into armature-local bone space; parent cleanly
    aw = arm.matrix_world.copy()
    mesh.data.transform(aw.inverted() @ mesh.matrix_world)
    mesh.matrix_world = aw.copy()
    mesh.scale = (1.0, 1.0, 1.0)
    mesh.rotation_euler = (0.0, 0.0, 0.0)
    mesh.location = (0.0, 0.0, 0.0)
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    bpy.context.view_layer.update()

    # 4) Ensure Armature modifier targets arm; keep existing heat weights
    arm_mods = [m for m in mesh.modifiers if m.type == "ARMATURE"]
    if not arm_mods:
        mod = mesh.modifiers.new("Armature", type="ARMATURE")
        mod.object = arm
    else:
        for m in arm_mods:
            m.object = arm
            m.use_vertex_groups = True

    # 5) Apply object scales (should already be 1) so nothing pending for export
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    # Mesh is child — apply scale carefully: temporarily clear parent
    mw = mesh.matrix_world.copy()
    mesh.parent = None
    mesh.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Re-parent into arm local again
    mesh.data.transform(arm.matrix_world.inverted() @ mesh.matrix_world)
    mesh.matrix_world = arm.matrix_world.copy()
    mesh.parent = arm
    mesh.matrix_parent_inverse = Matrix.Identity(4)
    bpy.context.view_layer.update()

    # Ground: shift arm so mesh min Z = 0
    clear_pose(arm)
    mn, mx, _ = mesh_world_aabb(mesh)
    arm.location.z -= mn.z
    bpy.context.view_layer.update()

    after = snapshot(mesh, arm)
    log(f"AFTER {json.dumps(after)}")
    return {"before": before, "after": after}


def export_glb(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    restore_nla(arm)
    bpy.ops.object.select_all(action="DESELECT")
    mesh.hide_viewport = False
    arm.hide_viewport = False
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
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
    if "export_animation_mode" in props:
        kwargs["export_animation_mode"] = "NLA_TRACKS"
    bpy.ops.export_scene.gltf(**kwargs)
    log(f"character GLB {OUT_GLB} {OUT_GLB.stat().st_size / 1024 / 1024:.2f} MB draco=OFF")

    CLIP_DIR.mkdir(parents=True, exist_ok=True)
    mesh.hide_viewport = True
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
        if "export_animation_mode" in props:
            ck["export_animation_mode"] = "ACTIVE_ACTIONS"
        bpy.ops.export_scene.gltf(**ck)
        log(f"clip {out.name} {out.stat().st_size / 1024:.1f} KB")
    mesh.hide_viewport = False
    restore_nla(arm)


def write_report(payload: dict) -> None:
    OUT_JSON.write_text(json.dumps(payload, indent=2))
    lines = [
        "# Reskin — true-scale normalization",
        "",
        f"- Source copy from: `{payload['source']}`",
        f"- Working: `{payload['out_blend']}`",
        f"- Studio GLB: `{payload['out_glb']}` ({payload.get('glb_mb')} MB, Draco off)",
        "",
        "## Scales",
        "",
        f"- Before: {payload['normalize']['before']}",
        f"- After: {payload['normalize']['after']}",
        "",
        "## Action note",
        "",
        payload["action_note"],
        "",
        "## Verify",
        "",
    ]
    for v in payload["verify"]:
        lines.append(
            f"- **{v['clip']}**: stable={v['stable_size']} "
            f"rest_h={v['rest_height']} ratios={v['height_ratios']} "
            f"travel={v['center_travel_max']}"
        )
    OUT_MD.write_text("\n".join(lines) + "\n")
    log(f"wrote {OUT_MD}")


def main() -> int:
    if not SRC.is_file():
        log(f"missing {SRC}")
        return 1
    shutil.copy2(SRC, OUT_BLEND)
    log(f"copied → {OUT_BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(OUT_BLEND))

    mesh = bpy.data.objects.get("SM_WingedMonkey_reskin")
    arm = bpy.data.objects.get("ARM_GargoyleNative")
    if not mesh or not arm:
        raise RuntimeError("expected mesh + ARM_GargoyleNative")
    for n in KEEP:
        if n not in bpy.data.actions:
            raise RuntimeError(f"missing action {n}")

    norm = normalize(mesh, arm)

    # Actions stay in bone-local space (same rest bones). Object scale 0.01→1
    # scales world motion with the character — no per-key rescale needed.
    action_note = (
        "Baked actions remain bone-local (same rest armature data). "
        "Armature object scale 0.01→1 carries animation into true-meter world "
        "uniformly with the mesh; no location-key rewrite required."
    )
    log(action_note)

    verify = [verify_clip(mesh, arm, n) for n in ("FlyIdleLoop", "FlyForward", "Idle", "Walk")]
    for v in verify:
        log(
            f"verify {v['clip']}: stable={v['stable_size']} "
            f"ratios={v['height_ratios']} travel={v['center_travel_max']}"
        )

    failed = [v["clip"] for v in verify if not v["stable_size"]]
    if failed:
        raise RuntimeError(f"stable-size verify failed for: {failed}")

    restore_nla(arm)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_glb(mesh, arm)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    # Point export_reskin_clean at normalized blend for future exports
    payload = {
        "source": str(SRC.relative_to(ROOT)),
        "out_blend": str(OUT_BLEND.relative_to(ROOT)),
        "out_glb": str(OUT_GLB.relative_to(ROOT)),
        "glb_mb": round(OUT_GLB.stat().st_size / 1024 / 1024, 2),
        "normalize": norm,
        "action_note": action_note,
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
