#!/usr/bin/env python3
"""
Rebake Gargoyle→monkey clips using local matrix_basis copy (NOT world Copy Rotation).

World Copy Rotation after fit_proportions balls the character: fitted bone axes ≠
source axes, so matching world rotations folds the mesh. Local basis channels from
the FBX Take are the authored animation; copying them onto the fitted bind preserves
motion without fighting rest axes.

Also:
  - Fixes disconnected wing tip bones (Digit2) to continue from Digit1 → mesh tip
  - Exports anim-only GLBs (no skins/mesh) so Three.js locals match the character bind
  - Re-exports the skinned character

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/rebake_gargoyle_monkey_clips.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle"
SRC_RIGGED = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"

# Keep in sync with transplant_gargoyle_armature_to_monkey.py
CLIPS: list[tuple[str, int, int]] = [
    ("Tpose", 0, 5),
    ("Idle", 80, 190),
    ("IdleBreak", 200, 340),
    ("Walk", 360, 390),
    ("Attack01", 410, 470),
    ("Cast01", 470, 545),
    ("Cast02", 545, 570),
    ("Cast03", 570, 608),
    ("Sheild01", 610, 630),
    ("Sheild02", 630, 680),
    ("Sheild03", 680, 700),
    ("Attack02", 720, 785),
    ("Hit", 800, 885),
    ("DeathStanding", 900, 940),
    ("Statue01", 964, 966),
    ("Statue02", 984, 987),
    ("Statue03", 1004, 1006),
    ("GroundToFly", 1140, 1179),
    ("FlyForward", 1180, 1210),
    ("FlyToIdle", 1240, 1300),
    ("FlyIdleLoop", 1305, 1335),
    ("IdleToFly", 1330, 1390),
    ("FlyAttack01", 1410, 1490),
    ("FlyAttack02", 1520, 1600),
    ("FlyCast", 1620, 1735),
    ("DieFly", 1750, 1850),
    ("FlyLand", 1870, 1900),
    ("FlyBackward", 1930, 1960),
    ("FlyHit", 1990, 2065),
    ("WalkBackward", 2120, 2160),
]

WING_TIPS = {
    "L": ("GargLWingLDigit1", "GargLWingLDigit2"),
    "R": ("GargRWingRDigit1", "GargRWingRDigit2"),
}


def action_fcurves(action: bpy.types.Action):
    if hasattr(action, "layers") and action.layers:
        for layer in action.layers:
            for strip in getattr(layer, "strips", []) or []:
                for bag in getattr(strip, "channelbags", []) or []:
                    yield from getattr(bag, "fcurves", []) or []
        return
    yield from getattr(action, "fcurves", []) or []


def action_fcurve_count(action: bpy.types.Action) -> int:
    return sum(1 for _ in action_fcurves(action))


def retime_action_to_zero(action: bpy.types.Action, frame_start: int, frame_end: int) -> None:
    offset = -float(frame_start)
    for fcu in action_fcurves(action):
        for kp in fcu.keyframe_points:
            kp.co[0] += offset
            kp.handle_left[0] += offset
            kp.handle_right[0] += offset
        fcu.update()
    action.use_frame_range = True
    action.frame_start = 0
    action.frame_end = max(0, frame_end - frame_start)


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def world_head(arm: bpy.types.Object, name: str) -> Vector:
    b = arm.data.bones[name]
    return arm.matrix_world @ b.head_local


def world_tail(arm: bpy.types.Object, name: str) -> Vector:
    b = arm.data.bones[name]
    return arm.matrix_world @ b.tail_local


def mesh_wing_tip(mesh: bpy.types.Object, side: str, root: Vector) -> Vector:
    """Farthest vertex from wing root in the upper band, favoring lateral |x|."""
    coords = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    zs = [c.z for c in coords]
    z_cut = min(zs) + 0.55 * (max(zs) - min(zs))
    best = None
    best_score = -1.0
    for p in coords:
        if p.z < z_cut:
            continue
        if side == "L" and p.x < 0.05:
            continue
        if side == "R" and p.x > -0.05:
            continue
        # Prefer high lateral reach near shoulder height (reject hands/feet).
        score = abs(p.x) * 3.0 + 0.5 * p.z + 0.2 * (p - root).length
        if score > best_score:
            best_score = score
            best = p
    if best is None:
        raise RuntimeError(f"No wing tip verts for side {side}")
    return best


def fix_wing_tip_bones(arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    """Reconnect Digit2 so it continues Digit1 → mesh/landmark tip."""
    # Optional RIGGED landmarks for tip (more reliable than mesh extrema).
    tip_override: dict[str, Vector] = {}
    if SRC_RIGGED.exists():
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(SRC_RIGGED))
        added = [o for o in bpy.data.objects if o not in before]
        rig = next((o for o in added if o.type == "ARMATURE"), None)
        if rig:
            for side, bone in (("L", "L_WingDigit1"), ("R", "R_WingDigit1")):
                if bone in rig.data.bones:
                    tip_override[side] = world_tail(rig, bone)
            print(f"landmark tips L={tip_override.get('L')} R={tip_override.get('R')}")
        for o in added:
            bpy.data.objects.remove(o, do_unlink=True)

    # Re-establish active object after optional RIGGED import/remove.
    bpy.ops.object.select_all(action="DESELECT")
    arm.hide_set(False)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.context.view_layer.update()
    if arm.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    for side, (d1, d2) in WING_TIPS.items():
        if d1 not in eb or d2 not in eb:
            continue
        b1 = eb[d1]
        b2 = eb[d2]
        root = arm.matrix_world @ b1.head
        tip = tip_override.get(side) or mesh_wing_tip(mesh, side, root)
        d1_tail = root.lerp(tip, 0.85)
        b1.tail = inv @ d1_tail
        b2.parent = b1
        b2.use_connect = False
        b2.head = b1.tail.copy()
        b2.tail = inv @ tip
        if (b2.tail - b2.head).length < 1e-4:
            b2.tail = b2.head + (b1.tail - b1.head).normalized() * 0.02
        b1.align_roll(Vector((0.0, 1.0, 0.0)))
        b2.align_roll(Vector((0.0, 1.0, 0.0)))
        print(
            f"fixed {side} tip → {[round(v, 3) for v in tip]} "
            f"d2_len={(b2.tail - b2.head).length:.4f}"
        )
    bpy.ops.object.mode_set(mode="OBJECT")


def rebind_keep_weights(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    """Re-parent with ARMATURE_NAME so IBMs match edited rest bones."""
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mesh.modifiers.remove(mod)
    if mesh.parent:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_NAME")
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE":
            mod.object = arm
            mod.use_vertex_groups = True
    print(f"rebound {mesh.name} → {arm.name}")


def bake_basis_clip(
    src: bpy.types.Object,
    tgt: bpy.types.Object,
    name: str,
    frame_start: int,
    frame_end: int,
) -> bpy.types.Action:
    """Keyframe tgt rotations from src.matrix_basis (no locations — FBX pelvis loc is bind-space junk)."""
    clear_pose(tgt)
    if not tgt.animation_data:
        tgt.animation_data_create()
    action = bpy.data.actions.new(name=name)
    tgt.animation_data.action = action

    shared = [pb.name for pb in tgt.pose.bones if pb.name in src.pose.bones]
    frames = list(range(frame_start, frame_end + 1))
    for fr in frames:
        bpy.context.scene.frame_set(fr)
        bpy.context.view_layer.update()
        for name_b in shared:
            sp = src.pose.bones[name_b]
            tp = tgt.pose.bones[name_b]
            # Rotation only. Source pelvis.location is ~26 units of FBX bind junk
            # after proportion fit; applying it yeets the character.
            tp.rotation_mode = "QUATERNION"
            tp.rotation_quaternion = sp.matrix_basis.to_quaternion()
            tp.keyframe_insert(data_path="rotation_quaternion", frame=fr)
        if fr == frame_start or fr == frame_end or fr % 50 == 0:
            head = tgt.matrix_world @ tgt.pose.bones["GargHead"].matrix.translation
            print(f"  {name} f{fr} head={[round(c, 3) for c in head]}")

    retime_action_to_zero(action, frame_start, frame_end)
    for fcu in action_fcurves(action):
        for kp in fcu.keyframe_points:
            kp.interpolation = "LINEAR"
    print(f"  baked {name}: {action_fcurve_count(action)} fcurves, {len(frames)} frames")
    return action


def export_anim_only(
    path: Path,
    arm: bpy.types.Object,
    action: bpy.types.Action,
    frame_start: int,
    frame_end: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action
    duration = max(0, frame_end - frame_start)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = duration
    scene.frame_set(0)

    hidden: list[tuple[bpy.types.Object, bool]] = []
    for o in bpy.data.objects:
        if o != arm:
            hidden.append((o, o.hide_get()))
            o.hide_set(True)
    try:
        bpy.ops.object.select_all(action="DESELECT")
        arm.hide_set(False)
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            use_selection=True,
            export_animations=True,
            export_animation_mode="ACTIVE_ACTIONS",
            export_nla_strips=False,
            export_skins=False,
            export_morph=False,
            export_apply=False,
            export_texcoords=False,
            export_normals=False,
            export_materials="NONE",
        )
    finally:
        for o, was_hidden in hidden:
            o.hide_set(was_hidden)
    print(f"  wrote {path.name} ({path.stat().st_size} bytes)")


def export_character(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type == "ARMATURE" and o.name == "GargoyleMonkey":
            o.hide_set(False)
            o.select_set(True)
        elif o.type == "MESH" and "Icosphere" not in o.name and len(o.data.vertices) > 1000:
            o.hide_set(False)
            o.select_set(True)
        else:
            o.select_set(False)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
    )
    print(f"wrote character {path} ({path.stat().st_size} bytes)")


def validate_idle(arm: bpy.types.Object, src: bpy.types.Object) -> None:
    clear_pose(arm)
    bake_basis_clip(src, arm, "_validate_Idle", 80, 80)
    head = arm.matrix_world @ arm.pose.bones["GargHead"].matrix.translation
    pelvis = arm.matrix_world @ arm.pose.bones["GargPelvis"].matrix.translation
    ankle = arm.matrix_world @ arm.pose.bones["GargLLegAnkle"].matrix.translation
    print(
        f"VALIDATE Idle F0 head_z={head.z:.3f} pelvis_z={pelvis.z:.3f} "
        f"ankle_z={ankle.z:.3f} head_above_pelvis={head.z > pelvis.z}"
    )
    if head.z + 0.05 < pelvis.z:
        raise RuntimeError("Idle F0 still has head below pelvis — aborting bake")
    # remove validate action
    if arm.animation_data and arm.animation_data.action:
        act = arm.animation_data.action
        arm.animation_data.action = None
        bpy.data.actions.remove(act)
    clear_pose(arm)


def main() -> None:
    import os

    if not BLEND.exists():
        raise SystemExit(f"Missing blend: {BLEND}")

    quick = os.environ.get("REBAKE_QUICK", "").strip() in {"1", "true", "yes"}
    clips = (
        [c for c in CLIPS if c[0] in {"Tpose", "Idle", "Walk", "WalkBackward"}]
        if quick
        else CLIPS
    )

    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    arm = bpy.data.objects.get("GargoyleMonkey")
    src = bpy.data.objects.get("GargoyleSource")
    mesh = bpy.data.objects.get("WingedMonkey")
    if not arm or not src or not mesh:
        raise SystemExit("Blend missing GargoyleMonkey / GargoyleSource / WingedMonkey")

    src.hide_viewport = False
    src.hide_render = False
    # Drop stale object euler that does not affect matrix_world (confuses ops).
    src.rotation_euler = (0.0, 0.0, 0.0)
    if not src.animation_data or not src.animation_data.action:
        if bpy.data.actions:
            if not src.animation_data:
                src.animation_data_create()
            src.animation_data.action = bpy.data.actions[0]
        else:
            raise SystemExit("GargoyleSource has no action")

    print(
        f"source action={src.animation_data.action.name} "
        f"bones={len(arm.data.bones)} mesh_verts={len(mesh.data.vertices)} "
        f"quick={quick} clips={len(clips)}"
    )

    clear_pose(arm)
    fix_wing_tip_bones(arm, mesh)
    rebind_keep_weights(mesh, arm)
    clear_pose(arm)
    validate_idle(arm, src)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = {
        "method": "matrix_basis_copy_anim_only",
        "blend": str(BLEND.relative_to(ROOT)),
        "character": str(OUT_CHAR.relative_to(ROOT)),
        "quick": quick,
        "clips": [],
    }

    src_action = src.animation_data.action
    for clip_name, f0, f1 in clips:
        print(f"bake {clip_name} frames {f0}..{f1}")
        src.animation_data.action = src_action
        action = bake_basis_clip(src, arm, clip_name, f0, f1)
        out = OUT_DIR / f"{clip_name}.glb"
        export_anim_only(out, arm, action, f0, f1)
        summary["clips"].append(
            {"name": clip_name, "frames": [f0, f1], "file": out.name, "bytes": out.stat().st_size}
        )
        if arm.animation_data:
            arm.animation_data.action = None
        bpy.data.actions.remove(action)
        clear_pose(arm)

    # Hide source for character export / blend save
    src.hide_viewport = True
    src.hide_render = True
    export_character(OUT_CHAR)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    (OUT_DIR / "_bake_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"DONE — {len(summary['clips'])} clips → {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("REBAKE FAILED:", e, file=sys.stderr)
        raise
