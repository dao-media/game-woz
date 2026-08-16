#!/usr/bin/env python3
"""
Transpose Infinity PBR Gargoyle armature onto the Winged Monkey mesh.

Approach (fixes bad name-remap retarget):
  1. Import monkey mesh + GargoyleHumanoid skeleton (T-pose)
  2. Uniform-scale + align Gargoyle to monkey hips
  3. Edit-mode fit bone chains to monkey joint landmarks / wing tips
     (keeps Garg* names + hierarchy so clips play natively)
  4. Bind monkey mesh to fitted Gargoyle armature
  5. Export skinned character + animation-only clip slices (visual bake)

Reads (never modified):
  - masters/wingedmonkey/meshes/WingedMonkey.glb
  - Unity/.../GargoyleHumanoid.FBX

Writes:
  - models/wingedmonkey/WingedMonkey_gargoyle.glb
  - models/wingedmonkey/WingedMonkey_gargoyle.blend
  - models/wingedmonkey/Animations/gargoyle/<Clip>.glb
  - models/wingedmonkey/Animations/gargoyle/_bake_summary.json

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background \\
    --python scripts/transplant_gargoyle_armature_to_monkey.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras import anim_utils
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
MONKEY_MASTER = ROOT / "masters/wingedmonkey/meshes/WingedMonkey.glb"
# Prefer weighted Tripo+wings mesh for vertex-group remap onto Gargoyle bones
MONKEY_WEIGHTED = ROOT / "models/wingedmonkey/WingedMonkey_rigged.glb"
GARGOYLE_FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
OUT_CHAR = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.glb"
OUT_BLEND = ROOT / "models/wingedmonkey/WingedMonkey_gargoyle.blend"
OUT_DIR = ROOT / "models/wingedmonkey/Animations/gargoyle"

# Tripo (+ wing) vertex groups → Gargoyle deform bones (multi = duplicate weights)
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

# Unity FBX.meta clip slices (Take 001 @ 30fps)
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

# Monkey landmark bone → Gargoyle joint to snap (head)
# Chains are fitted separately with intermediate redistribution.
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


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_head(arm: bpy.types.Object, name: str) -> Vector:
    b = arm.data.bones[name]
    return arm.matrix_world @ b.head_local


def world_tail(arm: bpy.types.Object, name: str) -> Vector:
    b = arm.data.bones[name]
    return arm.matrix_world @ b.tail_local


def find_armature_with(*required: str) -> bpy.types.Object:
    for o in bpy.data.objects:
        if o.type != "ARMATURE":
            continue
        if all(n in o.data.bones for n in required):
            return o
    raise RuntimeError(f"Armature missing required bones {required}")


def find_monkey_mesh() -> bpy.types.Object:
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.vertices) > 1000]
    if not meshes:
        raise RuntimeError("Monkey mesh not found")
    # Prefer the dense body over any leftover helpers
    meshes.sort(key=lambda o: len(o.data.vertices), reverse=True)
    return meshes[0]


def mesh_bbox(mesh: bpy.types.Object) -> tuple[Vector, Vector]:
    pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def wing_tip_from_mesh(mesh: bpy.types.Object, side: str) -> Vector:
    """Approximate wing tip = farthest lateral vertex in upper half."""
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
        # Prefer high |x| and somewhat elevated
        score = abs(p.x) + 0.15 * p.z
        if score > best_score:
            best_score = score
            best = p.copy()
    if best is None:
        # Fallback offsets from shoulder height
        mid_z = 0.72
        return Vector((0.55 if side == "L" else -0.55, 0.05, mid_z + 0.15))
    return best


def align_gargoyle_to_monkey(garg: bpy.types.Object, monkey: bpy.types.Object) -> float:
    """Uniform scale + translate so GargPelvis matches monkey Hip; yaw to shoulders."""
    bpy.context.view_layer.update()
    g_hip = world_head(garg, "GargPelvis")
    m_hip = world_head(monkey, "Hip")
    g_h = max(abs(g_hip.z), 1e-4)
    m_h = max(abs(m_hip.z), 1e-4)
    scale = m_h / g_h
    garg.scale *= scale
    bpy.context.view_layer.update()

    g_hip = world_head(garg, "GargPelvis")
    garg.location += m_hip - g_hip
    bpy.context.view_layer.update()

    # Yaw about +Z using clavicle / collarbone line
    def fwd(arm: bpy.types.Object, left: str, right: str) -> Vector:
        ls = world_head(arm, left)
        rs = world_head(arm, right)
        right_v = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
        if right_v.length < 1e-8:
            return Vector((0.0, 1.0, 0.0))
        right_v.normalize()
        f = Vector((0.0, 0.0, 1.0)).cross(right_v)
        return f.normalized() if f.length > 1e-8 else Vector((0.0, 1.0, 0.0))

    try:
        g_fwd = fwd(garg, "GargLArmCollarbone", "GargRCollarbone")
        m_fwd = fwd(monkey, "L_Clavicle", "R_Clavicle")
        yaw = math.atan2(
            g_fwd.x * m_fwd.y - g_fwd.y * m_fwd.x,
            g_fwd.x * m_fwd.x + g_fwd.y * m_fwd.y,
        )
        garg.rotation_euler[2] += yaw
        bpy.context.view_layer.update()
        g_hip = world_head(garg, "GargPelvis")
        garg.location += m_hip - g_hip
        bpy.context.view_layer.update()
    except KeyError:
        pass

    print(f"align scale={scale:.4f} hip→{tuple(round(c, 3) for c in world_head(garg, 'GargPelvis'))}")
    return scale


def apply_armature_transform(obj: bpy.types.Object, *, location: bool, rotation: bool, scale: bool) -> None:
    """Apply selected object transforms into armature edit bones / animation."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)


def apply_armature_scale_only(obj: bpy.types.Object) -> None:
    """Apply object scale into armature data; keep location/rotation for placement."""
    apply_armature_transform(obj, location=False, rotation=False, scale=True)


def polyline_fit(
    arm: bpy.types.Object,
    chain: list[str],
    waypoints: list[Vector],
) -> None:
    """
    Place an ordered bone chain so successive heads/tails follow waypoints.

    waypoints length must be len(chain)+1 (head of first … tip of last).
    Intermediate bones keep relative length ratios from the current rest pose.
    """
    if len(waypoints) != len(chain) + 1:
        raise ValueError(f"waypoints {len(waypoints)} != chain+1 ({len(chain)+1})")

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    # Original lengths (edit-space) for ratio
    lengths = []
    for name in chain:
        b = eb[name]
        lengths.append(max((b.tail - b.head).length, 1e-6))
    total = sum(lengths)
    ratios = [L / total for L in lengths]

    # Build cumulative targets along the polyline of waypoints
    # First, measure polyline segment lengths
    segs = []
    for i in range(len(waypoints) - 1):
        segs.append((waypoints[i + 1] - waypoints[i]).length)
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

    # Place bones
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
        # Keep a stable secondary axis so bend directions stay anatomical after fit.
        axis = (t_w - h_w).normalized() if (t_w - h_w).length > 1e-8 else Vector((0, 0, 1))
        # Prefer world +Y as roll guide; fall back to +X if bone is near-aligned with +Y.
        guide = Vector((0.0, 1.0, 0.0))
        if abs(axis.dot(guide)) > 0.9:
            guide = Vector((1.0, 0.0, 0.0))
        b.align_roll(guide)

    bpy.ops.object.mode_set(mode="OBJECT")


def fit_proportions(garg: bpy.types.Object, monkey: bpy.types.Object, mesh: bpy.types.Object) -> None:
    """Snap Gargoyle chains to monkey landmarks + wing tips."""
    # Spine / neck / head: Hip → Waist → Spine01 → Spine02 → Neck → Head (+ tip)
    hip = world_head(monkey, "Hip")
    waist = world_head(monkey, "Waist")
    sp1 = world_head(monkey, "Spine01")
    sp2 = world_head(monkey, "Spine02")
    neck = world_head(monkey, "NeckTwist01")
    head = world_head(monkey, "Head")
    head_tip = world_tail(monkey, "Head")
    # 8 bones → 9 waypoints. Duplicate intermediate so ribcage sits near Spine02.
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
    polyline_fit(garg, SPINE_CHAIN, spine_wp)

    # Arms
    for chain, clav, upper, forearm, hand in (
        (L_ARM_CHAIN, "L_Clavicle", "L_Upperarm", "L_Forearm", "L_Hand"),
        (R_ARM_CHAIN, "R_Clavicle", "R_Upperarm", "R_Forearm", "R_Hand"),
    ):
        c = world_head(monkey, clav)
        u = world_head(monkey, upper)
        f = world_head(monkey, forearm)
        h = world_head(monkey, hand)
        tip = world_tail(monkey, hand)
        # 8 bones → 9 waypoints
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
        polyline_fit(garg, chain, wp)

    # Legs
    for chain, thigh, calf, foot, toe in (
        (L_LEG_CHAIN, "L_Thigh", "L_Calf", "L_Foot", "L_ToeBase"),
        (R_LEG_CHAIN, "R_Thigh", "R_Calf", "R_Foot", "R_ToeBase"),
    ):
        t0 = world_head(monkey, thigh)
        c0 = world_head(monkey, calf)
        f0 = world_head(monkey, foot)
        toe_h = world_head(monkey, toe)
        toe_t = world_tail(monkey, toe)
        # 6 bones → 7 waypoints
        wp = [
            t0,
            t0.lerp(c0, 0.5),
            c0,
            c0.lerp(f0, 0.5),
            f0,
            toe_h,
            toe_t if (toe_t - toe_h).length > 1e-4 else toe_h + Vector((0, -0.03, 0)),
        ]
        polyline_fit(garg, chain, wp)

    # Wings — use monkey wing joints as origins (not ribcage); tips from mesh.
    # Old ribcage bias buried Garg wing roots in the torso → back hump + unweighted tips.
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
        # Nudge root slightly outward along clav→tip so the joint sits on the shoulder
        # socket instead of inside the back (hump).
        out = tip - root
        if out.length > 1e-6:
            root = root + out.normalized() * 0.03
        # 5 bones → 6 waypoints: clav, wing1, wing2, palm, digit, tip
        wp = [
            root,
            w1,
            w2,
            palm,
            digit if (digit - palm).length > 1e-4 else palm.lerp(tip, 0.55),
            tip,
        ]
        polyline_fit(garg, chain, wp)

        # Thumb: short bone off wing2 toward slightly forward / down
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
            # Toward chest / forward relative to wing span
            span = (tip - root).normalized() if (tip - root).length > 1e-6 else Vector((1, 0, 0))
            fwd = span.cross(Vector((0, 0, 1)))
            if fwd.length < 1e-6:
                fwd = Vector((0.0, -1.0, 0.0))
            fwd.normalize()
            th.head = inv @ base_w
            th.tail = inv @ (base_w + fwd * 0.06 + Vector((0, 0, -0.02)))
            th.parent = w2b
            th.align_roll(Vector((0.0, 1.0, 0.0)))
            if thumb2 in eb:
                th2 = eb[thumb2]
                tip_w = garg.matrix_world @ th.tail
                th2.head = th.tail.copy()
                th2.tail = inv @ (tip_w + fwd * 0.04)
                th2.parent = th
                th2.align_roll(Vector((0.0, 1.0, 0.0)))
        bpy.ops.object.mode_set(mode="OBJECT")

    print("proportion fit complete")


def remap_tripo_weights_to_gargoyle(mesh: bpy.types.Object) -> int:
    """Rename/duplicate Tripo(+wing) vertex groups onto Gargoyle bone names."""
    # Snapshot old weights: vert_index -> {group_name: weight}
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
        # Normalize to 1.0
        total = sum(new_w.values()) or 1.0
        for name, w in new_w.items():
            if name not in created:
                mesh.vertex_groups.new(name=name)
                created.add(name)
            mesh.vertex_groups[name].add([vi], w / total, "REPLACE")
        assigned += 1
    print(f"remapped weights on {assigned}/{len(per_vert)} verts → {len(created)} Gargoyle groups")
    return assigned


def bind_mesh_to_armature(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    """Keep remapped vertex groups; parent with Armature modifier (no auto-weights)."""
    for mod in list(mesh.modifiers):
        if mod.type == "ARMATURE":
            mesh.modifiers.remove(mod)
    if mesh.parent:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw

    assigned = remap_tripo_weights_to_gargoyle(mesh)
    if assigned == 0:
        raise RuntimeError("Weight remap produced 0 weighted vertices")

    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_NAME")

    # Ensure modifier points at bind armature
    arm_mod = None
    for mod in mesh.modifiers:
        if mod.type == "ARMATURE":
            arm_mod = mod
            break
    if arm_mod is None:
        arm_mod = mesh.modifiers.new(name="Armature", type="ARMATURE")
    arm_mod.object = arm
    arm_mod.use_vertex_groups = True

    weighted = sum(1 for v in mesh.data.vertices if v.groups)
    print(
        f"bound {mesh.name} → {arm.name} (ARMATURE_NAME), "
        f"weighted={weighted}/{len(mesh.data.vertices)}, groups={len(mesh.vertex_groups)}"
    )
    if weighted == 0:
        raise RuntimeError("Mesh has no skin weights after bind")


def remove_objects(predicate) -> None:
    for o in list(bpy.data.objects):
        if predicate(o):
            bpy.data.objects.remove(o, do_unlink=True)


def export_character(path: Path) -> None:
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
    print(f"wrote character {path} ({path.stat().st_size} bytes)")


def ensure_action_on(arm: bpy.types.Object) -> bpy.types.Action:
    if arm.animation_data and arm.animation_data.action:
        return arm.animation_data.action
    if not bpy.data.actions:
        raise RuntimeError("No actions on Gargoyle FBX")
    act = bpy.data.actions[0]
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    return act


def add_identity_constraints(src: bpy.types.Object, tgt: bpy.types.Object) -> int:
    """Copy Rotation for every shared bone name (no location — scale-space mismatch)."""
    count = 0
    for pb in tgt.pose.bones:
        if pb.name not in src.pose.bones:
            continue
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        rot = pb.constraints.new("COPY_ROTATION")
        rot.target = src
        rot.subtarget = pb.name
        rot.target_space = "WORLD"
        rot.owner_space = "WORLD"
        rot.mix_mode = "REPLACE"
        count += 1
    print(f"identity constraints on {count} bones")
    return count


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
    """Shift keys so clip starts at frame 0 (needed for glTF / Three.js playback)."""
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


def bake_clip_rotations(
    tgt: bpy.types.Object, name: str, frame_start: int, frame_end: int
) -> bpy.types.Action:
    """Deprecated wrapper — prefer rebake_gargoyle_monkey_clips.py (basis copy)."""
    frames = list(range(frame_start, frame_end + 1))
    opts = anim_utils.BakeOptions(
        only_selected=False,
        do_pose=True,
        do_object=False,
        do_visual_keying=True,
        do_constraint_clear=False,
        do_parents_clear=False,
        do_clean=False,
        do_location=False,
        do_rotation=True,
        do_scale=False,
        do_bbone=False,
        do_custom_props=False,
    )
    action = anim_utils.bake_action(tgt, action=None, frames=frames, bake_options=opts)
    if action is None:
        raise RuntimeError(f"bake_action returned None for {name}")
    action.name = name
    retime_action_to_zero(action, frame_start, frame_end)
    print(f"  baked {name}: {action_fcurve_count(action)} fcurves, {len(frames)} frames")
    return action


# NOTE: Full clip rebake uses scripts/rebake_gargoyle_monkey_clips.py
# (matrix_basis rotation copy + anim-only export). World Copy Rotation after
# fit_proportions balls the mesh; do not reintroduce it.

def bake_native_rotations(
    tgt: bpy.types.Object, name: str, frame_start: int, frame_end: int
) -> bpy.types.Action:
    """Sample rotation channels from the action already on tgt."""
    return bake_clip_rotations(tgt, name, frame_start, frame_end)


def bake_clip(tgt: bpy.types.Object, name: str, frame_start: int, frame_end: int) -> bpy.types.Action:
    return bake_clip_rotations(tgt, name, frame_start, frame_end)


def clear_constraints(arm: bpy.types.Object) -> None:
    for pb in arm.pose.bones:
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])


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

    # Export only this armature + meshes it deforms (hide sibling source armature).
    hidden: list[tuple[bpy.types.Object, bool]] = []
    for o in bpy.data.objects:
        if o.type == "ARMATURE" and o != arm:
            hidden.append((o, o.hide_get()))
            o.hide_set(True)
    try:
        bpy.ops.object.select_all(action="DESELECT")
        for o in bpy.data.objects:
            if o.type == "MESH":
                o.hide_set(False)
                o.select_set(True)
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
    print(
        f"  wrote {path.name} ({path.stat().st_size} bytes) "
        f"len={duration}f fcurves={action_fcurve_count(action)}"
    )


def main() -> None:
    monkey_src = MONKEY_WEIGHTED if MONKEY_WEIGHTED.exists() else MONKEY_MASTER
    if not monkey_src.exists():
        raise SystemExit(f"Missing monkey mesh: {monkey_src}")
    if not GARGOYLE_FBX.exists():
        raise SystemExit(f"Missing Gargoyle FBX: {GARGOYLE_FBX}")

    clear_scene()

    # --- 1) Monkey (weighted mesh + landmark armature) ---
    bpy.ops.import_scene.gltf(filepath=str(monkey_src))
    monkey_arm = find_armature_with("Hip", "L_Clavicle")
    monkey_arm.name = "MonkeyRef"
    mesh = find_monkey_mesh()
    mesh.name = "WingedMonkey"
    # Drop tiny helper meshes
    remove_objects(lambda o: o.type == "MESH" and o != mesh)
    print(
        f"monkey mesh={mesh.name} verts={len(mesh.data.vertices)} "
        f"groups={len(mesh.vertex_groups)} ref={monkey_arm.name} src={monkey_src.name}"
    )
    # --- 2) Gargoyle (keep armature + action; drop meshes) ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(GARGOYLE_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    added = [o for o in bpy.data.objects if o not in before]
    garg_src = next(o for o in added if o.type == "ARMATURE")
    garg_src.name = "GargoyleSource"
    # Remove gargoyle meshes (we only need the skeleton + motion)
    for o in list(added):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    scene = bpy.context.scene
    scene.frame_set(0)
    bpy.context.view_layer.update()
    ensure_action_on(garg_src)

    # Align animated source via object xform. Apply SCALE only on the animated
    # source — never apply rotation while an action is bound (curves stay in
    # pre-apply space → candy-wrap on playback).
    scale = align_gargoyle_to_monkey(garg_src, monkey_arm)
    apply_armature_scale_only(garg_src)
    bpy.context.view_layer.update()

    # Bind armature = duplicate at the same object yaw, then apply rot+scale so
    # rest bones match monkey facing with identity object (clean IBMs + skin).
    bpy.ops.object.select_all(action="DESELECT")
    garg_src.select_set(True)
    bpy.context.view_layer.objects.active = garg_src
    bpy.ops.object.duplicate()
    garg = bpy.context.view_layer.objects.active
    assert garg is not None
    garg.name = "GargoyleMonkey"
    if garg.animation_data:
        garg.animation_data_clear()

    garg.location = garg_src.location.copy()
    garg.rotation_euler = garg_src.rotation_euler.copy()
    garg.scale = garg_src.scale.copy()
    apply_armature_transform(garg, location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()
    print(
        "bind rest applied (rot+scale); source keeps object yaw_deg=",
        round(math.degrees(garg_src.rotation_euler[2]), 2),
    )

    # Fit bind bones to monkey landmarks BEFORE skinning (wings especially —
    # unfitted Garg wing roots sat in the torso and humped the back).
    fit_proportions(garg, monkey_arm, mesh)
    bpy.context.view_layer.update()

    # Parent mesh under bind armature
    bind_mesh_to_armature(mesh, garg)

    # Remove landmark monkey armature
    bpy.data.objects.remove(monkey_arm, do_unlink=True)

    # Save character (bind) — temporarily hide source
    garg_src.hide_viewport = True
    garg_src.hide_render = True
    OUT_BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_character(OUT_CHAR)
    garg_src.hide_viewport = False
    garg_src.hide_render = False

    # --- 3) World Copy-Rotation bake from animated source → bind rest ---
    src_action = ensure_action_on(garg_src)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summary = {
        "method": "transplant_gargoyle_fit_wings_skinned_clip_export",
        "sourceObjectYawDeg": round(math.degrees(garg_src.rotation_euler[2]), 3),
        "bindObjectYawDeg": round(math.degrees(garg.rotation_euler[2]), 3),
        "source": str(GARGOYLE_FBX.relative_to(ROOT)),
        "monkeyMaster": str(MONKEY_MASTER.relative_to(ROOT)),
        "monkeyWeighted": str(monkey_src.relative_to(ROOT)),
        "character": str(OUT_CHAR.relative_to(ROOT)),
        "alignScale": scale,
        "weightMapBones": len(WEIGHT_MAP),
        "clips": [],
    }

    add_identity_constraints(garg_src, garg)
    for clip_name, f0, f1 in CLIPS:
        print(f"bake {clip_name} frames {f0}..{f1}")
        garg_src.animation_data.action = src_action
        if garg.animation_data:
            garg.animation_data.action = None
        # Ensure constraints are present for visual bake
        clear_constraints(garg)
        add_identity_constraints(garg_src, garg)
        action = bake_clip_rotations(garg, clip_name, f0, f1)
        # Clear BEFORE glTF export — leftover constraints make the exporter
        # re-bake and can yaw clips 90° off the bind rest.
        clear_constraints(garg)
        out = OUT_DIR / f"{clip_name}.glb"
        export_anim_only(out, garg, action, f0, f1)
        summary["clips"].append(
            {
                "name": clip_name,
                "frames": [f0, f1],
                "file": out.name,
                "bytes": out.stat().st_size,
            }
        )
        if garg.animation_data:
            garg.animation_data.action = None
        bpy.data.actions.remove(action)

    clear_constraints(garg)

    (OUT_DIR / "_bake_summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT_DIR / "README.md").write_text(
        "# Winged Monkey — Gargoyle armature transplant\n\n"
        "The monkey mesh is skinned to a **proportion-fitted Gargoyle skeleton** "
        "(`WingedMonkey_gargoyle.glb`). Clips are visual-baked from "
        "`GargoyleHumanoid.FBX` Take 001 onto that same bone naming.\n\n"
        "## Pipeline\n\n"
        "```bash\n"
        "/Applications/Blender.app/Contents/MacOS/Blender --background \\\n"
        "  --python scripts/transplant_gargoyle_armature_to_monkey.py\n"
        "```\n\n"
        "Masters: `masters/wingedmonkey/meshes/`. Do not edit in place.\n"
    )
    print(f"DONE — {len(summary['clips'])} clips → {OUT_DIR}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("TRANSPLANT FAILED:", e, file=sys.stderr)
        raise
