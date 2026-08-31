#!/usr/bin/env python3
"""
Step 0 — Fit report only (no bind, no edits to originals).

Loads GargoyleHumanoid.FBX armature + WingedMonkey_new_wings.glb mesh into an
empty Blender session, aligns scale/pelvis for a fair overlay, then measures how
gargoyle bone rest heads/tails sit relative to the monkey mesh.

Writes:
  models/wingedmonkey/_reskin_fit_report.json
  models/wingedmonkey/_reskin_fit_report.md

Does not save any .blend over masters/originals.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
MONKEY_GLB = ROOT / "models/wingedmonkey/WingedMonkey_new_wings.glb"
FBX = (
    ROOT
    / "Unity/Wizard-of-Oz-Game/Assets/Magic Pig Games (Infinity PBR)/Characters/Gargoyle/Models/GargoyleHumanoid.FBX"
)
OUT_JSON = ROOT / "models/wingedmonkey/_reskin_fit_report.json"
OUT_MD = ROOT / "models/wingedmonkey/_reskin_fit_report.md"

# Region → bone name prefixes / exact names of interest on full gargoyle
REGIONS: dict[str, list[str]] = {
    "hips_pelvis": ["GargPelvis"],
    "spine": ["GargSpine1", "GargSpine2", "GargSpine3", "GargRibcage"],
    "neck_head": ["GargNeck1", "GargNeck2", "GargHead"],
    "left_arm": [
        "GargLArmCollarbone",
        "GargLArmUpperarm1",
        "GargLArmUpperarm2",
        "GargLArmUpperarm3",
        "GargLArmForearm1",
        "GargLArmForearm2",
        "GargLArmForearm3",
    ],
    "right_arm": [
        "GargRCollarbone",
        "GargRUpperarm1",
        "GargRUpperarm2",
        "GargRUpperarm3",
        "GargRForearm1",
        "GargRForearm2",
        "GargRForearm3",
    ],
    "left_hand": [
        "GargLArmPalm",
        "GargLArmFinger11",
        "GargLArmFinger21",
        "GargLArmFinger31",
        "GargLArmFinger41",
        "GargLArmFinger51",
    ],
    "right_hand": [
        "GargRPalm",
        "GargRFinger11",
        "GargRFinger21",
        "GargRFinger31",
        "GargRFinger41",
        "GargRFinger51",
    ],
    "left_leg": [
        "GargLLegThigh1",
        "GargLLegThigh2",
        "GargLLegCalf1",
        "GargLLegCalf2",
        "GargLLegAnkle",
    ],
    "right_leg": [
        "GargRThigh1",
        "GargRThigh2",
        "GargRCalf1",
        "GargRCalf2",
        "GargRAnkle",
    ],
    "left_foot": ["GargLLegAnkle", "GargLLegToe"],
    "right_foot": ["GargRAnkle", "GargRToe"],
    "left_wing": [
        "GargLWingWCollarbone",
        "GargLWing1",
        "GargLWing2",
        "GargLWing3",
        "GargLWing4",
        "GargLWing5",
    ],
    "right_wing": [
        "GargRWingWCollarbone",
        "GargRWing1",
        "GargRWing2",
        "GargRWing3",
        "GargRWing4",
        "GargRWing5",
    ],
}


def clear() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_world_aabb(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    coords = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    mn = Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
    mx = Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
    return mn, mx


def build_bvh(obj: bpy.types.Object) -> BVHTree:
    deps = bpy.context.evaluated_depsgraph_get()
    eval_obj = obj.evaluated_get(deps)
    mesh = eval_obj.to_mesh()
    try:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.transform(obj.matrix_world)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bvh = BVHTree.FromBMesh(bm, epsilon=0.0)
        bm.free()
    finally:
        eval_obj.to_mesh_clear()
    return bvh


def point_inside_mesh(bvh: BVHTree, p: Vector, probes: int = 6) -> tuple[bool, float]:
    """Heuristic: nearest surface distance + ray cast consistency.

    BVH.find_nearest → (location, normal, index, distance)
    """
    nearest = bvh.find_nearest(p)
    if not nearest or nearest[0] is None:
        return False, 999.0
    dist = float(nearest[3])
    axes = [
        Vector((1, 0, 0)),
        Vector((-1, 0, 0)),
        Vector((0, 1, 0)),
        Vector((0, -1, 0)),
        Vector((0, 0, 1)),
        Vector((0, 0, -1)),
    ]
    hits = 0
    for d in axes[:probes]:
        hit = bvh.ray_cast(p, d)
        if hit and hit[0] is not None:
            hits += 1
    inside = hits >= 4 and dist < 0.5
    if dist < 0.02:
        inside = True
    return inside, dist


def bone_samples(arm: bpy.types.Object, name: str) -> list[Vector] | None:
    if name not in arm.data.bones:
        return None
    b = arm.data.bones[name]
    mw = arm.matrix_world
    h = mw @ b.head_local
    t = mw @ b.tail_local
    m = h.lerp(t, 0.5)
    return [h, m, t]


def classify(mean_dist: float, pct_inside: float, height_ratio: float) -> str:
    """good / needs-nudge / needs-scale / structurally-different"""
    if abs(math.log(max(height_ratio, 1e-6))) > math.log(1.35):
        # overall character scale already matched; per-region length ratio
        pass
    if pct_inside >= 0.7 and mean_dist < 0.08:
        return "good"
    if pct_inside >= 0.4 and mean_dist < 0.15:
        return "needs-nudge"
    if mean_dist < 0.35:
        return "needs-scale"
    return "structurally-different"


def main() -> None:
    for p in (MONKEY_GLB, FBX):
        if not p.is_file():
            raise SystemExit(f"missing {p}")

    clear()

    # --- Import monkey (mesh + its armature; we only use mesh for fit) ---
    bpy.ops.import_scene.gltf(filepath=str(MONKEY_GLB))
    monkey_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    monkey_arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not monkey_meshes:
        raise SystemExit("no monkey mesh")
    # Prefer largest mesh
    monkey_mesh = max(monkey_meshes, key=lambda o: len(o.data.vertices))
    monkey_arm = monkey_arms[0] if monkey_arms else None
    mn_m, mx_m = mesh_world_aabb(monkey_mesh)
    monkey_h = mx_m.z - mn_m.z
    monkey_center = (mn_m + mx_m) * 0.5
    print(f"monkey mesh={monkey_mesh.name} verts={len(monkey_mesh.data.vertices)}")
    print(f"  aabb z=[{mn_m.z:.3f},{mx_m.z:.3f}] height={monkey_h:.3f}")

    # Monkey pelvis (for alignment reference)
    monkey_pelvis = None
    if monkey_arm and "GargPelvis" in monkey_arm.data.bones:
        monkey_pelvis = monkey_arm.matrix_world @ monkey_arm.data.bones["GargPelvis"].head_local

    # --- Import gargoyle FBX into same scene ---
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    new_objs = [o for o in bpy.data.objects if o not in before]
    garg_arms = [o for o in new_objs if o.type == "ARMATURE"]
    if not garg_arms:
        garg_arms = [o for o in bpy.data.objects if o.type == "ARMATURE" and o != monkey_arm]
    garg = garg_arms[0]
    # Hide/remove gargoyle mesh so BVH is monkey-only
    for o in list(new_objs):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    # Clear pose
    for pb in garg.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    # FBX often imports at 0.01 scale — apply so we don't stack scales
    bpy.ops.object.select_all(action="DESELECT")
    garg.select_set(True)
    bpy.context.view_layer.objects.active = garg
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()

    # Bone height span after apply
    heads = [garg.matrix_world @ b.head_local for b in garg.data.bones]
    gz_min = min(h.z for h in heads)
    gz_max = max(h.z for h in heads)
    garg_h = gz_max - gz_min
    print(f"garg arm={garg.name} bones={len(garg.data.bones)} height_span={garg_h:.3f}")

    # Align: uniform scale to match height, then translate pelvis to monkey pelvis
    scale = monkey_h / max(garg_h, 1e-6)
    garg.scale = (scale, scale, scale)
    bpy.context.view_layer.update()

    if "GargPelvis" in garg.data.bones and monkey_pelvis is not None:
        g_pel = garg.matrix_world @ garg.data.bones["GargPelvis"].head_local
        delta = monkey_pelvis - g_pel
    else:
        heads2 = [garg.matrix_world @ b.head_local for b in garg.data.bones]
        g_c = Vector(
            (
                sum(h.x for h in heads2) / len(heads2),
                sum(h.y for h in heads2) / len(heads2),
                sum(h.z for h in heads2) / len(heads2),
            )
        )
        delta = monkey_center - g_c
    garg.location += delta
    bpy.context.view_layer.update()
    print(f"align scale={scale:.4f} delta={[round(c, 4) for c in delta]}")

    bvh = build_bvh(monkey_mesh)

    # Optional: monkey wing / hand extents from its own armature for comparison
    monkey_region_notes: dict[str, dict] = {}
    if monkey_arm:
        for label, names in (
            ("monkey_left_wing", ["GargLWing1"]),
            ("monkey_right_wing", ["GargRWing1"]),
            ("monkey_left_hand", ["GargLArmPalm"]),
            ("monkey_right_hand", ["GargRPalm"]),
        ):
            pts = []
            for n in names:
                if n in monkey_arm.data.bones:
                    b = monkey_arm.data.bones[n]
                    pts.append(monkey_arm.matrix_world @ b.head_local)
                    pts.append(monkey_arm.matrix_world @ b.tail_local)
            if pts:
                monkey_region_notes[label] = {
                    "head_tail": [[round(c, 4) for c in p] for p in pts],
                    "len": round((Vector(pts[1]) - Vector(pts[0])).length, 4) if len(pts) >= 2 else None,
                }

    region_reports = []
    all_bone_rows = []

    for region, bone_names in REGIONS.items():
        dists = []
        insides = []
        present = []
        missing = []
        bone_details = []
        for n in bone_names:
            samples = bone_samples(garg, n)
            if samples is None:
                missing.append(n)
                continue
            present.append(n)
            bone_in = []
            bone_d = []
            for p in samples:
                inside, dist = point_inside_mesh(bvh, p)
                bone_in.append(inside)
                bone_d.append(dist)
                insides.append(inside)
                dists.append(dist)
            mean_d = sum(bone_d) / len(bone_d)
            pct_in = sum(1 for x in bone_in if x) / len(bone_in)
            # bone length after align
            length = (samples[2] - samples[0]).length
            row = {
                "bone": n,
                "region": region,
                "head": [round(c, 4) for c in samples[0]],
                "tail": [round(c, 4) for c in samples[2]],
                "length": round(length, 4),
                "mean_dist_to_surface": round(mean_d, 4),
                "pct_samples_inside": round(pct_in, 2),
                "verdict_hint": classify(mean_d, pct_in, 1.0),
            }
            bone_details.append(row)
            all_bone_rows.append(row)

        if not dists:
            region_reports.append(
                {
                    "region": region,
                    "verdict": "structurally-different",
                    "reason": "no matching bones on gargoyle armature",
                    "missing": missing,
                }
            )
            continue

        mean_dist = sum(dists) / len(dists)
        pct_inside = sum(1 for x in insides if x) / len(insides)
        # Length span of region vs monkey AABB size as rough proportion check
        xs = [b["head"][0] for b in bone_details] + [b["tail"][0] for b in bone_details]
        ys = [b["head"][1] for b in bone_details] + [b["tail"][1] for b in bone_details]
        zs = [b["head"][2] for b in bone_details] + [b["tail"][2] for b in bone_details]
        span = Vector((max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)))
        verdict = classify(mean_dist, pct_inside, 1.0)

        # Escalate wings/hands if mostly outside
        if region in ("left_wing", "right_wing", "left_hand", "right_hand") and pct_inside < 0.5:
            if mean_dist > 0.2:
                verdict = "structurally-different"
            elif verdict == "good":
                verdict = "needs-nudge"

        region_reports.append(
            {
                "region": region,
                "verdict": verdict,
                "bones_present": present,
                "bones_missing": missing,
                "mean_dist_to_surface_m": round(mean_dist, 4),
                "pct_samples_inside": round(pct_inside, 2),
                "region_span_xyz_m": [round(c, 4) for c in span],
                "bones": bone_details,
            }
        )

    # Overall summary
    verdict_counts: dict[str, int] = {}
    for r in region_reports:
        verdict_counts[r["verdict"]] = verdict_counts.get(r["verdict"], 0) + 1

    report = {
        "step": 0,
        "status": "fit_report_only_no_bind",
        "originals_untouched": True,
        "inputs": {
            "monkey_mesh": str(MONKEY_GLB),
            "gargoyle_fbx": str(FBX),
            "monkey_mesh_object": monkey_mesh.name,
            "gargoyle_armature": garg.name,
            "gargoyle_bone_count": len(garg.data.bones),
            "monkey_armature": monkey_arm.name if monkey_arm else None,
            "monkey_bone_count": len(monkey_arm.data.bones) if monkey_arm else None,
        },
        "alignment_applied_for_measure_only": {
            "uniform_scale": round(scale, 5),
            "translate": [round(c, 5) for c in delta],
            "note": "Object-level scale+translate in ephemeral Blender session only; nothing saved over originals.",
        },
        "monkey_aabb": {
            "min": [round(c, 4) for c in mn_m],
            "max": [round(c, 4) for c in mx_m],
            "height_m": round(monkey_h, 4),
        },
        "monkey_mvp_landmarks": monkey_region_notes,
        "verdict_counts": verdict_counts,
        "regions": region_reports,
        "callouts": {
            "wings": [r for r in region_reports if "wing" in r["region"]],
            "hands": [r for r in region_reports if "hand" in r["region"]],
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n")

    # Markdown summary
    lines = [
        "# Reskin Step 0 — Fit report (no bind)",
        "",
        f"- Monkey mesh: `{MONKEY_GLB.name}` ({len(monkey_mesh.data.vertices)} verts, height {monkey_h:.3f} m)",
        f"- Gargoyle armature: `{garg.name}` ({len(garg.data.bones)} bones)",
        f"- Measure-only align: uniform scale **{scale:.4f}**, pelvis translate to monkey pelvis",
        f"- Originals untouched; no bind performed",
        "",
        "## Region verdicts",
        "",
        "| Region | Verdict | % inside | mean dist (m) | notes |",
        "|---|---|---:|---:|---|",
    ]
    for r in region_reports:
        notes = ""
        if r.get("bones_missing"):
            notes = f"missing: {', '.join(r['bones_missing'][:4])}"
        lines.append(
            f"| {r['region']} | **{r['verdict']}** | {r.get('pct_samples_inside', 0):.0%} | "
            f"{r.get('mean_dist_to_surface_m', 0):.3f} | {notes} |"
        )
    lines += [
        "",
        "## Wings & hands (detail)",
        "",
    ]
    for r in report["callouts"]["wings"] + report["callouts"]["hands"]:
        lines.append(f"### {r['region']} — {r['verdict']}")
        lines.append(
            f"- samples inside: {r.get('pct_samples_inside', 0):.0%}, mean surface dist: {r.get('mean_dist_to_surface_m', 0):.3f} m"
        )
        for b in r.get("bones", [])[:8]:
            lines.append(
                f"  - `{b['bone']}` len={b['length']:.3f} m  inside={b['pct_samples_inside']:.0%}  "
                f"dist={b['mean_dist_to_surface']:.3f} → {b['verdict_hint']}"
            )
        lines.append("")

    lines += [
        "## Verdict key",
        "- **good** — bones mostly inside volume, close to surface",
        "- **needs-nudge** — close but offset; edit-bone rest nudge should fix",
        "- **needs-scale** — proportion / length mismatch in region",
        "- **structurally-different** — bone chain doesn't correspond to mesh volume (esp. wings/hands)",
        "",
        f"JSON: `{OUT_JSON.relative_to(ROOT)}`",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n")

    print("\n=== REGION VERDICTS ===")
    for r in region_reports:
        print(
            f"  {r['region']:16} {r['verdict']:24} inside={r.get('pct_samples_inside', 0):5.0%} "
            f"dist={r.get('mean_dist_to_surface_m', 0):.3f}"
        )
    print(f"\nwrote {OUT_JSON}")
    print(f"wrote {OUT_MD}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FIT REPORT FAILED:", e, file=sys.stderr)
        raise
