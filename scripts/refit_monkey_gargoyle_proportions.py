#!/usr/bin/env python3
"""
Re-fit Gargoyle bind bone lengths/positions to the Winged Monkey mesh,
while preserving FBX bone-local axes (roll) so clips stay sagittal.

Why: fix_monkey_bind_from_fbx_rest.py restored correct hip/spine axes by
copying a uniformly scaled FBX rest — that undid polyline proportion fit.
Skeleton overlay then shows Gargoyle-scale wings sticking past the monkey mesh.

Masters untouched. Writes derived GLBs + blend only.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/refit_monkey_gargoyle_proportions.py

Then rebake clips:
  REBAKE_QUICK=1 /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/rebuild_monkey_gargoyle_from_fbx.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
CHAR_GLB = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
RIGGED_GLB = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
NEW_MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey_NEW.glb"
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_NEW = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
REPORT = ROOT / "models/wingedmonkey/Animations/gargoyle/_proportion_refit.json"

# Tripo (+ wing) → Gargoyle deform bones (from transplant_gargoyle_armature_to_monkey.py)
WEIGHT_MAP: dict[str, list[str]] = {
    "Hip": ["GargPelvis"],
    "Pelvis": ["GargPelvis"],
    "Waist": ["GargSpine1"],
    "Spine01": ["GargSpine2"],
    "Spine02": ["GargSpine3", "GargRibcage"],
    "NeckTwist01": ["GargNeck1"],
    "NeckTwist02": ["GargNeck2"],
    "Head": ["GargHead"],
    "L_Clavicle": ["GargLArmCollarbone"],
    "L_Upperarm": ["GargLArmUpperarm1"],
    "L_UpperarmTwist01": ["GargLArmUpperarm2"],
    "L_UpperarmTwist02": ["GargLArmUpperarm3"],
    "L_Forearm": ["GargLArmForearm1"],
    "L_ForearmTwist01": ["GargLArmForearm2"],
    "L_ForearmTwist02": ["GargLArmForearm3"],
    "L_Hand": ["GargLArmPalm"],
    "R_Clavicle": ["GargRCollarbone"],
    "R_Upperarm": ["GargRUpperarm1"],
    "R_UpperarmTwist01": ["GargRUpperarm2"],
    "R_UpperarmTwist02": ["GargRUpperarm3"],
    "R_Forearm": ["GargRForearm1"],
    "R_ForearmTwist01": ["GargRForearm2"],
    "R_ForearmTwist02": ["GargRForearm3"],
    "R_Hand": ["GargRPalm"],
    "L_Thigh": ["GargLLegThigh1"],
    "L_ThighTwist01": ["GargLLegThigh2"],
    "L_ThighTwist02": ["GargLLegThigh2"],
    "L_Calf": ["GargLLegCalf1"],
    "L_CalfTwist01": ["GargLLegCalf2"],
    "L_CalfTwist02": ["GargLLegCalf2"],
    "L_Foot": ["GargLLegAnkle"],
    "L_ToeBase": ["GargLLegToe1"],
    "R_Thigh": ["GargRThigh1"],
    "R_ThighTwist01": ["GargRThigh2"],
    "R_ThighTwist02": ["GargRThigh2"],
    "R_Calf": ["GargRCalf1"],
    "R_CalfTwist01": ["GargRCalf2"],
    "R_CalfTwist02": ["GargRCalf2"],
    "R_Foot": ["GargRAnkle"],
    "R_ToeBase": ["GargRToe1"],
    "L_WingCollarbone": ["GargLWingWCollarbone"],
    "L_Wing1": ["GargLWing1"],
    "L_Wing2": ["GargLWing2"],
    "L_WingPalm": ["GargLWingLWingPalm"],
    "L_WingDigit1": ["GargLWingLDigit1", "GargLWingLDigit2"],
    "L_WingThumb": ["GargWingThumbL", "GargWingThumbL2"],
    "R_WingCollarbone": ["GargRWingWCollarbone"],
    "R_Wing1": ["GargRWing1"],
    "R_Wing2": ["GargRWing2"],
    "R_WingPalm": ["GargRWingRWingPalm"],
    "R_WingDigit1": ["GargRWingRDigit1", "GargRWingRDigit2"],
    "R_WingThumb": ["GargWingThumbR", "GargWingThumbR2"],
}

SPINE_CHAIN = [
    "GargPelvis",
    "GargSpine1",
    "GargSpine2",
    "GargSpine3",
    "GargRibcage",
    "GargNeck1",
    "GargNeck2",
    "GargHead",
]
L_ARM_CHAIN = [
    "GargLArmCollarbone",
    "GargLArmUpperarm1",
    "GargLArmUpperarm2",
    "GargLArmUpperarm3",
    "GargLArmForearm1",
    "GargLArmForearm2",
    "GargLArmForearm3",
    "GargLArmPalm",
]
R_ARM_CHAIN = [
    "GargRCollarbone",
    "GargRUpperarm1",
    "GargRUpperarm2",
    "GargRUpperarm3",
    "GargRForearm1",
    "GargRForearm2",
    "GargRForearm3",
    "GargRPalm",
]
L_LEG_CHAIN = [
    "GargLLegThigh1",
    "GargLLegThigh2",
    "GargLLegCalf1",
    "GargLLegCalf2",
    "GargLLegAnkle",
    "GargLLegToe1",
]
R_LEG_CHAIN = [
    "GargRThigh1",
    "GargRThigh2",
    "GargRCalf1",
    "GargRCalf2",
    "GargRAnkle",
    "GargRToe1",
]
L_WING_CHAIN = [
    "GargLWingWCollarbone",
    "GargLWing1",
    "GargLWing2",
    "GargLWingLWingPalm",
    "GargLWingLDigit1",
]
R_WING_CHAIN = [
    "GargRWingWCollarbone",
    "GargRWing1",
    "GargRWing2",
    "GargRWingRWingPalm",
    "GargRWingRDigit1",
]


def world_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def world_tail(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].tail_local


def hip_yaw_deg(arm: bpy.types.Object) -> float:
    d = world_head(arm, "GargRThigh1") - world_head(arm, "GargLLegThigh1")
    return math.degrees(math.atan2(d.y, d.x))


def pelvis_x_yaw_deg(arm: bpy.types.Object) -> float:
    b = arm.data.bones["GargPelvis"]
    x = (arm.matrix_world @ b.matrix_local).to_3x3() @ Vector((1, 0, 0))
    return math.degrees(math.atan2(x.y, x.x))


def clear_pose(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def snapshot_roll_guides(arm: bpy.types.Object) -> dict[str, Vector]:
    """World-space bone local +X (used as align_roll guide after head/tail move)."""
    guides: dict[str, Vector] = {}
    for b in arm.data.bones:
        x = (arm.matrix_world @ b.matrix_local).to_3x3() @ Vector((1.0, 0.0, 0.0))
        if x.length > 1e-8:
            guides[b.name] = x.normalized()
    return guides


def mesh_bbox(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    return (
        Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
        Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))),
    )


def wing_tip_from_mesh(mesh: bpy.types.Object, side: str) -> Vector:
    mn, mx = mesh_bbox(mesh)
    z_cut = mn.z + 0.45 * (mx.z - mn.z)
    best: Vector | None = None
    best_score = -1.0
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if p.z < z_cut:
            continue
        if side == "L" and p.x <= 0.05:
            continue
        if side == "R" and p.x >= -0.05:
            continue
        score = abs(p.x) + 0.15 * p.z
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        raise RuntimeError(f"No wing tip for {side}")
    return best


def wing_span_report(arm: bpy.types.Object, mesh: bpy.types.Object) -> dict:
    mn, mx = mesh_bbox(mesh)
    out = {"mesh_aabb": {"min": [round(c, 4) for c in mn], "max": [round(c, 4) for c in mx]}}
    for side, tip_bone in (("L", "GargLWingLDigit1"), ("R", "GargRWingRDigit1")):
        if tip_bone not in arm.data.bones:
            continue
        btail = world_tail(arm, tip_bone)
        if tip_bone.replace("Digit1", "Digit2") in arm.data.bones:
            btail = world_tail(arm, tip_bone.replace("Digit1", "Digit2"))
        mtip = wing_tip_from_mesh(mesh, side)
        out[side] = {
            "bone_tip": [round(c, 4) for c in btail],
            "mesh_tip": [round(c, 4) for c in mtip],
            "delta": round((btail - mtip).length, 4),
            "bone_abs_x": round(abs(btail.x), 4),
            "mesh_abs_x": round(abs(mtip.x), 4),
        }
    return out


def polyline_fit_preserve_roll(
    arm: bpy.types.Object,
    chain: list[str],
    waypoints: list[Vector],
    guides: dict[str, Vector],
) -> None:
    if len(waypoints) != len(chain) + 1:
        raise ValueError(f"waypoints {len(waypoints)} != chain+1 ({len(chain)+1})")

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    lengths = [max((eb[n].tail - eb[n].head).length, 1e-6) for n in chain]
    total = sum(lengths)
    ratios = [L / total for L in lengths]

    segs = [(waypoints[i + 1] - waypoints[i]).length for i in range(len(waypoints) - 1)]
    poly_len = max(sum(segs), 1e-6)

    def point_at(dist: float) -> Vector:
        d = max(0.0, min(dist, poly_len))
        walked = 0.0
        for i, seg_len in enumerate(segs):
            if walked + seg_len >= d - 1e-9 or i == len(segs) - 1:
                t = 0.0 if seg_len < 1e-9 else (d - walked) / seg_len
                return waypoints[i].lerp(waypoints[i + 1], t)
            walked += seg_len
        return waypoints[-1].copy()

    inv = arm.matrix_world.inverted()
    cursor = 0.0
    heads_w = [point_at(0.0)]
    for r in ratios:
        cursor += r * poly_len
        heads_w.append(point_at(cursor))

    for i, name in enumerate(chain):
        b = eb[name]
        h_w = heads_w[i]
        t_w = heads_w[i + 1]
        b.head = inv @ h_w
        b.tail = inv @ t_w
        if (b.tail - b.head).length < 1e-5:
            b.tail = b.head + Vector((0.0, 0.0, 0.01))
        axis = (t_w - h_w).normalized() if (t_w - h_w).length > 1e-8 else Vector((0, 0, 1))
        guide = guides.get(name, Vector((0.0, 1.0, 0.0))).copy()
        # Project prior bone-X onto plane ⊥ bone axis so roll stays FBX-like.
        guide = guide - axis * guide.dot(axis)
        if guide.length < 1e-6:
            guide = Vector((0.0, 1.0, 0.0))
            if abs(axis.dot(guide)) > 0.9:
                guide = Vector((1.0, 0.0, 0.0))
            guide = guide - axis * guide.dot(axis)
        try:
            b.align_roll(guide.normalized())
        except Exception:
            pass

    bpy.ops.object.mode_set(mode="OBJECT")


def fit_proportions(
    garg: bpy.types.Object,
    monkey: bpy.types.Object,
    mesh: bpy.types.Object,
    guides: dict[str, Vector],
) -> None:
    hip = world_head(monkey, "Hip")
    waist = world_head(monkey, "Waist")
    sp1 = world_head(monkey, "Spine01")
    sp2 = world_head(monkey, "Spine02")
    neck = world_head(monkey, "NeckTwist01")
    head = world_head(monkey, "Head")
    head_tip = world_tail(monkey, "Head")
    spine_wp = [
        hip,
        waist.lerp(sp1, 0.35),
        sp1,
        sp1.lerp(sp2, 0.55),
        sp2,
        neck,
        neck.lerp(head, 0.55),
        head,
        head_tip if (head_tip - head).length > 1e-4 else head + Vector((0, 0, 0.04)),
    ]
    polyline_fit_preserve_roll(garg, SPINE_CHAIN, spine_wp, guides)

    for chain, clav, upper, forearm, hand in (
        (L_ARM_CHAIN, "L_Clavicle", "L_Upperarm", "L_Forearm", "L_Hand"),
        (R_ARM_CHAIN, "R_Clavicle", "R_Upperarm", "R_Forearm", "R_Hand"),
    ):
        c = world_head(monkey, clav)
        u = world_head(monkey, upper)
        f = world_head(monkey, forearm)
        h = world_head(monkey, hand)
        tip = world_tail(monkey, hand)
        wp = [
            c,
            u,
            u.lerp(f, 0.33),
            u.lerp(f, 0.66),
            f,
            f.lerp(h, 0.33),
            f.lerp(h, 0.66),
            h,
            tip if (tip - h).length > 1e-4 else h + (h - f).normalized() * 0.05,
        ]
        polyline_fit_preserve_roll(garg, chain, wp, guides)

    for chain, thigh, calf, foot, toe in (
        (L_LEG_CHAIN, "L_Thigh", "L_Calf", "L_Foot", "L_ToeBase"),
        (R_LEG_CHAIN, "R_Thigh", "R_Calf", "R_Foot", "R_ToeBase"),
    ):
        t0 = world_head(monkey, thigh)
        c0 = world_head(monkey, calf)
        f0 = world_head(monkey, foot)
        toe_h = world_head(monkey, toe)
        toe_t = world_tail(monkey, toe)
        wp = [
            t0,
            t0.lerp(c0, 0.5),
            c0,
            c0.lerp(f0, 0.5),
            f0,
            toe_h,
            toe_t if (toe_t - toe_h).length > 1e-4 else toe_h + Vector((0, -0.03, 0)),
        ]
        polyline_fit_preserve_roll(garg, chain, wp, guides)

    for chain, side, thumb_name, m_clav, m_w1, m_w2, m_palm, m_digit in (
        (
            L_WING_CHAIN,
            "L",
            "GargWingThumbL",
            "L_WingCollarbone",
            "L_Wing1",
            "L_Wing2",
            "L_WingPalm",
            "L_WingDigit1",
        ),
        (
            R_WING_CHAIN,
            "R",
            "GargWingThumbR",
            "R_WingCollarbone",
            "R_Wing1",
            "R_Wing2",
            "R_WingPalm",
            "R_WingDigit1",
        ),
    ):
        tip = wing_tip_from_mesh(mesh, side)
        root = world_head(monkey, m_clav)
        w1 = world_head(monkey, m_w1)
        w2 = world_head(monkey, m_w2)
        palm = world_head(monkey, m_palm)
        digit = world_head(monkey, m_digit)
        out = tip - root
        if out.length > 1e-6:
            root = root + out.normalized() * 0.03
        wp = [
            root,
            w1,
            w2,
            palm,
            digit if (digit - palm).length > 1e-4 else palm.lerp(tip, 0.55),
            tip,
        ]
        polyline_fit_preserve_roll(garg, chain, wp, guides)

        # Thumb off wing2
        bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.select_all(action="DESELECT")
        garg.select_set(True)
        bpy.context.view_layer.objects.active = garg
        bpy.ops.object.mode_set(mode="EDIT")
        eb = garg.data.edit_bones
        thumb2 = thumb_name + "2"
        if thumb_name in eb and chain[2] in eb:
            w2b = eb[chain[2]]
            th = eb[thumb_name]
            inv = garg.matrix_world.inverted()
            base_w = garg.matrix_world @ w2b.head.lerp(w2b.tail, 0.35)
            span = (tip - root).normalized() if (tip - root).length > 1e-6 else Vector((1, 0, 0))
            fwd = span.cross(Vector((0, 0, 1)))
            if fwd.length < 1e-6:
                fwd = Vector((0.0, -1.0, 0.0))
            fwd.normalize()
            th.head = inv @ base_w
            th.tail = inv @ (base_w + fwd * 0.06 + Vector((0, 0, -0.02)))
            th.parent = w2b
            try:
                th.align_roll(guides.get(thumb_name, Vector((0.0, 1.0, 0.0))))
            except Exception:
                pass
            if thumb2 in eb:
                th2 = eb[thumb2]
                tip_w = garg.matrix_world @ th.tail
                th2.head = th.tail.copy()
                th2.tail = inv @ (tip_w + fwd * 0.04)
                th2.parent = th
                try:
                    th2.align_roll(guides.get(thumb2, Vector((0.0, 1.0, 0.0))))
                except Exception:
                    pass
        # Digit2 tip bone if present — keep tip exactly on mesh tip (no overshoot)
        d1 = chain[-1]
        d2 = d1.replace("Digit1", "Digit2")
        if d1 in eb and d2 in eb:
            b1 = eb[d1]
            b2 = eb[d2]
            inv = garg.matrix_world.inverted()
            tip_local = inv @ tip
            # b1 already ends near tip from polyline; snap exactly, then short Digit2
            b1.tail = tip_local
            mid = b1.head.lerp(tip_local, 0.7)
            b1.tail = mid
            b2.parent = b1
            b2.use_connect = False
            b2.head = mid.copy()
            b2.tail = tip_local
            if (b2.tail - b2.head).length < 1e-4:
                b2.tail = b2.head + Vector((0.02, 0, 0))
            try:
                b1.align_roll(guides.get(d1, Vector((0.0, 1.0, 0.0))))
                b2.align_roll(guides.get(d2, Vector((0.0, 1.0, 0.0))))
            except Exception:
                pass
        bpy.ops.object.mode_set(mode="OBJECT")

    print("proportion fit complete (roll preserved)")


def clamp_outlier_bones_to_mesh(arm: bpy.types.Object, mesh: bpy.types.Object, pad: float = 0.01) -> int:
    """
    Shrink any bone tip still outside the mesh AABB (Gargoyle finger / wing-membrane
    bones that polyline_fit does not touch). Preserves direction; parents first.
    """
    mn, mx = mesh_bbox(mesh)
    mn = Vector((mn.x - pad, mn.y - pad, mn.z - pad))
    mx = Vector((mx.x + pad, mx.y + pad, mx.z + pad))

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    # Armature bone order is parents-before-children
    n = 0
    for bone in arm.data.bones:
        if bone.name not in eb:
            continue
        if bone.name.startswith("neutral_bone"):
            continue
        e = eb[bone.name]
        h_w = arm.matrix_world @ e.head
        t_w = arm.matrix_world @ e.tail
        # Recompute world from current edit (matrix_world @ edit head is armature-local)
        h_w = arm.matrix_world @ Vector(e.head)
        t_w = arm.matrix_world @ Vector(e.tail)
        outside = (
            t_w.x < mn.x
            or t_w.x > mx.x
            or t_w.y < mn.y
            or t_w.y > mx.y
            or t_w.z < mn.z
            or t_w.z > mx.z
        )
        if not outside:
            continue
        axis = t_w - h_w
        length = axis.length
        if length < 1e-8:
            continue
        dir_w = axis.normalized()
        # Binary search max length keeping tip inside AABB
        lo, hi = 0.0, length
        for _ in range(24):
            mid = 0.5 * (lo + hi)
            p = h_w + dir_w * mid
            ok = mn.x <= p.x <= mx.x and mn.y <= p.y <= mx.y and mn.z <= p.z <= mx.z
            if ok:
                lo = mid
            else:
                hi = mid
        new_len = max(lo * 0.98, min(length, 0.02))
        e.tail = inv @ (h_w + dir_w * new_len)
        n += 1
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"clamped {n} outlier bone tips into mesh AABB")
    return n


def fit_wing_membrane_chains(
    garg: bpy.types.Object,
    mesh: bpy.types.Object,
    guides: dict[str, Vector],
) -> None:
    """Fit Gargoyle wing DigitMiddle / DigitPink chains toward mesh wing tips."""
    for side, root, chains in (
        (
            "L",
            "GargLWing2",
            (
                ["GargLDigitMiddle", "GargLDigitMiddle2", "GargLDigitMiddle3"],
                ["GargLDigitPink", "GargLDigitPink2"],
            ),
        ),
        (
            "R",
            "GargRWing2",
            (
                ["GargRDigitMiddle", "GargRDigitMiddle2", "GargRDigitMiddle3"],
                ["GargRDigitPink", "GargRDigitPink2"],
            ),
        ),
    ):
        if root not in garg.data.bones:
            continue
        tip = wing_tip_from_mesh(mesh, side)
        base = world_head(garg, root)
        for chain in chains:
            if any(n not in garg.data.bones for n in chain):
                continue
            # Fan slightly: middle toward tip, pink a bit lower/back
            end = tip.copy()
            if "Pink" in chain[0]:
                end = tip.lerp(base, 0.15) + Vector((0.0, 0.02 if side == "L" else -0.02, -0.04))
            elif "Middle" in chain[0]:
                end = tip.lerp(base, 0.05) + Vector((0.0, 0.03 if side == "L" else -0.03, 0.02))
            wp = [base.lerp(end, t) for t in [i / len(chain) for i in range(len(chain) + 1)]]
            # Start at mid-wing2, not wing2 head
            wp[0] = world_head(garg, root).lerp(world_tail(garg, root), 0.4)
            polyline_fit_preserve_roll(garg, chain, wp, guides)


def remap_tripo_weights_to_gargoyle(mesh: bpy.types.Object) -> int:
    old_index_to_name = {vg.index: vg.name for vg in mesh.vertex_groups}
    per_vert: list[dict[str, float]] = []
    for v in mesh.data.vertices:
        wmap: dict[str, float] = {}
        for g in v.groups:
            name = old_index_to_name.get(g.group)
            if name:
                wmap[name] = g.weight
        per_vert.append(wmap)

    mesh.vertex_groups.clear()
    created: set[str] = set()
    assigned = 0
    for vi, wmap in enumerate(per_vert):
        new_w: dict[str, float] = {}
        for old_name, weight in wmap.items():
            targets = WEIGHT_MAP.get(old_name)
            if not targets:
                continue
            share = weight / len(targets)
            for t in targets:
                new_w[t] = new_w.get(t, 0.0) + share
        if not new_w:
            continue
        total = sum(new_w.values()) or 1.0
        for name, w in new_w.items():
            if name not in created:
                mesh.vertex_groups.new(name=name)
                created.add(name)
            mesh.vertex_groups[name].add([vi], w / total, "REPLACE")
        assigned += 1
    print(f"remapped weights on {assigned}/{len(per_vert)} verts → {len(created)} Gargoyle groups")
    return assigned


def bind(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
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


def transfer_weights(dst: bpy.types.Object, src: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.data_transfer(
        data_type="VGROUP_WEIGHTS",
        use_auto_transform=False,
        layers_select_src="ALL",
        layers_select_dst="NAME",
        mix_mode="REPLACE",
        mix_factor=1.0,
        vert_mapping="NEAREST",
    )


def align_mesh_uniform_to_donor(dst: bpy.types.Object, donor: bpy.types.Object) -> None:
    """Uniform-scale + translate dst so its AABB matches donor (no per-axis warp)."""
    dst.data = dst.data.copy()
    bpy.ops.object.select_all(action="DESELECT")
    dst.select_set(True)
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    dcoords = [donor.matrix_world @ v.co for v in donor.data.vertices]
    ncoords = [Vector(v.co) for v in dst.data.vertices]
    dmin = Vector((min(c.x for c in dcoords), min(c.y for c in dcoords), min(c.z for c in dcoords)))
    dmax = Vector((max(c.x for c in dcoords), max(c.y for c in dcoords), max(c.z for c in dcoords)))
    nmin = Vector((min(c.x for c in ncoords), min(c.y for c in ncoords), min(c.z for c in ncoords)))
    nmax = Vector((max(c.x for c in ncoords), max(c.y for c in ncoords), max(c.z for c in ncoords)))
    dsize = dmax - dmin
    nsize = nmax - nmin
    # Uniform scale from the dominant axis (height) so proportions stay honest.
    scale = dsize.z / max(nsize.z, 1e-6)
    dcenter = (dmin + dmax) * 0.5
    ncenter = (nmin + nmax) * 0.5
    for v in dst.data.vertices:
        v.co = dcenter + (v.co - ncenter) * scale
    # Snap feet to donor min-z
    coords = [Vector(v.co) for v in dst.data.vertices]
    z0 = min(c.z for c in coords)
    dz = dmin.z - z0
    for v in dst.data.vertices:
        v.co.z += dz
    dst.data.update()
    bpy.context.view_layer.update()
    coords = [Vector(v.co) for v in dst.data.vertices]
    print(
        f"aligned NEW uniform scale={scale:.4f} "
        f"z=[{min(c.z for c in coords):.3f},{max(c.z for c in coords):.3f}]"
    )


def shrink_hand_finger_chains(arm: bpy.types.Object, guides: dict[str, Vector]) -> None:
    """Collapse Gargoyle finger chains to short stubs from the palm (monkey has mitts)."""
    chains = []
    for prefix in ("GargLArmDigit", "GargRDigit"):
        for digit in range(5):
            names = [f"{prefix}{digit}{seg}" for seg in range(4)]
            # L uses GargLArmDigit01..; R uses GargRDigit01..
            if prefix == "GargLArmDigit":
                names = [f"GargLArmDigit{digit}{seg}" for seg in range(4)]
            else:
                names = [f"GargRDigit{digit}{seg}" for seg in range(4)]
            present = [n for n in names if n in arm.data.bones]
            if present:
                chains.append(present)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    for chain in chains:
        parent = eb[chain[0]].parent
        if parent is None:
            continue
        base_w = arm.matrix_world @ parent.tail
        # Fan direction from palm center toward current first finger head (or +X/-X)
        first = eb[chain[0]]
        cur = arm.matrix_world @ first.head
        direction = cur - (arm.matrix_world @ parent.head)
        if direction.length < 1e-6:
            direction = Vector((0.08 if "L" in chain[0] else -0.08, -0.02, -0.02))
        direction.normalize()
        step = 0.018
        prev = None
        for i, name in enumerate(chain):
            e = eb[name]
            h_w = base_w + direction * (step * i)
            t_w = base_w + direction * (step * (i + 1))
            e.head = inv @ h_w
            e.tail = inv @ t_w
            if prev is not None:
                e.parent = prev
            try:
                e.align_roll(guides.get(name, Vector((0.0, 1.0, 0.0))))
            except Exception:
                pass
            prev = e
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"shrunk {len(chains)} hand finger chains")


def export_skinned(path: Path, arm: bpy.types.Object, mesh: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(o in {arm, mesh})
        if o in {arm, mesh}:
            o.hide_set(False)
    bpy.context.view_layer.objects.active = arm
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
    for p in (CHAR_GLB, RIGGED_GLB, NEW_MASTER):
        if not p.exists():
            raise SystemExit(f"Missing {p}")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # --- Monkey landmarks + weighted mesh ---
    bpy.ops.import_scene.gltf(filepath=str(RIGGED_GLB))
    monkey = next(
        o
        for o in bpy.data.objects
        if o.type == "ARMATURE" and "Hip" in o.data.bones and "L_Clavicle" in o.data.bones
    )
    monkey.name = "MonkeyRef"
    mesh = max(
        (o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000),
        key=lambda o: len(o.data.vertices),
    )
    mesh.name = "WingedMonkey"
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != mesh:
            bpy.data.objects.remove(o, do_unlink=True)

    # --- Current Gargoyle bind (axis-correct, wrong proportions) ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CHAR_GLB))
    added = [o for o in bpy.data.objects if o not in before]
    garg = next(o for o in added if o.type == "ARMATURE")
    garg.name = "GargoyleMonkey"
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    if garg.animation_data:
        garg.animation_data_clear()
    clear_pose(garg)

    before_metrics = {
        "hip_yaw": hip_yaw_deg(garg),
        "pelvis_x_yaw": pelvis_x_yaw_deg(garg),
        "wings": wing_span_report(garg, mesh),
    }
    print(f"BEFORE hip_yaw={before_metrics['hip_yaw']:.1f} wings={before_metrics['wings']}")

    guides = snapshot_roll_guides(garg)
    fit_proportions(garg, monkey, mesh, guides)
    fit_wing_membrane_chains(garg, mesh, guides)
    shrink_hand_finger_chains(garg, guides)
    clamp_outlier_bones_to_mesh(garg, mesh)
    clear_pose(garg)
    bpy.context.view_layer.update()

    after_metrics = {
        "hip_yaw": hip_yaw_deg(garg),
        "pelvis_x_yaw": pelvis_x_yaw_deg(garg),
        "wings": wing_span_report(garg, mesh),
    }
    print(f"AFTER hip_yaw={after_metrics['hip_yaw']:.1f} wings={after_metrics['wings']}")

    # Axes must stay roughly L/R on X (~±180), not sideways (~90).
    hy = abs(after_metrics["hip_yaw"])
    if 70 < (hy % 180) < 110:
        raise SystemExit(f"Hip yaw went sideways after fit: {after_metrics['hip_yaw']}")

    # Count remaining outliers for report
    mn, mx = mesh_bbox(mesh)
    outliers = 0
    for b in garg.data.bones:
        t = world_tail(garg, b.name)
        if t.x < mn.x - 0.02 or t.x > mx.x + 0.02 or t.y < mn.y - 0.02 or t.y > mx.y + 0.02 or t.z > mx.z + 0.02:
            outliers += 1
    after_metrics["outlier_tips"] = outliers
    print(f"remaining outlier tips≈{outliers}")

    # Remap Tripo weights → Gargoyle, bind
    assigned = remap_tripo_weights_to_gargoyle(mesh)
    if assigned == 0:
        raise SystemExit("Weight remap produced 0 verts")
    bind(mesh, garg)
    bpy.data.objects.remove(monkey, do_unlink=True)

    # --- NEW mesh onto fitted bind ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(NEW_MASTER))
    added = [o for o in bpy.data.objects if o not in before]
    new_mesh = next(o for o in added if o.type == "MESH" and len(o.data.vertices) > 1000)
    new_mesh.name = "WingedMonkeyNEW"
    for o in list(added):
        if o != new_mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    align_mesh_uniform_to_donor(new_mesh, mesh)
    transfer_weights(new_mesh, mesh)
    bind(new_mesh, garg)
    export_skinned(OUT_NEW, garg, new_mesh)

    bpy.data.objects.remove(new_mesh, do_unlink=True)
    bind(mesh, garg)
    export_skinned(OUT_CHAR, garg, mesh)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

    report = {
        "method": "polyline_fit_preserve_fbx_roll",
        "before": before_metrics,
        "after": after_metrics,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + "\n")
    print(f"DONE wrote {OUT_CHAR.name} {OUT_NEW.name} report={REPORT}")


if __name__ == "__main__":
    main()
