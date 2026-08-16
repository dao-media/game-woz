#!/usr/bin/env python3
"""
Add wing bone chains to the Winged Monkey Tripo armature and re-skin wing mesh.

Reads masters (never modified). Writes derived GLB under models/wingedmonkey/.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/setup_winged_monkey_wings.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
MASTER_GLB = ROOT / "masters/wingedmonkey/meshes/WingedMonkey.glb"
OUT_GLB = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_rigged.blend"

# Parent wing roots under chest (mirrors Gargoyle Ribcage attachment).
WING_PARENT = "Spine02"

# Side → (lateral axis sign in character +X = left, tip target approx)
# Tip positions seeded from mesh extremes, refined after import.
WING_DEF = {
    "L": {
        "collarbone": "L_WingCollarbone",
        "wing1": "L_Wing1",
        "wing2": "L_Wing2",
        "palm": "L_WingPalm",
        "digit1": "L_WingDigit1",
        "thumb": "L_WingThumb",
        "sign": +1.0,
    },
    "R": {
        "collarbone": "R_WingCollarbone",
        "wing1": "R_Wing1",
        "wing2": "R_Wing2",
        "palm": "R_WingPalm",
        "digit1": "R_WingDigit1",
        "thumb": "R_WingThumb",
        "sign": -1.0,
    },
}


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def find_armature() -> bpy.types.Object:
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not arms:
        raise RuntimeError("No armature")
    return arms[0]


def find_skinned_mesh(arm: bpy.types.Object) -> bpy.types.Object:
    meshes = [
        o
        for o in bpy.data.objects
        if o.type == "MESH" and o.parent == arm and len(o.data.vertices) > 1000
    ]
    if not meshes:
        meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000]
    if not meshes:
        raise RuntimeError("No skinned mesh")
    return max(meshes, key=lambda o: len(o.data.vertices))


def bone_head_world(arm: bpy.types.Object, name: str) -> Vector:
    pb = arm.pose.bones[name]
    return (arm.matrix_world @ pb.matrix).translation


def estimate_wing_tips(mesh: bpy.types.Object, arm: bpy.types.Object) -> dict[str, Vector]:
    """Character left = +X (L_Clavicle), right = -X. Tips = lateral extremes mid-chest."""
    spine = bone_head_world(arm, "Spine02")
    clav_z = bone_head_world(arm, "L_Clavicle").z
    mw = mesh.matrix_world
    left: list[Vector] = []
    right: list[Vector] = []
    for v in mesh.data.vertices:
        w = mw @ v.co
        if w.z < clav_z - 0.25 or w.z > clav_z + 0.28:
            continue
        # Prefer verts already hanging off clavicle / spine (not hands/legs)
        if abs(w.x) < 0.14:
            continue
        if w.x > 0:
            left.append(w)
        else:
            right.append(w)

    def tip(pts: list[Vector], sign: float) -> Vector:
        if not pts:
            return spine + Vector((sign * 0.32, 0.12, 0.08))
        # farthest |x|
        pts = sorted(pts, key=lambda p: abs(p.x), reverse=True)
        sample = pts[: max(20, len(pts) // 40)]
        return Vector(
            (
                sum(p.x for p in sample) / len(sample),
                sum(p.y for p in sample) / len(sample),
                sum(p.z for p in sample) / len(sample),
            )
        )

    return {"L": tip(left, +1.0), "R": tip(right, -1.0)}


def ensure_edit_bones(arm: bpy.types.Object, tips: dict[str, Vector]) -> None:
    spine_w = bone_head_world(arm, WING_PARENT)
    awi = arm.matrix_world.inverted()

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    ebones = arm.data.edit_bones
    if WING_PARENT not in ebones:
        raise RuntimeError(f"Missing parent bone {WING_PARENT}")
    parent = ebones[WING_PARENT]

    created: list[str] = []
    for side, cfg in WING_DEF.items():
        tip_w = tips[side]
        tip = awi @ tip_w
        root_w = spine_w + Vector((cfg["sign"] * 0.04, 0.02, 0.06))
        root = awi @ root_w
        # Chain: root → 35% → 65% → tip, plus palm / digit / thumb offsets
        p0 = root
        p1 = root.lerp(tip, 0.35)
        p2 = root.lerp(tip, 0.65)
        p3 = tip
        direction = tip - root
        if direction.length < 1e-6:
            direction = Vector((cfg["sign"], 0.0, 0.0))
        direction.normalize()
        up = Vector((0.0, 0.0, 0.03))
        back = Vector((0.0, 0.025 * (1 if side == "L" else -1), 0.0))

        chain = [
            (cfg["collarbone"], p0, p1, parent.name),
            (cfg["wing1"], p1, p2, cfg["collarbone"]),
            (cfg["wing2"], p2, p3, cfg["wing1"]),
            (cfg["palm"], p3, p3 + direction * 0.04, cfg["wing2"]),
            (
                cfg["digit1"],
                p3 + up * 0.5,
                p3 + up * 0.5 + direction * 0.05,
                cfg["palm"],
            ),
            (
                cfg["thumb"],
                p2 + back,
                p2 + back + direction * 0.04 + up,
                cfg["wing2"],
            ),
        ]
        for name, head, tail, parent_name in chain:
            if name in ebones:
                b = ebones[name]
            else:
                b = ebones.new(name)
                created.append(name)
            b.head = head
            b.tail = tail if (tail - head).length > 1e-4 else head + Vector((0, 0.02, 0))
            b.parent = ebones[parent_name]
            b.use_connect = False

    bpy.ops.object.mode_set(mode="OBJECT")
    print("wing bones created:", created)

def ensure_vertex_groups(mesh: bpy.types.Object) -> None:
    existing = {g.name for g in mesh.vertex_groups}
    for cfg in WING_DEF.values():
        for key in ("collarbone", "wing1", "wing2", "palm", "digit1", "thumb"):
            name = cfg[key]
            if name not in existing:
                mesh.vertex_groups.new(name=name)


def paint_wing_weights(mesh: bpy.types.Object, arm: bpy.types.Object, tips: dict[str, Vector]) -> None:
    """Move clavicle/spine bleed on wing membrane onto wing bones."""
    ensure_vertex_groups(mesh)
    mw = mesh.matrix_world
    spine = bone_head_world(arm, "Spine02")
    clav_l = bone_head_world(arm, "L_Clavicle")
    clav_r = bone_head_world(arm, "R_Clavicle")

    wing_bones = {
        "L": [WING_DEF["L"][k] for k in ("collarbone", "wing1", "wing2", "palm", "digit1", "thumb")],
        "R": [WING_DEF["R"][k] for k in ("collarbone", "wing1", "wing2", "palm", "digit1", "thumb")],
    }
    bone_heads = {
        n: bone_head_world(arm, n) for side in wing_bones.values() for n in side
    }

    # Bones we steal weight from when verts look like wing membrane
    steal_from = {
        "L_Clavicle",
        "R_Clavicle",
        "Spine01",
        "Spine02",
        "Waist",
        "L_UpperarmTwist01",
        "R_UpperarmTwist01",
    }

    vg_index = {g.name: g.index for g in mesh.vertex_groups}
    steal_idx = {vg_index[n] for n in steal_from if n in vg_index}

    assigned = 0
    for v in mesh.data.vertices:
        wpos = mw @ v.co
        # Lateral + height gate
        if abs(wpos.x) < 0.11:
            continue
        if wpos.z < min(clav_l.z, clav_r.z) - 0.22:
            continue
        if wpos.z > max(clav_l.z, clav_r.z) + 0.30:
            continue
        # Prefer verts currently owned by steal_from
        steal_w = 0.0
        for g in v.groups:
            if g.group in steal_idx:
                steal_w += g.weight
        if steal_w < 0.15:
            continue
        # Must be farther from spine than a torso shell
        if (Vector((wpos.x, wpos.y, 0)) - Vector((spine.x, spine.y, 0))).length < 0.12:
            continue

        side = "L" if wpos.x >= 0 else "R"
        tip = tips[side]
        root = spine + Vector((WING_DEF[side]["sign"] * 0.04, 0.02, 0.06))
        # Param t along wing root→tip
        span = tip - root
        span_len = max(span.length, 1e-6)
        t = max(0.0, min(1.0, (wpos - root).dot(span) / (span_len * span_len)))

        # Clear stolen weights
        for g in list(v.groups):
            if g.group in steal_idx:
                mesh.vertex_groups[g.group].remove([v.index])

        # Distribute along chain
        names = wing_bones[side]
        # weight blend across neighboring bones by t
        raw = []
        for i, name in enumerate(names):
            center = i / max(1, len(names) - 1)
            fall = math.exp(-((t - center) * 3.2) ** 2)
            # distance to bone head softens
            dist = (wpos - bone_heads[name]).length
            fall *= math.exp(-(dist * 8.0) ** 2)
            raw.append((name, fall))
        total = sum(w for _, w in raw) or 1.0
        for name, fall in raw:
            mesh.vertex_groups[name].add([v.index], fall / total, "REPLACE")
        assigned += 1

    # Normalize all weights
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    print(f"wing verts reweighted: {assigned}")


def remove_junk() -> None:
    for o in list(bpy.data.objects):
        if o.type == "MESH" and len(o.data.vertices) < 200 and o.name.lower().startswith("ico"):
            bpy.data.objects.remove(o, do_unlink=True)


def export_glb(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in {"ARMATURE", "MESH"}:
            o.hide_set(False)
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=True,
        export_morph=False,
        export_apply=False,
    )
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    if not MASTER_GLB.exists():
        raise SystemExit(f"Missing master: {MASTER_GLB}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(MASTER_GLB))
    arm = find_armature()
    arm.name = "WingedMonkeyArmature"
    mesh = find_skinned_mesh(arm)
    print(f"arm={arm.name} mesh={mesh.name} verts={len(mesh.data.vertices)} bones={len(arm.data.bones)}")

    remove_junk()
    tips = estimate_wing_tips(mesh, arm)
    print("tips", {k: tuple(round(c, 3) for c in v) for k, v in tips.items()})

    # Skip if already has wing bones
    if "L_Wing1" in arm.data.bones:
        print("wing bones already present — re-painting weights only")
    else:
        ensure_edit_bones(arm, tips)

    bpy.context.view_layer.update()
    paint_wing_weights(mesh, arm, tips)

    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_glb(OUT_GLB)
    print("DONE wing setup")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("WING SETUP FAILED:", e, file=sys.stderr)
        raise
