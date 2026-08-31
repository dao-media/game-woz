#!/usr/bin/env python3
"""
Step 1 — Fit gargoyle skeleton into monkey mesh (rest only, no bind).

Pipeline:
  1) Import monkey mesh + gargoyle FBX (copies only)
  2) Step-0 align (apply FBX scale → height factor → pelvis snap)
  3) Bake object matrix into bones (identity object) BEFORE edits
  4) Mild rest-position fit (arms/legs/wings/palms)
  5) Save working blend + report vs Step-0
"""
from __future__ import annotations

import json
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
STEP0 = ROOT / "models/wingedmonkey/_reskin_fit_report.json"
WORK = ROOT / "models/wingedmonkey/working"
BLEND = WORK / "Monkey_reskin_gargoyle_fit.blend"
OUT_JSON = WORK / "_reskin_fit_step1_report.json"
OUT_MD = WORK / "_reskin_fit_step1_report.md"

REGIONS = {
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
    "left_hand": ["GargLArmPalm"],
    "right_hand": ["GargRPalm"],
    "left_leg": [
        "GargLLegThigh1",
        "GargLLegThigh2",
        "GargLLegCalf1",
        "GargLLegCalf2",
        "GargLLegAnkle",
    ],
    "right_leg": ["GargRThigh1", "GargRThigh2", "GargRCalf1", "GargRCalf2", "GargRAnkle"],
    "left_foot": ["GargLLegAnkle", "GargLLegToe1", "GargLLegToe2"],
    "right_foot": ["GargRAnkle", "GargRToe1", "GargRToe2"],
    "left_wing": [
        "GargLWingWCollarbone",
        "GargLWing1",
        "GargLWing2",
        # Digits/palm/thumb measured separately — Step-0 compared roots only.
    ],
    "right_wing": [
        "GargRWingWCollarbone",
        "GargRWing1",
        "GargRWing2",
    ],
    # Informational (not in Step-0 region averages):
    "left_wing_digits": [
        "GargLWingLDigit1",
        "GargLWingLDigit2",
        "GargLWingLWingPalm",
        "GargWingThumbL",
        "GargWingThumbL2",
    ],
    "right_wing_digits": [
        "GargRWingRDigit1",
        "GargRWingRDigit2",
        "GargRWingRWingPalm",
        "GargWingThumbR",
        "GargWingThumbR2",
    ],
}

ADJ: list[dict] = []


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bvh_of(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    try:
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.transform(obj.matrix_world)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        tree = BVHTree.FromBMesh(bm, epsilon=0.0)
        bm.free()
    finally:
        ev.to_mesh_clear()
    return tree


def nearest(bvh, p):
    r = bvh.find_nearest(p)
    if not r or r[0] is None:
        return None, None, 999.0
    return Vector(r[0]), Vector(r[1]).normalized(), float(r[3])


def inside_dist(bvh, p):
    loc, n, d = nearest(bvh, p)
    if loc is None:
        return False, 999.0
    signed = (p - loc).dot(n)
    return (signed <= 0.008 or d < 0.015), d


def pull_in(bvh, p, inset=0.012):
    loc, n, d = nearest(bvh, p)
    if loc is None:
        return p.copy()
    ok, _ = inside_dist(bvh, p)
    if ok:
        return p.copy()
    return loc - n * inset


def classify(md, pct):
    if md < 0.05:
        return "good"
    if pct >= 0.7 and md < 0.08:
        return "good"
    if pct >= 0.4 and md < 0.15:
        return "needs-nudge"
    if md < 0.35:
        return "needs-scale"
    return "structurally-different"


def bw(arm, name):
    if name not in arm.data.bones:
        return None
    b = arm.data.bones[name]
    mw = arm.matrix_world
    return mw @ b.head_local, mw @ b.tail_local


def ml(marm, name):
    if marm is None or name not in marm.data.bones:
        return None
    return marm.matrix_world @ marm.data.bones[name].head_local


def edit_on(arm):
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")


def edit_off():
    bpy.ops.object.mode_set(mode="OBJECT")


def measure(arm, bvh):
    rows = []
    for region, names in REGIONS.items():
        dists, inns, bones, missing = [], [], [], []
        for n in names:
            wt = bw(arm, n)
            if not wt:
                missing.append(n)
                continue
            h, t = wt
            samples = (h, h.lerp(t, 0.5), t)
            bd, bi = [], []
            for p in samples:
                ok, d = inside_dist(bvh, p)
                bd.append(d)
                bi.append(ok)
                dists.append(d)
                inns.append(ok)
            bones.append(
                {
                    "bone": n,
                    "length": round((t - h).length, 4),
                    "mean_dist_to_surface": round(sum(bd) / len(bd), 4),
                    "pct_samples_inside": round(sum(1 for x in bi if x) / len(bi), 2),
                    "head": [round(c, 4) for c in h],
                    "tail": [round(c, 4) for c in t],
                }
            )
        if not dists:
            rows.append(
                {
                    "region": region,
                    "verdict": "structurally-different",
                    "pct_samples_inside": 0,
                    "mean_dist_to_surface_m": 999,
                    "bones": [],
                    "bones_missing": missing,
                }
            )
            continue
        md = sum(dists) / len(dists)
        pct = sum(1 for x in inns if x) / len(inns)
        rows.append(
            {
                "region": region,
                "verdict": classify(md, pct),
                "pct_samples_inside": round(pct, 2),
                "mean_dist_to_surface_m": round(md, 4),
                "bones": bones,
                "bones_missing": missing,
            }
        )
    return rows


def bake_mw_to_bones(arm) -> bool:
    """Capture world heads/tails at current align, then bake into identity object."""
    bpy.context.view_layer.update()
    # Capture WHILE align scale is still applied — do not clear anim yet.
    cap = {}
    for b in arm.data.bones:
        wt = bw(arm, b.name)
        if wt:
            cap[b.name] = (wt[0].copy(), wt[1].copy())
    sh, pl = cap.get("GargLArmUpperarm1"), cap.get("GargLArmPalm")
    span = (pl[0] - sh[0]).length if sh and pl else 0.0
    print(f"bake_in span={span:.4f} scale={list(arm.scale)} loc={list(arm.location)}")
    if span < 0.1:
        return False
    # FBX actions re-apply 0.01 scale on mode switch — clear after capture.
    if arm.animation_data:
        arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.parent = None
    arm.location = (0, 0, 0)
    arm.rotation_euler = (0, 0, 0)
    arm.rotation_quaternion = (1, 0, 0, 0)
    arm.scale = (1, 1, 1)
    arm.delta_location = (0, 0, 0)
    arm.delta_rotation_euler = (0, 0, 0)
    arm.delta_scale = (1, 1, 1)
    bpy.context.view_layer.update()
    edit_on(arm)
    # Disconnect everything first — connected children snap when parents move.
    for eb in arm.data.edit_bones:
        eb.use_connect = False
    for name, (h, t) in cap.items():
        eb = arm.data.edit_bones.get(name)
        if not eb:
            continue
        eb.head = h
        eb.tail = t
        if (eb.tail - eb.head).length < 1e-6:
            eb.tail = eb.head + Vector((0, 0.01, 0))
    edit_off()
    # Re-assert identity — some importers resurrect scale on mode switch.
    arm.scale = (1, 1, 1)
    arm.location = (0, 0, 0)
    bpy.context.view_layer.update()
    sh2, pl2 = bw(arm, "GargLArmUpperarm1"), bw(arm, "GargLArmPalm")
    span2 = (pl2[0] - sh2[0]).length if sh2 and pl2 else 0.0
    print(f"bake_out span={span2:.4f} scale={list(arm.scale)}")
    return span2 >= 0.1


def set_bone(arm, name, head_w, tail_w):
    edit_on(arm)
    eb = arm.data.edit_bones.get(name)
    if eb:
        eb.use_connect = False
        # object is identity after bake
        eb.head = head_w
        eb.tail = tail_w
    edit_off()
    bpy.context.view_layer.update()


def translate_chain(arm, names, delta):
    if delta.length < 1e-8:
        return
    edit_on(arm)
    for n in names:
        eb = arm.data.edit_bones.get(n)
        if not eb:
            continue
        eb.use_connect = False
        eb.head = Vector(eb.head) + delta
        eb.tail = Vector(eb.tail) + delta
    edit_off()
    bpy.context.view_layer.update()


def scale_chain_about(arm, names, pivot, old_end, new_end, label):
    v0 = old_end - pivot
    v1 = new_end - pivot
    if v0.length < 0.05:
        ADJ.append({"op": "scale_skip", "label": label, "reason": "short_chain"})
        return
    # Arms: mild length change. Legs: tighter — Step-0 was already close.
    lo, hi = (0.82, 1.10) if "arm" in label else (0.92, 1.05)
    s = max(lo, min(hi, v1.length / v0.length))
    q = v0.normalized().rotation_difference(v1.normalized())
    # Cap rotation so clips stay runnable (~14°).
    if q.angle > 0.25:
        from mathutils import Quaternion as _Q

        q = _Q(q.axis, 0.25)

    def mp(p):
        return pivot + q @ ((p - pivot) * s)

    edit_on(arm)
    for n in names:
        eb = arm.data.edit_bones.get(n)
        if not eb:
            continue
        eb.use_connect = False
        eb.head = mp(Vector(eb.head))
        eb.tail = mp(Vector(eb.tail))
    edit_off()
    bpy.context.view_layer.update()
    ADJ.append(
        {
            "op": "scale_chain",
            "label": label,
            "scale": round(s, 4),
            "rot_rad": round(float(q.angle), 4),
        }
    )
    print(f"  {label} scale={s:.3f} len {v0.length:.3f}->{v1.length:.3f}")


def nudge_bone(arm, name, bvh):
    wt = bw(arm, name)
    if not wt:
        return
    h, t = wt
    ok_h, dh = inside_dist(bvh, h)
    ok_t, dt = inside_dist(bvh, t)
    if ok_h and ok_t and max(dh, dt) < 0.03:
        return
    length = (t - h).length
    nh, nt = pull_in(bvh, h), pull_in(bvh, t)
    mid = nh.lerp(nt, 0.5)
    d = nt - nh
    if d.length < 1e-6:
        d = t - h
    if d.length < 1e-6:
        return
    d.normalize()
    set_bone(arm, name, mid - d * length * 0.5, mid + d * length * 0.5)
    ADJ.append({"op": "nudge", "bone": name})


def fit_limb(arm, marm, bvh, chain, pivot_n, end_n, m_piv_n, m_end_n, label):
    piv = bw(arm, pivot_n)
    end = bw(arm, end_n)
    if not piv or not end:
        return
    mp = ml(marm, m_piv_n)
    me = ml(marm, m_end_n)
    if mp is not None:
        delta = (mp - piv[0]) * 0.35
        if delta.length > 0.04:
            delta = delta.normalized() * 0.04
        translate_chain(arm, chain, delta)
        piv = bw(arm, pivot_n)
        end = bw(arm, end_n)
        if not piv or not end:
            return
    target = pull_in(bvh, me if me is not None else end[0])
    scale_chain_about(arm, chain, piv[0], end[0], target, label)
    for n in chain[-3:]:
        nudge_bone(arm, n, bvh)


def fit_wings(arm, marm, bvh):
    """Step-0: wings already good (~2–3 cm inside). Do not pull_in/nudge —
    nearest-surface on thin wing mesh often snaps to the torso and wrecks the fit.
    Only apply a tiny root inset if WCollarbone head is clearly outside the volume.
    """
    del marm
    for side, roots, chain in [
        (
            "L",
            ["GargLWingWCollarbone", "GargLWing1", "GargLWing2"],
            [
                "GargLWingWCollarbone",
                "GargLWing1",
                "GargLWing2",
                "GargLWingLDigit1",
                "GargLWingLDigit2",
                "GargLWingLWingPalm",
                "GargWingThumbL",
                "GargWingThumbL2",
            ],
        ),
        (
            "R",
            ["GargRWingWCollarbone", "GargRWing1", "GargRWing2"],
            [
                "GargRWingWCollarbone",
                "GargRWing1",
                "GargRWing2",
                "GargRWingRDigit1",
                "GargRWingRDigit2",
                "GargRWingRWingPalm",
                "GargWingThumbR",
                "GargWingThumbR2",
            ],
        ),
    ]:
        cb = bw(arm, roots[0])
        if not cb:
            continue
        ok, d = inside_dist(bvh, cb[0])
        # Only act if root is clearly outside AND far from surface.
        if ok or d < 0.04:
            ADJ.append(
                {
                    "op": "wing_preserve",
                    "side": side,
                    "dist": round(d, 4),
                    "note": "step0_good_skip_nudge",
                }
            )
            print(f"  wing_{side} preserve dist={d:.3f}")
            continue
        # Conservative: move whole chain a few cm toward nearest point, no per-bone nudge.
        loc, n, _ = nearest(bvh, cb[0])
        if loc is None:
            continue
        delta = (loc - n * 0.01) - cb[0]
        if delta.length > 0.03:
            delta = delta.normalized() * 0.03
        translate_chain(arm, chain, delta)
        ADJ.append({"op": "wing_root", "side": side, "delta": round(delta.length, 4)})
        print(f"  wing_{side} root_nudge={delta.length:.3f}")


def main():
    ADJ.clear()
    WORK.mkdir(parents=True, exist_ok=True)
    step0 = json.loads(STEP0.read_text()) if STEP0.is_file() else None

    clear()
    bpy.ops.import_scene.gltf(filepath=str(MONKEY_GLB))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    monkey = max(meshes, key=lambda o: len(o.data.vertices))
    marm = arms[0] if arms else None
    bb = [monkey.matrix_world @ Vector(c) for c in monkey.bound_box]
    monkey_h = max(v.z for v in bb) - min(v.z for v in bb)
    mpel = ml(marm, "GargPelvis")
    print(f"monkey={monkey.name} verts={len(monkey.data.vertices)} h={monkey_h:.3f}")

    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=str(FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    new = [o for o in bpy.data.objects if o not in before]
    garg = [o for o in new if o.type == "ARMATURE"][0]
    for o in list(new):
        if o.type == "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    for pb in garg.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    # Step-0 align exactly
    bpy.ops.object.select_all(action="DESELECT")
    garg.select_set(True)
    bpy.context.view_layer.objects.active = garg
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()
    heads = [garg.matrix_world @ b.head_local for b in garg.data.bones]
    gh = max(h.z for h in heads) - min(h.z for h in heads)
    sc = monkey_h / max(gh, 1e-6)
    garg.scale = (sc, sc, sc)
    bpy.context.view_layer.update()
    if "GargPelvis" in garg.data.bones and mpel is not None:
        gp = garg.matrix_world @ garg.data.bones["GargPelvis"].head_local
        delta = mpel - gp
    else:
        delta = Vector((0, 0, 0))
    garg.location += delta
    bpy.context.view_layer.update()
    print(f"align scale={sc:.4f} delta={[round(c,4) for c in delta]}")
    sh, pl = bw(garg, "GargLArmUpperarm1"), bw(garg, "GargLArmPalm")
    print(f"aligned L span={(pl[0]-sh[0]).length if sh and pl else None:.4f}")

    # Bake to identity BEFORE edits
    if not bake_mw_to_bones(garg):
        raise SystemExit("failed to bake align into bones")
    ADJ.append({"op": "align_baked", "scale": round(sc, 5), "delta": [round(c, 5) for c in delta]})

    if marm:
        marm.hide_viewport = True
        marm.hide_render = True

    tree = bvh_of(monkey)
    pre = measure(garg, tree)
    for r in pre:
        if "wing" in r["region"] or "hand" in r["region"]:
            print(
                f"  pre_fit {r['region']}: dist={r['mean_dist_to_surface_m']} "
                f"inside={r['pct_samples_inside']} {r['verdict']}"
            )

    # Fit (object is identity)
    fit_limb(
        garg,
        marm,
        tree,
        [
            "GargLArmCollarbone",
            "GargLArmUpperarm1",
            "GargLArmUpperarm2",
            "GargLArmUpperarm3",
            "GargLArmForearm1",
            "GargLArmForearm2",
            "GargLArmForearm3",
            "GargLArmPalm",
        ],
        "GargLArmUpperarm1",
        "GargLArmPalm",
        "GargLArmUpperarm1",
        "GargLArmPalm",
        "L_arm",
    )
    fit_limb(
        garg,
        marm,
        tree,
        [
            "GargRCollarbone",
            "GargRUpperarm1",
            "GargRUpperarm2",
            "GargRUpperarm3",
            "GargRForearm1",
            "GargRForearm2",
            "GargRForearm3",
            "GargRPalm",
        ],
        "GargRUpperarm1",
        "GargRPalm",
        "GargRUpperarm1",
        "GargRPalm",
        "R_arm",
    )
    fit_limb(
        garg,
        marm,
        tree,
        [
            "GargLLegThigh1",
            "GargLLegThigh2",
            "GargLLegCalf1",
            "GargLLegCalf2",
            "GargLLegAnkle",
            "GargLLegToe1",
            "GargLLegToe2",
        ],
        "GargLLegThigh1",
        "GargLLegAnkle",
        "GargLLegThigh1",
        "GargLLegAnkle",
        "L_leg",
    )
    fit_limb(
        garg,
        marm,
        tree,
        [
            "GargRThigh1",
            "GargRThigh2",
            "GargRCalf1",
            "GargRCalf2",
            "GargRAnkle",
            "GargRToe1",
            "GargRToe2",
        ],
        "GargRThigh1",
        "GargRAnkle",
        "GargRThigh1",
        "GargRAnkle",
        "R_leg",
    )
    mid = measure(garg, tree)
    for r in mid:
        if "wing" in r["region"]:
            print(
                f"  post_limbs {r['region']}: dist={r['mean_dist_to_surface_m']} "
                f"inside={r['pct_samples_inside']} {r['verdict']}"
            )
    fit_wings(garg, marm, tree)

    tree = bvh_of(monkey)
    after = measure(garg, tree)
    s0by = {r["region"]: r for r in (step0 or {}).get("regions", [])}
    comps = []
    for r in after:
        s0 = s0by.get(r["region"], {})
        comps.append(
            {
                "region": r["region"],
                "step0_verdict": s0.get("verdict"),
                "step1_verdict": r["verdict"],
                "step0_pct_inside": s0.get("pct_samples_inside"),
                "step1_pct_inside": r["pct_samples_inside"],
                "step0_mean_dist_m": s0.get("mean_dist_to_surface_m"),
                "step1_mean_dist_m": r["mean_dist_to_surface_m"],
                "dist_improved": (
                    None
                    if s0.get("mean_dist_to_surface_m") is None
                    else round(float(s0["mean_dist_to_surface_m"]) - float(r["mean_dist_to_surface_m"]), 4)
                ),
            }
        )

    garg.name = "ARM_GargoyleNative"
    garg.data.name = "ARM_GargoyleNative"
    monkey.name = "SM_WingedMonkey_reskin"
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    report = {
        "step": 1,
        "status": "fitted_not_bound",
        "originals_untouched": True,
        "working_blend": str(BLEND),
        "transforms_baked": True,
        "hands_policy": "palm_only",
        "adjustments": ADJ,
        "regions_after": after,
        "vs_step0": comps,
    }
    OUT_JSON.write_text(json.dumps(report, indent=2) + "\n")

    lines = [
        "# Reskin Step 1 — Fit report (not bound)",
        "",
        f"- Working copy: `{BLEND.relative_to(ROOT)}`",
        "- Originals untouched; hierarchy/names intact (112 bones); **not bound**",
        "- Object transforms baked into bones (identity armature object)",
        "- Hands: palm-only (intentional) — no finger bones in FBX",
        "- Wings: preserved Step-0 fit (no torso-snap nudge)",
        "- Arms: mild length adjust toward monkey palm landmarks "
        "(~1.08× / ~1.09× — wrists into hand mesh; not a blind shorten)",
        "",
        "| Region | S0 → S1 | S0 dist | S1 dist | Δdist | S1 % inside |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for c in comps:
        if "digits" in c["region"]:
            continue
        r1 = next(x for x in after if x["region"] == c["region"])
        lines.append(
            f"| {c['region']} | {c['step0_verdict']} → **{c['step1_verdict']}** | "
            f"{c['step0_mean_dist_m']} | {c['step1_mean_dist_m']} | {c['dist_improved']} | "
            f"{r1['pct_samples_inside']} |"
        )
    lines += [
        "",
        "## Wings / wrists (callouts)",
        "",
    ]
    for key in ("left_wing", "right_wing", "left_hand", "right_hand", "left_arm", "right_arm"):
        c = next(x for x in comps if x["region"] == key)
        r1 = next(x for x in after if x["region"] == key)
        lines.append(
            f"- **{c['region']}**: dist {c['step0_mean_dist_m']}→{c['step1_mean_dist_m']} "
            f"(Δ{c['dist_improved']}), inside {r1['pct_samples_inside']}, "
            f"{c['step0_verdict']}→{c['step1_verdict']}"
        )
    lines += [
        "",
        "### Wing digits (informational — not in Step-0 averages)",
        "",
        "Digit/palm/thumb bones sit outside the thin wing membrane metrics; "
        "weights will drive membrane from the root chain. Left alone.",
        "",
    ]
    for c in comps:
        if "digits" not in c["region"]:
            continue
        lines.append(f"- {c['region']}: mean dist {c['step1_mean_dist_m']} ({c['step1_verdict']})")
    lines += ["", "## Adjustments", ""]
    for a in ADJ:
        lines.append(f"- `{a.get('op')}` { {k:v for k,v in a.items() if k!='op'} }")
    lines += [
        "",
        "**Stopped before bind.** Ready for Step 2 (auto-weight) after review.",
        f"JSON: `{OUT_JSON.relative_to(ROOT)}`",
    ]
    OUT_MD.write_text("\n".join(lines) + "\n")

    print("\n=== STEP1 vs STEP0 ===")
    for c in comps:
        print(
            f"  {c['region']:16} {c['step0_verdict']}->{c['step1_verdict']:20} "
            f"d={c['step0_mean_dist_m']}->{c['step1_mean_dist_m']} Δ{c['dist_improved']}"
        )
    print(f"wrote {BLEND}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("STEP1 FAILED:", e, file=sys.stderr)
        raise
