#!/usr/bin/env python3
"""
Add dress + hair auxiliary bones to Dorothy, aligned to mesh silhouette.

- Reads masters/dorothy/meshes/Dorothy_rigged.glb (never modified)
- Writes models/dorothy/Dorothy_rigged_cloth.glb (derived working rig)

Bones (no bangs — hair is back + sides only):
  Dress_{Front,Back,L,R}_{01,02,03}  under Hips — joints on outer skirt shell
  Hair_Back_{01,02,03}, Hair_{L,R}_{01,02}  under Head — joints on hair mass

Weights:
  - Dress: outer radial shell only (z 0.14–0.56); never peel Foot/Toe/Leg
  - Hair: brown verts behind/beside head; peel Head/neck lightly toward tips

Recommended studio secondary-motion settings (when driving these bones):
  Dress_*: stiffness 0.35–0.45, damping 0.65–0.75, inertia 0.4, max swing ±18°
           tip bones (*_03) softer: stiffness 0.25, max ±28°
  Hair_Back_*: stiffness 0.55 / 0.40 / 0.28 (root→tip), damping 0.7, max ±22°
  Hair_L/R_*: stiffness 0.45 / 0.30, damping 0.7, max ±16°
  Pose smoothening (studio slider): ~0.25–0.35 for cloth clips

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \\
    scripts/add_dorothy_cloth_hair_bones.py
"""
from __future__ import annotations

import array
import math
import sys
import time
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "masters/dorothy/meshes/Dorothy_rigged.glb"
SRC_FALLBACK = ROOT / "models/dorothy/MASTER/Dorothy_rigged.glb"
OUT = ROOT / "models/dorothy/Dorothy_rigged_cloth.glb"

# Dress stays above shoe/stocking band; hair below crown tip.
DRESS_Z_MIN = 0.14
DRESS_Z_MAX = 0.56
HAIR_Z_MIN = 0.72
OUTER_PCT = 0.55  # keep verts with radius >= this percentile within band
FOOT_BONES = {
    "LeftLeg",
    "RightLeg",
    "LeftFoot",
    "RightFoot",
    "LeftToeBase",
    "RightToeBase",
    "LeftToe_End",
    "RightToe_End",
}


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bone_head(arm: bpy.types.Object, name: str) -> Vector:
    return arm.matrix_world @ arm.data.bones[name].head_local


def character_axes(arm: bpy.types.Object) -> tuple[Vector, Vector]:
    """Return (forward, right) in world XY (Z-up)."""
    ls = world_bone_head(arm, "LeftShoulder")
    rs = world_bone_head(arm, "RightShoulder")
    right = Vector((rs.x - ls.x, rs.y - ls.y, 0.0))
    if right.length < 1e-8:
        right = Vector((1.0, 0.0, 0.0))
    else:
        right.normalize()
    fwd = Vector((0.0, 0.0, 1.0)).cross(right)
    if fwd.length < 1e-8:
        fwd = Vector((0.0, -1.0, 0.0))
    else:
        fwd.normalize()
    return fwd, right


def sample_tex(pix: array.array, w: int, h: int, u: float, v: float) -> tuple[float, float, float]:
    x = int(max(0, min(w - 1, (u % 1.0) * w)))
    y = int(max(0, min(h - 1, (v % 1.0) * h)))
    i = (y * w + x) * 4
    return pix[i], pix[i + 1], pix[i + 2]


def vert_uv_avg(mesh: bpy.types.Object) -> dict[int, tuple[float, float]]:
    uv_layer = mesh.data.uv_layers.active.data
    buckets: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for poly in mesh.data.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            buckets[vi].append(tuple(uv_layer[li].uv))
    return {vi: (sum(a for a, _ in uvs) / len(uvs), sum(b for _, b in uvs) / len(uvs)) for vi, uvs in buckets.items()}


def gather_colored(
    mesh: bpy.types.Object,
    arm: bpy.types.Object,
) -> tuple[list[tuple[int, Vector, float, float, float]], list[tuple[int, Vector, float, float, float]]]:
    """Return (dress_pts, hair_pts) as (vi, world_co, rad, along_fwd, along_right)."""
    img = next(i for i in bpy.data.images if i.size[0] > 0)
    w, h = img.size[:]
    pix = array.array("f", img.pixels)
    uv_avg = vert_uv_avg(mesh)
    fwd, right = character_axes(arm)
    hips = world_bone_head(arm, "Hips")
    head = world_bone_head(arm, "Head")

    dress: list[tuple[int, Vector, float, float, float]] = []
    hair: list[tuple[int, Vector, float, float, float]] = []
    for vi, (u, v) in uv_avg.items():
        r, g, b = sample_tex(pix, w, h, u, v)
        co = mesh.matrix_world @ mesh.data.vertices[vi].co
        if DRESS_Z_MIN < co.z < DRESS_Z_MAX and b > 0.28 and b >= r * 0.85 and b >= g * 0.8:
            dx, dy = co.x - hips.x, co.y - hips.y
            rad = math.hypot(dx, dy)
            dress.append((vi, co, rad, dx * fwd.x + dy * fwd.y, dx * right.x + dy * right.y))
        elif co.z > HAIR_Z_MIN and r > 0.25 and r >= g * 0.9 and b < 0.38:
            dx, dy = co.x - head.x, co.y - head.y
            rad = math.hypot(dx, dy)
            hair.append((vi, co, rad, dx * fwd.x + dy * fwd.y, dx * right.x + dy * right.y))
    return dress, hair


def percentile(vals: list[float], p: float) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    return s[min(len(s) - 1, max(0, int(len(s) * p)))]


def sector_mask(name: str, along_f: float, along_r: float) -> bool:
    af, ar = abs(along_f), abs(along_r)
    if name == "Front":
        return along_f > 0.008 and af >= ar * 0.55
    if name == "Back":
        return along_f < -0.008 and af >= ar * 0.55
    if name == "L":
        return along_r > 0.008 and ar >= af * 0.55
    if name == "R":
        return along_r < -0.008 and ar >= af * 0.55
    return False


def band_centroid(
    pts: list[tuple[int, Vector, float, float, float]],
    z0: float,
    z1: float,
    sector: str | None,
    outer_only: bool,
) -> Vector | None:
    band = [t for t in pts if z0 <= t[1].z <= z1]
    if not band:
        return None
    if outer_only:
        thr = percentile([t[2] for t in band], OUTER_PCT)
        band = [t for t in band if t[2] >= thr] or band
    if sector:
        sec = [t for t in band if sector_mask(sector, t[3], t[4])]
        if not sec:
            # fallback: farthest in sector direction
            if sector == "Front":
                sec = sorted(band, key=lambda t: t[3], reverse=True)[: max(1, len(band) // 5)]
            elif sector == "Back":
                sec = sorted(band, key=lambda t: t[3])[: max(1, len(band) // 5)]
            elif sector == "L":
                sec = sorted(band, key=lambda t: t[4], reverse=True)[: max(1, len(band) // 5)]
            else:
                sec = sorted(band, key=lambda t: t[4])[: max(1, len(band) // 5)]
        band = sec
    if not band:
        return None
    return sum((t[1] for t in band), Vector()) / len(band)


def _horiz_rad(p: Vector, hips: Vector) -> float:
    return math.hypot(p.x - hips.x, p.y - hips.y)


def dress_chain_points(
    dress: list[tuple[int, Vector, float, float, float]],
    sector: str,
    hips: Vector,
    direction: Vector,
) -> list[Vector]:
    """3 joints + tip along outer skirt for one sector."""
    bands = [
        (0.48, 0.56),  # waist
        (0.36, 0.46),  # flare
        (0.22, 0.32),  # lower (skip shoe/stocking blue)
        (0.14, 0.22),  # hem tip
    ]
    pts: list[Vector | None] = []
    for z0, z1 in bands:
        pts.append(band_centroid(dress, z0, z1, sector, outer_only=True))

    filled: list[Vector] = []
    for i, c in enumerate(pts):
        z_mid = (bands[i][0] + bands[i][1]) * 0.5
        if c is None:
            if filled:
                # Continue along previous segment, or hang outward
                if len(filled) >= 2:
                    delta = filled[-1] - filled[-2]
                    synth = filled[-1] + delta * 0.85
                    synth.z = z_mid
                else:
                    synth = filled[-1] + direction * 0.04 + Vector((0, 0, z_mid - filled[-1].z))
            else:
                synth = Vector((hips.x, hips.y, z_mid)) + direction * 0.08
            filled.append(synth)
            continue

        # Reject collapsed hem/lower samples that pull back into the legs
        if filled:
            prev = filled[-1]
            if _horiz_rad(c, hips) < _horiz_rad(prev, hips) * 0.82:
                if len(filled) >= 2:
                    delta = prev - filled[-2]
                    c = prev + delta * 0.75
                    c.z = z_mid
                else:
                    c = Vector((prev.x, prev.y, z_mid)) + direction * 0.03
        filled.append(c)
    return filled  # 4 points → 3 bones


def hair_back_points(hair: list[tuple[int, Vector, float, float, float]], head: Vector) -> list[Vector]:
    back = [t for t in hair if t[3] < 0.0]  # behind head
    if len(back) < 20:
        back = hair
    bands = [(0.90, 0.97), (0.82, 0.90), (0.76, 0.82), (0.72, 0.76)]
    out: list[Vector] = []
    for z0, z1 in bands:
        c = band_centroid(back, z0, z1, None, outer_only=False)
        if c is None:
            z = (z0 + z1) * 0.5
            prev = out[-1] if out else head
            c = Vector((prev.x, prev.y + 0.02, z))
        out.append(c)
    return out


def hair_side_points(
    hair: list[tuple[int, Vector, float, float, float]],
    head: Vector,
    side: str,
) -> list[Vector]:
    if side == "L":
        side_pts = [t for t in hair if t[4] > 0.035]
        sdir = 1.0
    else:
        side_pts = [t for t in hair if t[4] < -0.035]
        sdir = -1.0
    if len(side_pts) < 15:
        side_pts = hair
    bands = [(0.88, 0.96), (0.78, 0.88), (0.72, 0.78)]
    out: list[Vector] = []
    for z0, z1 in bands:
        c = band_centroid(side_pts, z0, z1, None, outer_only=False)
        if c is None:
            z = (z0 + z1) * 0.5
            prev = out[-1] if out else head
            c = Vector((prev.x + 0.04 * sdir, prev.y, z))
        out.append(c)
    return out


def add_chain_through_points(
    arm: bpy.types.Object,
    names: list[str],
    parent: str,
    world_points: list[Vector],
) -> None:
    """
    Create len(names) bones through world_points.
    world_points must have len(names)+1 positions (each bone head + final tip).
    """
    assert len(world_points) == len(names) + 1
    aw_inv = arm.matrix_world.inverted()
    parent_eb = arm.data.edit_bones[parent]
    prev = parent_eb
    for i, name in enumerate(names):
        eb = arm.data.edit_bones.new(name)
        eb.head = aw_inv @ world_points[i]
        eb.tail = aw_inv @ world_points[i + 1]
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, -0.02))
        eb.parent = prev
        eb.use_connect = i > 0
        prev = eb


def ensure_vgroup(mesh: bpy.types.Object, name: str) -> bpy.types.VertexGroup:
    vg = mesh.vertex_groups.get(name)
    return vg if vg else mesh.vertex_groups.new(name=name)


def sector_weights(along_f: float, along_r: float) -> dict[str, float]:
    vals = {
        "Front": max(0.0, along_f),
        "Back": max(0.0, -along_f),
        "L": max(0.0, along_r),
        "R": max(0.0, -along_r),
    }
    total = sum(vals.values()) + 1e-8
    return {k: v / total for k, v in vals.items()}


def chain_bone_weights(along: float, n: int) -> list[float]:
    centers = [(i + 0.5) / n for i in range(n)]
    raw = [math.exp(-((along - c) ** 2) / (2 * (0.22**2))) for c in centers]
    s = sum(raw) + 1e-8
    return [w / s for w in raw]


def dominant_body_bone(mesh: bpy.types.Object, vi: int) -> str | None:
    best = None
    bw = -1.0
    for g in mesh.vertex_groups:
        if g.name.startswith("Dress_") or g.name.startswith("Hair_"):
            continue
        try:
            w = g.weight(vi)
        except RuntimeError:
            continue
        if w > bw:
            bw = w
            best = g.name
    return best


def assign_weights(
    mesh: bpy.types.Object,
    arm: bpy.types.Object,
    dress: list[tuple[int, Vector, float, float, float]],
    hair: list[tuple[int, Vector, float, float, float]],
) -> None:
    fwd, right = character_axes(arm)
    hips = world_bone_head(arm, "Hips")
    head = world_bone_head(arm, "Head")

    dress_bones = {sec: [f"Dress_{sec}_{i:02d}" for i in (1, 2, 3)] for sec in ("Front", "Back", "L", "R")}
    hair_back = [f"Hair_Back_{i:02d}" for i in (1, 2, 3)]
    hair_l = [f"Hair_L_{i:02d}" for i in (1, 2)]
    hair_r = [f"Hair_R_{i:02d}" for i in (1, 2)]
    for name in [b for c in dress_bones.values() for b in c] + hair_back + hair_l + hair_r:
        ensure_vgroup(mesh, name)

    # Per-band outer radius thresholds for dress
    dress_outer: set[int] = set()
    for z0, z1 in ((0.48, 0.56), (0.36, 0.46), (0.26, 0.36), (0.14, 0.26)):
        band = [t for t in dress if z0 <= t[1].z <= z1]
        if not band:
            continue
        thr = percentile([t[2] for t in band], OUTER_PCT)
        for t in band:
            if t[2] >= thr:
                dress_outer.add(t[0])

    body_peel_dress = ["Hips", "Spine02", "Spine01", "Spine", "LeftUpLeg", "RightUpLeg"]
    # Never peel calves/feet — that caused foot jank.
    body_peel_hair = ["Head", "head_end", "head_tip", "neck", "Spine"]

    n_dress = 0
    for vi, co, rad, along_f, along_r in dress:
        if vi not in dress_outer:
            continue
        dom = dominant_body_bone(mesh, vi)
        if dom in FOOT_BONES:
            continue
        # Skip verts that are almost entirely lower-leg (inner thigh / stocking)
        if dom in {"LeftLeg", "RightLeg"}:
            continue
        along = max(0.0, min(1.0, (0.54 - co.z) / (0.54 - DRESS_Z_MIN)))
        sec_w = sector_weights(along_f, along_r)
        bone_w = chain_bone_weights(along, 3)
        # Gentler than before — tips get more cloth, roots stay body-led
        cloth_mix = 0.18 + 0.42 * along
        for sec, sw in sec_w.items():
            if sw < 0.08:
                continue
            for bi, bname in enumerate(dress_bones[sec]):
                w = cloth_mix * sw * bone_w[bi]
                if w > 0.012:
                    mesh.vertex_groups[bname].add([vi], w, "REPLACE")
        for bg in body_peel_dress:
            vg = mesh.vertex_groups.get(bg)
            if not vg:
                continue
            try:
                old = vg.weight(vi)
            except RuntimeError:
                continue
            vg.add([vi], old * (1.0 - cloth_mix * 0.70), "REPLACE")
        n_dress += 1

    n_hair = 0
    for vi, co, rad, along_f, along_r in hair:
        # No bangs: ignore front-dominant scalp fringe
        if along_f > 0.04 and abs(along_f) > abs(along_r) * 1.2:
            continue
        along = max(0.0, min(1.0, (0.94 - co.z) / 0.22))
        sec_w = sector_weights(along_f, along_r)
        cloth_mix = 0.22 + 0.50 * along
        bw3 = chain_bone_weights(along, 3)
        bw2 = chain_bone_weights(along, 2)
        back_w = max(sec_w["Back"], 0.20)
        side_l = sec_w["L"]
        side_r = sec_w["R"]

        def add_chain(names: list[str], sector: float, weights: list[float]) -> None:
            if sector < 0.10:
                return
            for bi, bname in enumerate(names):
                w = cloth_mix * sector * weights[bi]
                if w > 0.012:
                    mesh.vertex_groups[bname].add([vi], w, "REPLACE")

        add_chain(hair_back, back_w, bw3)
        add_chain(hair_l, side_l, bw2)
        add_chain(hair_r, side_r, bw2)
        for bg in body_peel_hair:
            vg = mesh.vertex_groups.get(bg)
            if not vg:
                continue
            try:
                old = vg.weight(vi)
            except RuntimeError:
                continue
            vg.add([vi], old * (1.0 - cloth_mix * 0.65), "REPLACE")
        n_hair += 1

    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"weights: dress_outer_verts={n_dress} hair_verts={n_hair} (≤4 influences)")


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
    t0 = time.time()
    src = SRC if SRC.exists() else SRC_FALLBACK
    if not src.exists():
        raise SystemExit(f"Missing source: {src}")

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH")
    arm.name = "Armature"
    print(f"source {src} bones={len(arm.data.bones)} verts={len(mesh.data.vertices)}")

    fwd, right = character_axes(arm)
    hips = world_bone_head(arm, "Hips")
    head = world_bone_head(arm, "Head")
    print(f"fwd={tuple(round(c, 3) for c in fwd)} hips_z={hips.z:.3f} head_z={head.z:.3f}")

    dress, hair = gather_colored(mesh, arm)
    print(f"classified dress={len(dress)} hair={len(hair)}")

    dress_dirs = {"Front": fwd, "Back": -fwd, "L": right, "R": -right}
    dress_pts = {sec: dress_chain_points(dress, sec, hips, d) for sec, d in dress_dirs.items()}
    hair_back_pts = hair_back_points(hair, head)
    hair_l_pts = hair_side_points(hair, head, "L")
    hair_r_pts = hair_side_points(hair, head, "R")

    for sec, pts in dress_pts.items():
        print(f"  Dress_{sec}: " + " → ".join(f"({p.x:.3f},{p.y:.3f},{p.z:.3f})" for p in pts))
    print("  Hair_Back: " + " → ".join(f"({p.x:.3f},{p.y:.3f},{p.z:.3f})" for p in hair_back_pts))
    print("  Hair_L: " + " → ".join(f"({p.x:.3f},{p.y:.3f},{p.z:.3f})" for p in hair_l_pts))
    print("  Hair_R: " + " → ".join(f"({p.x:.3f},{p.y:.3f},{p.z:.3f})" for p in hair_r_pts))

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")

    for sec, pts in dress_pts.items():
        add_chain_through_points(
            arm,
            [f"Dress_{sec}_{i:02d}" for i in (1, 2, 3)],
            "Hips",
            pts,
        )
    add_chain_through_points(arm, [f"Hair_Back_{i:02d}" for i in (1, 2, 3)], "Head", hair_back_pts)
    add_chain_through_points(arm, [f"Hair_L_{i:02d}" for i in (1, 2)], "Head", hair_l_pts)
    add_chain_through_points(arm, [f"Hair_R_{i:02d}" for i in (1, 2)], "Head", hair_r_pts)

    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"bones now {len(arm.data.bones)}")

    assign_weights(mesh, arm, dress, hair)

    mods = [m for m in mesh.modifiers if m.type == "ARMATURE"]
    if not mods:
        mod = mesh.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
    else:
        mods[0].object = arm

    export_glb(OUT)
    cloth = [b.name for b in arm.data.bones if b.name.startswith("Dress_") or b.name.startswith("Hair_")]
    print(f"DONE cloth/hair bones ({len(cloth)}): {', '.join(cloth)}")
    print(f"elapsed {time.time() - t0:.1f}s")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FAILED:", e, file=sys.stderr)
        raise
