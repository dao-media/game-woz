# Reskin Step 1 — Fit report (not bound)

- Working copy: `models/wingedmonkey/working/Monkey_reskin_gargoyle_fit.blend`
- Originals untouched; hierarchy/names intact (112 bones); **not bound**
- Object transforms baked into bones (identity armature object)
- Hands: palm-only (intentional) — no finger bones in FBX
- Wings: preserved Step-0 fit (no torso-snap nudge)
- Arms: mild length adjust toward monkey palm landmarks (~1.08× / ~1.09× — wrists into hand mesh; not a blind shorten)

| Region | S0 → S1 | S0 dist | S1 dist | Δdist | S1 % inside |
|---|---|---:|---:|---:|---:|
| hips_pelvis | good → **good** | 0.0249 | 0.0249 | 0.0 | 1.0 |
| spine | good → **good** | 0.0472 | 0.0472 | 0.0 | 1.0 |
| neck_head | good → **good** | 0.0293 | 0.0293 | 0.0 | 1.0 |
| left_arm | needs-nudge → **good** | 0.0234 | 0.02 | 0.0034 | 0.9 |
| right_arm | needs-scale → **good** | 0.032 | 0.0111 | 0.0209 | 0.86 |
| left_hand | needs-scale → **good** | 0.1039 | 0.0189 | 0.085 | 0.67 |
| right_hand | needs-scale → **good** | 0.1186 | 0.0051 | 0.1135 | 1.0 |
| left_leg | needs-nudge → **good** | 0.0237 | 0.0308 | -0.0071 | 0.53 |
| right_leg | needs-nudge → **good** | 0.0244 | 0.0334 | -0.009 | 0.47 |
| left_foot | needs-nudge → **good** | 0.0196 | 0.0079 | 0.0117 | 1.0 |
| right_foot | needs-scale → **good** | 0.0352 | 0.0073 | 0.0279 | 1.0 |
| left_wing | good → **good** | 0.0277 | 0.0277 | 0.0 | 0.56 |
| right_wing | good → **good** | 0.0247 | 0.0247 | 0.0 | 0.89 |

## Wings / wrists (callouts)

- **left_wing**: dist 0.0277→0.0277 (Δ0.0), inside 0.56, good→good
- **right_wing**: dist 0.0247→0.0247 (Δ0.0), inside 0.89, good→good
- **left_hand**: dist 0.1039→0.0189 (Δ0.085), inside 0.67, needs-scale→good
- **right_hand**: dist 0.1186→0.0051 (Δ0.1135), inside 1.0, needs-scale→good
- **left_arm**: dist 0.0234→0.02 (Δ0.0034), inside 0.9, needs-nudge→good
- **right_arm**: dist 0.032→0.0111 (Δ0.0209), inside 0.86, needs-scale→good

### Wing digits (informational — not in Step-0 averages)

Digit/palm/thumb bones sit outside the thin wing membrane metrics; weights will drive membrane from the root chain. Left alone.

- left_wing_digits: mean dist 0.213 (needs-scale)
- right_wing_digits: mean dist 0.2234 (needs-scale)

## Adjustments

- `align_baked` {'scale': 0.39303, 'delta': [-0.01046, -0.05221, 0.03237]}
- `scale_chain` {'label': 'L_arm', 'scale': 1.082, 'rot_rad': 0.25}
- `nudge` {'bone': 'GargLArmPalm'}
- `scale_chain` {'label': 'R_arm', 'scale': 1.0948, 'rot_rad': 0.25}
- `nudge` {'bone': 'GargRForearm3'}
- `nudge` {'bone': 'GargRPalm'}
- `scale_chain` {'label': 'L_leg', 'scale': 1.05, 'rot_rad': 0.2062}
- `nudge` {'bone': 'GargLLegToe1'}
- `nudge` {'bone': 'GargLLegToe2'}
- `scale_chain` {'label': 'R_leg', 'scale': 1.05, 'rot_rad': 0.2429}
- `nudge` {'bone': 'GargRToe1'}
- `nudge` {'bone': 'GargRToe2'}
- `wing_preserve` {'side': 'L', 'dist': 0.0888, 'note': 'step0_good_skip_nudge'}
- `wing_preserve` {'side': 'R', 'dist': 0.0849, 'note': 'step0_good_skip_nudge'}

**Stopped before bind.** Ready for Step 2 (auto-weight) after review.
JSON: `models/wingedmonkey/working/_reskin_fit_step1_report.json`
