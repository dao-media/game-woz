# Reskin Step 2 — Bind + native clip verify

- Working copy: `models/wingedmonkey/working/Monkey_reskin_gargoyle_bound.blend`
- Source fit: `models/wingedmonkey/working/Monkey_reskin_gargoyle_fit.blend` (untouched)
- Originals untouched; bone names/hierarchy intact (112); **no retarget**
- Old 21-bone `GargoyleMonkey` armature removed; mesh parented to `ARM_GargoyleNative`
- Bind: **distance-to-bone auto-weights** (Blender heat-map `ARMATURE_AUTO` assigned 0 weights on this dense/non-manifold mesh) + normalize / light smooth / clean
- Clips: native FBX Take 001 local pose copy (rotation + location×0.01) — Idle / Walk / FlyIdleLoop / FlyForward / Attack01
- Previews: `models/wingedmonkey/working/step2_previews/` (Workbench clay)

## Region summary (visual + metrics — worst across clips)

| Region | Verdict | Note |
|---|---|---|
| **torso** | **clean** | Follows spine on Idle/Walk/Fly; no retarget corkscrew |
| **head** | **clean** | Stable on all verified clips |
| **legs** | **minor weight artifacts** | Hip/thigh bunching on tucked poses; matches mild Step-1 thigh offset |
| **arms** | **minor weight artifacts** | Shoulder/armpit compression on raise; Attack swings amplify it |
| **hands** | **clean*** | Palm-only mitt mass — **expected**, not a finger bug |
| **wings** | **minor → broken on Attack** | Idle/Walk/Fly: seated roots OK with some root density. **Attack01 mid: mesh sheet-stretch / corkscrew** — needs weight paint |

\*Hands flagged clean *for intent* (palm-driven). Auto-scorer marked “minor” from large Attack palm bone swings — ignore as finger work.

## Per-clip (visual)

| Clip | Overall | Notes |
|---|---|---|
| **Idle** | clean | Coherent hover/idle body; palm mitts; wing roots dense but intact |
| **Walk** | clean / minor hips | No twist; thigh bunching when legs tuck |
| **FlyIdleLoop** | clean / minor wings | Wings track; watch root pinch on flap |
| **FlyForward** | clean / minor wings | Forward lean coherent; no limb corkscrew |
| **Attack01** | **broken (weights)** | Extreme arm/wing pose exposes bad influences — torso/wing sheet + spiral wing. **Not retarget twist** (native local poses); weight assignment fails under extremes |

## Weight cleanup flags (for you)

Priority for hand-painting (judgment left to you):

1. **Wing roots / membrane** (high) — Attack01 explodes here; also pinch risk on downstroke. Do **not** re-nudge bones (Step-1 seating stands).
2. **Shoulders / clavicle / armpit** (medium) — volume loss on arm raise / Attack.
3. **Hips / thighs** (medium) — bunching on tuck; expected from mild fit offset.
4. **Hands** (info only) — keep palm-mass; do not chase claws.

Applied only: normalize + light smooth + clean(0.01–0.02). No detailed painting.

## Expected non-bugs (carried from fit)

- Hands deform as one palm mass (FBX has no finger bones).
- Wings left seated from Step-1; flag weights only — do not re-nudge.
- Thighs had a few cm fit offset — slightly loose/bunchy is expected.

## Technical notes

- Heat-map automatic weights finished with **empty groups** on this mesh → distance skinning (σ=0.06, r=0.22, top-4).
- Donor Take 001 requires Blender 5 `action_slot` + visible donor for eval; pelvis locations scaled by FBX object scale (0.01) when copying onto identity armature.
- No retarget twist signature on Idle/Walk/Fly — payoff of re-skin holds there.

Stopped before detailed weight painting. Open the bound blend (Idle mid-pose left on armature) to scrub Attack and paint wing roots / shoulders.
