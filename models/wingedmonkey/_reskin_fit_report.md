# Reskin Step 0 — Fit report (no bind)

- Monkey mesh: `WingedMonkey_new_wings.glb` (321302 verts, height 1.000 m)
- Gargoyle armature: `GargRoot` (112 bones)
- Measure-only align: uniform scale **0.3930**, pelvis translate to monkey pelvis
- Originals untouched; no bind performed

## Region verdicts

| Region | Verdict | % inside | mean dist (m) | notes |
|---|---|---:|---:|---|
| hips_pelvis | **good** | 100% | 0.025 |  |
| spine | **good** | 100% | 0.047 |  |
| neck_head | **good** | 100% | 0.029 |  |
| left_arm | **needs-nudge** | 67% | 0.023 |  |
| right_arm | **needs-scale** | 33% | 0.032 |  |
| left_hand | **needs-scale** | 0% | 0.104 | missing: GargLArmFinger11, GargLArmFinger21, GargLArmFinger31, GargLArmFinger41 |
| right_hand | **needs-scale** | 0% | 0.119 | missing: GargRFinger11, GargRFinger21, GargRFinger31, GargRFinger41 |
| left_leg | **needs-nudge** | 67% | 0.024 |  |
| right_leg | **needs-nudge** | 53% | 0.024 |  |
| left_foot | **needs-nudge** | 67% | 0.020 | missing: GargLLegToe |
| right_foot | **needs-scale** | 33% | 0.035 | missing: GargRToe |
| left_wing | **good** | 89% | 0.028 | missing: GargLWing3, GargLWing4, GargLWing5 |
| right_wing | **good** | 89% | 0.025 | missing: GargRWing3, GargRWing4, GargRWing5 |

## Wings & hands (detail)

### left_wing — good
- samples inside: 89%, mean surface dist: 0.028 m
  - `GargLWingWCollarbone` len=0.133 m  inside=100%  dist=0.044 → good
  - `GargLWing1` len=0.159 m  inside=67%  dist=0.019 → needs-nudge
  - `GargLWing2` len=0.190 m  inside=100%  dist=0.020 → good

### right_wing — good
- samples inside: 89%, mean surface dist: 0.025 m
  - `GargRWingWCollarbone` len=0.133 m  inside=100%  dist=0.043 → good
  - `GargRWing1` len=0.159 m  inside=67%  dist=0.020 → needs-nudge
  - `GargRWing2` len=0.190 m  inside=100%  dist=0.011 → good

### left_hand — needs-scale
- samples inside: 0%, mean surface dist: 0.104 m
  - `GargLArmPalm` len=0.072 m  inside=0%  dist=0.104 → needs-scale

### right_hand — needs-scale
- samples inside: 0%, mean surface dist: 0.119 m
  - `GargRPalm` len=0.072 m  inside=0%  dist=0.119 → needs-scale

## Verdict key
- **good** — bones mostly inside volume, close to surface
- **needs-nudge** — close but offset; edit-bone rest nudge should fix
- **needs-scale** — proportion / length mismatch in region
- **structurally-different** — bone chain doesn't correspond to mesh volume (esp. wings/hands)

JSON: `models/wingedmonkey/_reskin_fit_report.json`
