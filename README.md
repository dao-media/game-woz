# OZ: Down the Yellow Brick Road (WOZ Game)

Portable Phaser 3 greybox — **one-point perspective** floor-plane travel with rhythm combat, utility AI, difficulty presets, triggered encounters, and feet-anchored VFX.

Private repo: [dao-media/game-woz](https://github.com/dao-media/game-woz)

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [Commands & dev tools](#commands--dev-tools)
3. [Scene flow](#scene-flow)
4. [Controls](#controls)
5. [Coordinate system & proportions](#coordinate-system--proportions)
6. [Color palette](#color-palette)
7. [Movement & jump](#movement--jump)
8. [Combat settings](#combat-settings)
9. [UI & HUD](#ui--hud)
10. [Effects (VFX)](#effects-vfx)
11. [AI, difficulty & encounters](#ai-difficulty--encounters)
12. [Fork paths](#fork-paths)
13. [Assets](#assets)
14. [Preload manifest](#preload-manifest)
15. [Pipelines & scripts](#pipelines--scripts)
16. [Architecture](#architecture)
17. [Persistence](#persistence)
18. [Rules of the house](#rules-of-the-house)
19. [Roadmap & playtest](#roadmap--playtest)

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Engine | **Phaser 3.90** | WebGL renderer; Phaser postFX glow for slipper aura |
| Language | **TypeScript** (strict) | `tsc` before production build |
| Bundler | **Vite 8** | `base: './'` — relative paths for file://, itch.io, embedded WebView |
| Build target | **ES2022** | MPA: game + three studio HTML entry points |
| Physics | **Arcade** | Gravity `{0,0}` — all motion is custom floor-plane |
| 3D (studios only) | **Three.js 0.185** | 3D studio / particle studio; not in main game loop |
| Compression | **fflate** | Studio tooling |
| Persistence | `Storage` interface → `WebStorage` (`localStorage`) | Keys: `oz.runState`, `oz.settings` |
| Binary assets | **Git LFS** | `*.png`, `*.jpg`, `*.glb`, `*.fbx`, `*.blend`, `*.mov`, `*.jpeg` |

**Vite config** (`vite.config.ts`):

| Setting | Value |
|---------|-------|
| Dev server | `http://127.0.0.1:5180` (`strictPort: true`) |
| App type | MPA (no SPA fallback for `.glb`/`.fbx`) |
| Entry HTML | `index.html`, `3d-studio.html`, `particle-studio.html`, `env-studio.html` |
| Output | `dist/` + `dist/assets/` |

**Phaser game config** (`src/main.ts`):

| Setting | Value |
|---------|-------|
| Resolution | **960 × 540** |
| Scale mode | `FIT`, centered |
| Render | Antialias on, pixelArt off |
| Background | `tuning.colors.background` (`0x1a1a1e`) |

**Single source of truth for gameplay numbers:** `src/config/tuning.ts` — no magic numbers in logic.

---

## Commands & dev tools

```bash
npm install
npm run dev              # game — http://127.0.0.1:5180
npm run build            # tsc && vite build → dist/
npm run preview          # serve dist/ (verify relative asset paths)
npm run env-studio       # environment tuning studio
```

| URL / file | Purpose |
|------------|---------|
| `/` (`index.html`) | Main game |
| `/3d-studio.html` | Three.js rig / clip preview |
| `/particle-studio.html` | Particle authoring |
| `/env-studio.html` | Stage / atmosphere tuning |

**Blender bake scripts:**

```bash
npm run bake:dorothy-wave     # Mixamo FBX → Dorothy GLB clips
npm run bake:dorothy-mixamo    # mixamo_character pack bake
```

**Feet / FX caches (after sprite or burst sheet changes):**

```bash
python3 scripts/measure_dorothy_feet.py   # → src/data/dorothyFeetCache.json (nx/ny + bodyNx)
python3 scripts/measure_ground_burst.py   # → src/data/groundBurstCache.json (burstAlphaBottomRatio)
```

After clone: `git lfs pull` (PNGs, GLBs, blends).

---

## Scene flow

```
Boot → Preload → Menu → CharacterSelect → Munchkinland → Game → Win
```

| Scene | Role |
|-------|------|
| **Boot** | Wire `Input`, `Storage`, `Lifecycle`, `RunState` into Phaser registry; load saved run |
| **Preload** | Atlases, YBR, fence, plants, props, FX sheets; `warmFx()` compiles sparkle pipeline + GPU-uploads textures |
| **Menu** | Facade gate splash — “Press START” |
| **CharacterSelect** | Traveler + difficulty (Easy / Normal / Hard); clears path on confirm |
| **Munchkinland** | Intro orbit → gate walk-out → free play → fork at `forkSplitFloorX` |
| **Game** | Continuation road — combat, encounters, arena lock |
| **Win** | East end of road (blocked while arena locked) |

Optional FX init in Game is wrapped in `tryInit()` — shader/particle failures log `[Game] … disabled` instead of freezing Dorothy at the fork. FX textures (and the legacy rim pipeline only if `slipperSparkleLegacyRim`) are **warmed during Preload** (`src/fx/fxWarm.ts`) so Munchkinland→Game handoff does not compile shaders or decode sheets on the main thread.

**Munchkinland → Game handoff:** `gameHandoff.floorY` is passed via registry; scene transition delay **120** ms (was 500). Game spawns at `gameContinuationSpawnFloorX` (**80**) with fork depth preserved.

---

## Controls

| Action | Keys |
|--------|------|
| Move (floor plane) | WASD / arrows — ↑ farther (↓ `floorY`), ↓ nearer (↑ `floorY`) |
| Run | Shift + move |
| Jump | Space / K |
| Light attack (rhythm combo) | **J** |
| Heavy (heel-click bolt) | **L** |
| Ultimate (triple pulse) | **U** (charge ≥ 100%) |
| Debug overlay | **;** / backtick / F3 |
| Debug force ultimate | **P** alone (no F3) when `debugForceUltimate` — charge 100% + replay burst/sparkle |
| Debug spawn enemy | **]** (`CLOSED_BRACKET`) — Wheeler ↔ Winged Monkey |
| Menu / select | Enter / Space confirm · Esc back · ← → · ↑ ↓ difficulty |

Full map: `src/config/keybindings.ts`. Unknown Phaser key names warn and skip (never crash boot).

---

## Coordinate system & proportions

### Viewport & perspective

| Constant | Value | Meaning |
|----------|-------|---------|
| `gameWidth` | **960** | Internal resolution width |
| `gameHeight` | **540** | Internal resolution height |
| `foreshorten` | **0.55** | Floor-Y → screen-Y multiplier |
| `perspectiveFarScale` | **0.58** | Horizontal scale at far road edge |
| `sceneryDepthFalloff` | **0.22** | Extra shrink beyond far fence |

**Screen mapping** (`Projection.ts`):

- `screenY = floorY × foreshorten − z` (jump uses engine `z` only)
- `screenX = vanishingX + (floorX − vanishingX) × depthScale(floorY)`
- Vanishing X tracks camera look-at (scrolls with stage)

### Walkable depth band (floor-Y)

| Constant | Value | Role |
|----------|-------|------|
| `depthFar` | **120** | Far edge of Yellow Brick Road (toward horizon) |
| `depthNear` | **420** | Near edge (toward camera) |
| `worldFloorPad` | **40** | Pad below near edge |
| Road span | **300** | `depthNear − depthFar` |

**Depth scale:** `1.0` at near → `0.58` at far → further falloff on beyond-fence strip.

**Entity scale:** `dorothyBaseScaleForSprite(visual) × entityDepthScale(floorY, …)`  
— loco uses frame `realHeight` (460); Light1 uses the **460** reference so kick matches idle height.  
`playerDepthScaleStrength = 1` (full perspective). No per-anim scale multipliers.

### Dorothy sprite sizing

| Constant | Value | Derivation |
|----------|-------|------------|
| `DOROTHY_SOURCE_EDGE_PX` | **460** | Loco / idle authored atlas frame (460²) |
| `DOROTHY_LIGHT1_SOURCE_EDGE_PX` | **512** | Light1 attack packs (512²) |
| `playerSpriteHeight` | **114** px | Target on-screen height at reference depth |
| `dorothyBaseScale()` | **114 / sourceEdge** | Shared height across packs via current frame |
| Feet origin Y (loco) | **407/460** | Sole line in source space (`applyDorothyFeetOrigin`) |
| Idle origin X | measured `bodyNx` | E/W idle plants on body mass (not sole nx) |
| `feetRegionRatio` | **0.18** | Bottom 18% scanned for foot alpha |
| `playerSpriteTowardCameraPx` | **6** | Screen-Y nudge so soles sit on shadow (× depth scale) |
| Anim FPS | **42** | Walk / run / jump / idle / **Light1** |
| Light1 time scale | **~2.054×** | Lands the 69-frame clip in **800** ms |
| Jump anim time scale | **1.5×** | Clip rate only; physics unchanged |
| Jump start frame | **34** | Skip crouch lead-in |
| Light1 frames | **69** | Full clip → **800** ms at playback speed |

Walk/run/jump keep `originX = 0.5`; sole FX (burst, light disc) use measured feet / sprite origin. Idle uses `bodyNx` from `dorothyFeetCache.json` (written by `measure_dorothy_feet.py`).

**Greybox body** (fallback when no sprite): `36×56` px collider proportions.

### Shadow & jump

| Constant | Value |
|----------|-------|
| `jumpVelocityZ` | **170** |
| `gravityZ` | **720** |
| `shadowScaleGround` | **1** |
| `shadowScaleAir` | **0.55** |
| `shadowMaxZ` | **80** |

### Yellow Brick Road block

| Constant | Value |
|----------|-------|
| Source texture | **750 × 1359** px (`models/ybr/game/YellowBrickRoad.jpg`) |
| `ybrGrassBandFar` | **0.085** | Top grass strip (texture fraction) |
| `ybrGrassBandNear` | **0.103** | Bottom grass strip |
| `ybrGrassSway` | **4.5** floor-X | Grass tip breeze (bricks static) |
| Segment count | **48** Munchkinland · **64** Game continuation |
| Tile scale | Derived from fence span + texture aspect (`ybrTileScale()`) |

### Fence

| Constant | Value |
|----------|-------|
| `fenceNearFloorY` | **432** | Near rail row |
| `fenceFarFloorY` | **118** | Far rail row |
| `fenceTileScale` | **0.224** | Authored tile (~230 px tall) → floor span |
| `postSpacingFloorX` | **64** | Greybox post spacing |
| Rails | **30% / 66%** of post height, **8** px thick |

Runtime tiles: `models/fence/game/*.png` (from `photos/Environment/Fencing` masters).

### Rear hill & plants

| Constant | Value |
|----------|-------|
| `hillHeight` | **64** px screen elevation |
| `hillFloorDrop` | **16** floor-Y crest vs toe |
| `farSceneryStripRatio` | **0.30** | Beyond-fence ground strip |
| Grass density | **4.5** tufts / 1000 floor-X |
| Wheat rows | **5** (starts `floorX ≥ 220`) |

Plant sprites: `models/plants/game/` (grass_medium, grass_large, grass_flowers, wheat).

### Gate & fork (Munchkinland)

| Constant | Value |
|----------|-------|
| `gateSpawnFloorX` | **110** |
| `gateOpeningFloorY` | **270** |
| `gateWalkHandoffFloorX` | **220** |
| `forkSplitFloorX` | **900** |
| `introCameraMoveMs` | **1400** |
| `finishMargin` | **64** |

### Stage backdrop

| Constant | Value |
|----------|-------|
| `backdropHeight` | **220** px |
| `backdropParallaxScale` | **0.55** | vs beyond-fence track |
| Floor grid | **80 × 40** floor units |

### Depth tracks (décor parallax)

| Track ID | Approx floor-Y | Use |
|----------|----------------|-----|
| `backdrop` | horizon | Sky wall |
| `beyond` | far scenery strip | Trees outside fence |
| `far` | ~12% into road | |
| `midFar` | ~35% | |
| `mid` | ~58% | Fork markers |
| `near` | ~85% | |

Gameplay entities use **scrollFactor 1** always.

---

## Color palette

All values in `tuning.colors` (hex). Key groups:

| Group | Examples |
|-------|----------|
| Stage | `background` `#1a1a1e`, `horizon` `#e8d5a3`, `road` `#c4a35a` |
| Floor | `floorFar` `#a88840`, `floorNear` `#d4b86a` |
| Fence wood | `fenceWoodDark` → `fenceWoodHi` (procedural fallback) |
| Scenery | `sceneryHillLit`, `sceneryHillShadow`, `grass`, `trackBeyond`…`trackNear` |
| Combat | `redEnergy`, `slipperCrimson` (slipper glow / light disc), `damageNumber` |
| HP bar | `hpBarGreen` → `hpBarYellow` → `hpBarOrange` → `hpBarRed` (ratio-driven fill) |
| Ultimate | `ultimateChargeEmpty` `#7a7a86`, `ultimateCharge` `#b44cff` |
| Atmosphere | `atmSkyCool/Warm`, `atmHazeGold`, `atmMistGreen`, dust tints |

---

## Movement & jump

| Stat | Value | Notes |
|------|-------|-------|
| `moveSpeedX` | **162** floor units/s |
| `moveSpeedY` | **126** floor units/s |
| `runSpeedMul` | **~1.467** | Post-cut run parity |
| Direction | **8-way** | `dorothyWalkDirFromMove`; idle realigns E/W packs |

East = +`floorX` = screen-right. Gate at west.

---

## Combat settings

### Player

| Stat | Value |
|------|-------|
| `playerMaxHP` | **100** |
| Slipper damage reduction | **20%** |
| Slipper regen | **2.5 HP/s** |

### Rhythm light combo (J)

| Kick | Damage | Range | Angle (½) | Duration | Knockback |
|------|--------|-------|-----------|----------|-----------|
| 1 | 10 | 72 | 55° | **800** ms | — |
| 2 | 14 | 78 | 58° | 220 ms | — |
| 3 | 22 | 88 | 65° | 280 ms | 95 |

**Kick 1 (Light1 sprites)**
- 8-way multi-atlas: `dorothy-light1-{e\|ne\|n\|nw\|w\|sw\|s\|se}`
- Authored **42 fps**, playback scaled to **800 ms** (`DOROTHY_LIGHT1_ANIM_TIME_SCALE ≈ 2.054`)
- Active window **326–555** ms; facing locked at press; hit arc uses 8-way `aimRad`
- Scale uses loco **460** reference (not 512 canvas) so kick matches idle height; feet origin uses the same **407/460** sole ratio
- Runtime: `models/dorothy/Sprites/Attacks/Light1/{dir}/` · Masters: `masters/dorothy/Sprites/Attacks/Light1/`

Kick 2 / 3 still use greybox timing until those packs land.

**Timing windows** (ms after prior kick ends):

| Window | Open | Close |
|--------|------|-------|
| Marker 2 | 120 | 380 |
| Marker 3 | 100 | 360 |

Early press before window → reset to kick 1.

### Heavy (L) — red energy bolt

| Stat | Value |
|------|-------|
| Damage | **18** |
| Range | **220** floor-X |
| Max targets | **3** |
| Floor-Y tolerance | **48** |
| Cooldown | **900 ms** |
| Projectile speed | **420** |
| Hit radius | **28** |

### Ultimate (U) — triple pulse

| Stat | Value |
|------|-------|
| Damage | **28** per pulse |
| Acquire range | **260** |
| Max targets | **3** |
| Pulse radius | **70** |
| Windup | **520 ms** (input locked) |
| Cooldown | **8000 ms** |
| Knockback | **55** |

### Ultimate charge (0–1)

| Source | Amount |
|--------|--------|
| Passive fill | **1 / 30 s** (`ultimateBaseChargeSeconds`) |
| Kick 1 / 2 / 3 landed | **0.08 / 0.10 / 0.153** (~3 full combos ≈ full bar) |
| Heavy laser hit | **~1/35** |

Resets to 0 on cast. Cooldown separate from charge.

### Combat feel

| Stat | Value |
|------|-------|
| `hitFlashMs` | 100 |
| `hitStopMs` | 50 |
| `knockbackStrength` | 70 |
| Damage number rise | **36** px / **500** ms |

### Placeholder kick (other characters)

Damage **8**, range **70**, duration **220** ms.

---

## UI & HUD

| Component | Location | Content |
|-----------|----------|---------|
| `OverheadPlayerBars` | Above player head | HP bar (color by ratio) + ultimate charge bar |
| `OverheadPlayerBars` sparkles | Ultimate bar edge | Sparse swirling waves when charge = full |
| `ComboMeter` | Above player | 3 rhythm markers; pulse when window open |
| `CombatHUD` | Screen corner | **Heavy (L) cooldown only** |
| Debug hint | Bottom-left | Path / controls |

**Bar geometry** (fixed screen px — not depth-scaled):

| Constant | Value |
|----------|-------|
| `overheadBarOffsetY` | **−9** (from sprite top) |
| `overheadBarWidth` | **44** |
| `overheadBarHeight` | **5** |
| `overheadBarGap` | **3** |
| `comboMeterOffsetY` | **−52** |
| `comboMeterMarkerSize` | **10** |

**Ult meter sparkles:** scale **0.495→0**, lifespan **480–820** ms, wave every **~520** ms ± jitter, **3–6** particles per wave on a **single shared rectangular path** (one orbit, no bar flash/pulse). Orbit period **2.2** s.

---

## Effects (VFX)

### Texture rule (all FX)

Shader quads and sprite sheets must use **RGBA with alpha**. Opaque white/black base textures show as boxes when a pipeline fails or alpha is ignored.

| Fix | Implementation |
|-----|----------------|
| Shader quads (sparkle, ray) | `src/fx/transparentTexture.ts` — explicit alpha=0 canvas (`FX_TRANSPARENT_QUAD_KEY`) |
| Ground burst | **2560×144** RGBA sheet (10×**256×144** frames) — `OVERLAY` blend (`groundBurstBlendMode` **4**) |
| Enemy spawn | **9680×256** RGBA strip (40×**242×256** frames) — `NORMAL` blend |
| Pipeline failure | Transparent base → **nothing visible**, never a box |
| Preload warm | `warmFx()` — register anims, compile `SlipperSparkle` pipeline, GPU-upload FX textures |

Runtime sheets in `public/fx/` are **downscaled** from masters for load time; frame sizes live in `tuning.ts` (`groundBurstFrameWidth/Height`, `enemySpawnFrameWidth/Height`).

### FX warm (`fxWarm.ts`)

Called at end of `PreloadScene.create()`:

1. `ensureTransparentQuadTexture` — sparkle quad canvas
2. `ensureGroundBurstAnim` / `ensureEnemySpawnAnim` / optional radial anims
3. `registerSlipperSparklePipeline` — compile + log GLSL link/compile errors
4. Off-screen probe render — force first GPU upload of burst/spawn/radial sheets

Avoids ~1 s main-thread freeze when crossing the Munchkinland fork into Game.

### Layered atmosphere (`LayeredAtmospherics`)

Used on Munchkinland + Game.

| Layer | Scroll | Notes |
|-------|--------|-------|
| Sky far / mid | 0.10 / 0.22 | Gradient bands + soft clouds |
| Horizon haze | 0 (screen-fixed) | Gold wash, height **52** px |
| Ground mist | 0.38 | Green bands, pulsing |
| Depth wash + vignette | screen-fixed | Near-camera darken |
| Dust far / mid / spark near | parallax | **4.5 / 3.2 / 2.4** particles/s |

Dust pre-warm: **3500** ms. Gravity Y **−4 / −8** (float upward).

### Slipper glow (`DorothySlipperAura`)

Active when ultimate ready (or casting). **Duplicate Dorothy sprite** behind the real player with Phaser `postFX.addGlow` (knockout) — soft dark-crimson halo that follows her live frame in **every** anim (idle / walk / run / jump / profile). Crop band is anchored to **sprite `originY`** (sole plant in frame), not the canvas bottom — so jump frames still glow. Subtle dual-sine **brightness waves** (`slipperGlowWaveAmp` / `Hz`). Crimson **orbit glints** swirl around `vis.x/y` (no per-foot split). Dark floor **shadow is hidden** and replaced by a soft **crimson light disc** (SCREEN). Fade-in: `slipperGlowFadeInMs` **0** = match ground-burst duration.

| Constant | Value |
|----------|-------|
| `slipperGlowDuplicateEnabled` | **true** (active path) |
| `slipperGlowColor` | **0x8a0f1e** dark crimson |
| `slipperGlowOuterStrength` | **3.2** |
| `slipperGlowBlendMode` | **NORMAL** (`0`) — not ADD |
| `slipperGlowWaveAmp` / `Hz` | **0.2** / **0.85** |
| `slipperGlowTopCutoff` / `FootFalloff` | **0.12** / **0.18** (ankle band at origin) |
| `slipperGlowFadeInMs` | **0** (= burst length ~300 ms) |
| `slipperLightDiscWidth/Height` | **52 × 18** (replaces shadow) |
| `slipperLightDiscBlend` | **SCREEN** (`3`) |
| `slipperSparkleCount` / `Size` / `Opacity` | **6** / **0.09** / **0.67** |
| `slipperSparkleOrbitRadiusX/Y` | **9** / **2** |
| `slipperSparkleLegacyRim` | **false** — ExteriorRimV3 off |

**Legacy:** `SlipperSparkleExteriorRimV3` remains in-repo behind `slipperSparkleLegacyRim`.

**Debug (F3):** `glow mode=duplicate-glow ready=… active=… fade=…`

**Shelved:** `slipperRayBurstEnabled: false` (ray burst not in use).

**Feet cache:** `src/data/dorothyFeetCache.json` — per-frame `(nx, ny, bodyNx)`; profile E/W adds `feetFront` / `feetBack` / `merged`. Rebuild with `measure_dorothy_feet.py`.

### Ground burst (`GroundBurstFx`)

One-shot when charge crosses **1.0**. Anchored at measured feet with alpha-bottom origin, then +`groundBurstAnchorOffsetY` px down (currently **1**; screen +Y = down). **Sandwich:** full-opacity **back** behind Dorothy + front at `burstFrontOpacity` (**0.4**), alpha-masked to her live sprite (`burstFrontMask`) and drawn ahead (`burstFrontDepthAhead`). Debug **P** (no F3) replays via `replayChargeFull()` — same path as a real charge cross.

| Constant | Value |
|----------|-------|
| Asset | `public/fx/ground-burst/ground_burst_sheet.png` |
| Sheet size | **2560 × 144** px (10 frames, RGBA horizontal strip) |
| Frame size | **256 × 144** (`groundBurstFrameWidth/Height`) |
| Anim start | Frame **1** (frame 0 empty) |
| Frame rate | **25** fps · `groundBurstTimeScale` **1.2×** (~300 ms) |
| Anchor | `burstAlphaBottomRatio` **≈0.802** from `groundBurstCache.json` (`measure_ground_burst.py`) |
| Display height | **96** px (× entity depth scale) |
| Scale | `groundBurstScale` **0.42** (on top of display-height fit) |
| Blend | **OVERLAY** (`groundBurstBlendMode` **4**) — both layers |
| Depth | Back behind player · front masked over body |

**Debug (F3):** `burst anim=… αbot=…` plus `burstF vis=… mask=… α=…`

### Enemy spawn (`EnemySpawnFx` + `createEnemy`)

Reusable spawn sequence for all enemies. **Stage 1** (current): rise from below floor + one-shot burst at ground anchor.

| Constant | Value |
|----------|-------|
| Asset | `public/fx/enemy-spawn/enemy_spawn_sheet.png` |
| Sheet size | **9680 × 256** px (40 frames, RGBA horizontal strip) |
| Frame size | **242 × 256** (`enemySpawnFrameWidth/Height`) |
| Frame rate | **25** fps (~1.6 s at 1×) |
| `enemySpawnFxTimeScale` | **1.4×** playback |
| Display height | **47** px (× entity depth scale; ~35% smaller than original master) |
| `spawnRiseDepth` | **48** px (start below floor) |
| `spawnRiseMs` | **720** ms (ease-out to rest `z`) |
| Rest `z` | **0** (Wheeler) · **55** (Winged Monkey) |
| Blend | **NORMAL** |
| Depth | Behind rising enemy body |

**Spawn flow:** `createEnemy` → `enemy.beginSpawn()` → `z` eases from `−spawnRiseDepth` to `hoverZ`; `spawning = true` locks AI, contact, and damage (`hittable === false`) until rise completes. Burst plays once at `(floorX, floorY)` ground point.

**Planned:** Stage 2 — front/back layered wrap (40% front + 100% back). Stage 3 — ground-line clip + optional silhouette mask.

### Debug force ultimate

Gated by `tuning.debugForceUltimate` (default **true**). Press **P** alone anytime on the Game road — **F3 overlay not required**:

1. `ultimateCharge = 1.0`, cooldown cleared
2. `GroundBurstFx.replayChargeFull()` — same path as charge cross
3. `DorothySlipperAura` sparkle fade restarted

F3 bottom hint when enabled: `P = force ult… (no F3 needed)`. Console logs `[debug] P → force ult…` when it fires.

### Red energy (`RedEnergy.ts`)

Heavy bolt + ultimate pulse rings — floor-space, additive crimson.

---

## AI, difficulty & encounters

### Enemy stats

| | Winged Monkey | Wheeler |
|---|---------------|---------|
| HP | **28** | **36** |
| Contact dmg | **7** | **10** |
| Move speed | **110** | **200** (charge **340**) |
| Hover Z | **55** | **0** (ground) |
| Body | **30×36** | **34×34** |
| Color | `#8a5a9a` | `#6a7a8a` |

Shared: contact cooldown **650** ms, radius **30**, ally spacing **55**, recover **420** ms, telegraph **280** ms.

**Spawn:** Every enemy rises from `z = −spawnRiseDepth` to rest `hoverZ` over **720** ms on spawn. AI and hits disabled until rise completes (`enemy.spawning`). Debug spawn: **]** key.

### Difficulty presets (`tuning.difficultyPresets`)

| Dial | Easy | Normal | Hard |
|------|------|--------|------|
| Reaction delay (ms) | 520 | 320 | 160 |
| Punish accuracy | 0.25 | 0.55 | 0.90 |
| Telegraph mult | 1.45 | 1.0 | 0.70 |
| Perception range | 280 | 360 | 460 |
| Retreat bias | 1.25 | 1.0 | 0.75 |
| HP / dmg mult | 0.85 | 1.0 | 1.15 |
| Max simultaneous attackers* | 1 | 2 | 3 |
| Commit cadence (ms)* | 1400 | 900 | 550 |

\*Phase B director not wired yet — values exist on preset block.

### Encounters (`src/data/encounters.ts`)

| Id | Trigger X | Arena lock | Waves |
|----|-----------|------------|-------|
| `wheeler-rush` | **380** | No | 2 Wheelers |
| `monkey-harass` | **720** | No | 2 monkeys |
| `mixed-arena` | **1100** | **Yes** (980–1380) | 4 + 2 |

Arena pads: west **80** · east **220** floor-X beyond trigger.

---

## Fork paths

Chosen by **`floorY` at `forkSplitFloorX` (900)**. Bands from `src/data/branches.ts`:

| ID | Label | floorY range | Destination |
|----|-------|--------------|-------------|
| `emerald` | Emerald City Road | **320 – 420** (far third) | the Emerald City |
| `west` | Westward Path | **220 – 320** (mid third) | land of the Winkies |
| `south` | Southern Trail | **120 – 220** (near third) | Quadling Country |

↑/↓ depth at the fork picks the path. Saved to `RunState.selectedPath` → `localStorage`.

---

## Assets

### Policy

1. **Masters are immutable** — copy originals to `masters/` first.
2. **Runtime loads from `models/` and `public/`** — derived / optimized packs only.
3. **Never edit in place** inside `masters/`, `NEW/`, `MASTER/`, `Original/` trees.
4. **FX sheets** — masters hold full-res sources; `public/fx/` holds downscaled runtime strips (dimensions in `tuning.ts`).
5. **Git LFS** for binaries — `git lfs pull` after clone.

See also `masters/README.md`.

### Directory map

```
masters/                          # canonical originals (read-only)
  dorothy/
    Sprites/NEW/                  # 8-way Walk/Run/Jump + E/W Idle exports
    Sprites/Attacks/Light1/       # 8-way Light1 attack atlases (512²)
    Animations/                   # FBX + baked mixamo_character GLBs
    meshes/                       # rigs / GLBs
    Effects/                      # ground_burst_sheet.png (ult VFX master)
  Enemies/Effects/                # enemy_spawn.gif (spawn VFX master)
  wingedmonkey/meshes/            # Tripo, remesh, Mixamo-prep GLBs

models/                           # runtime + pipeline working copies
  dorothy/Sprites/NEW/            # ← Preload loco multi-atlas (mirrors masters)
  dorothy/Sprites/Attacks/Light1/ # ← Preload Light1 multi-atlas (mirrors masters)
  dorothy/Sprites/game/           # legacy optimized packs (presentation)
  dorothy/Animations/Attacks/     # raw TexturePacker drops (copied into Sprites/)
  ybr/game/YellowBrickRoad.jpg    # road block texture
  fence/game/*.png                # authored fence tiles
  plants/game/*.png               # grass + wheat
  props/game/                     # post atlas + post.png
  wingedmonkey/                   # gargoyle anims, mixamo, working blends

public/
  fx/ground-burst/ground_burst_sheet.png   # 10×256×144 RGBA (2560×144 sheet)
  fx/enemy-spawn/enemy_spawn_sheet.png      # 40×242×256 RGBA (9680×256 strip)
  fx/ground-radial/                         # optional — preloaded, not wired
  fx/radial-powerup/                        # optional — preloaded, not wired

src/data/
  dorothyFeetCache.json           # generated feet lookup (nx/ny/bodyNx — do not hand-edit)
  groundBurstCache.json           # measured burstAlphaBottomRatio (do not hand-edit)

photos/                           # local reference art (not in Preload)
  Environment/                    # Fencing, Plants, YBR sources
  characters/
```

### Dorothy NEW sprite layout (runtime)

**Loco / idle base:** `models/dorothy/Sprites/NEW/{Compass}/`

| Compass folder | Loco | Idle |
|----------------|------|------|
| East, Southeast, … Northeast (8) | `Traversal/Walk`, `Run`, `Jump` multi-atlas | East + West only: `Idle/` |

**Light1 attack base:** `models/dorothy/Sprites/Attacks/Light1/{dir}/`  
Masters: `masters/dorothy/Sprites/Attacks/Light1/{E,N,…}/`

| Atlas key | Pack |
|-----------|------|
| `dorothy-walk-{dir}` | NEW Walk |
| `dorothy-run-{dir}` | NEW Run |
| `dorothy-jump-{dir}` | NEW Jump |
| `dorothy-idle-{e\|w}` | East / West Idle |
| `dorothy-light1-{dir}` | Light1 (all 8 dirs) |

Frame naming: `dorothy_{dir}_{anim}_####.png` (Light1: `dorothy_{dir}_attack_light_1_####.png`). Idle frames use `se` / `sw` prefixes in East/West packs.

Light1: **512²** source, **69** frames @ **42 fps**, playback scaled to **800 ms**; on-screen scale matches loco (**114/460**).

### Playable characters (`src/data/characters.ts`)

| ID | Label | Combat |
|----|-------|--------|
| `dorothy` | Dorothy | Full kit |
| `tin-man` | Tin-Man | Placeholder kick |
| `lion` | Cowardly Lion | Placeholder kick |
| `scarecrow` | Scarecrow | Placeholder kick |

---

## Preload manifest

`PreloadScene` loads (failures warn, do not hang):

| Loader | Source |
|--------|--------|
| `preloadDorothySprites` | `models/dorothy/Sprites/NEW/**` + `Sprites/Attacks/Light1/**` multi-atlas |
| `preloadPropSprites` | `models/props/game/props.{png,json}`, `post.png` |
| `preloadFenceTiles` | `models/fence/game/*.png` |
| `preloadPlants` | `models/plants/game/*.png` |
| `preloadYbr` | `models/ybr/game/YellowBrickRoad.jpg` |
| `preloadGroundBurst` | `public/fx/ground-burst/ground_burst_sheet.png` |
| `preloadEnemySpawn` | `public/fx/enemy-spawn/enemy_spawn_sheet.png` |
| `preloadOptionalFx` | `public/fx/ground-radial/`, `radial-powerup/` (preloaded only) |

Then `ensureDorothyAnims()` registers walk / run / jump / idle / **Light1** clips, followed by **`warmFx()`** (anims + GPU texture upload).

---

## Pipelines & scripts

| Script | Purpose |
|--------|---------|
| `measure_dorothy_feet.py` | Per-frame sole + `bodyNx` → `dorothyFeetCache.json` |
| `measure_ground_burst.py` | Burst opaque base → `groundBurstCache.json` (`burstAlphaBottomRatio`) |
| `bake_mixamo_fbx_to_dorothy.py` | Mixamo FBX → Dorothy GLB |
| `bake_dorothy_mixamo_character.py` | mixamo_character pack |
| `seed_dorothy_anims_from_masters.ts` | Copy studio anims masters → models |
| `rebuild_monkey_gargoyle_from_fbx.py` | Winged monkey animation pipeline |
| `export_monkey_mixamo.py` | Mixamo upload FBX |

Winged-monkey working blends / GLBs live under `models/wingedmonkey/` — see `models/wingedmonkey/mixamo/README.md`.

---

## Architecture

```
src/
  ai/                 Perception, UtilityAI, Executor, brains/
  combat/             Health, Attack, CombatController, EncounterManager, RedEnergy
  config/             tuning.ts, keybindings.ts
  core/               Projection, DepthTracks, DepthSort, Registry, StateMachine
  data/               characters, enemies, encounters, branches, scenery,
                      dorothyFeetCache.json, groundBurstCache.json
  entities/           Player, Enemy, dorothySprites, dorothyFeet, createPlayer/createEnemy
  fx/                 DorothySlipperAura, SlipperSparklePipeline, GroundBurstFx, EnemySpawnFx,
                      fxWarm, transparentTexture, optionalFxAssets, LayeredAtmospherics,
                      enemySpawnAssets, groundBurstAssets
  platform/           Input, Storage, Lifecycle
  render/             StageView, FacadeGate, MunchkinGate
  scenes/             Boot → … → Win
  state/              RunState
  ui/                 CombatHUD, ComboMeter, OverheadPlayerBars, DebugOverlay
```

**Seams:** `createPlayer` / `createEnemy` attach combat + art + spawn FX. Hits and AI only in **floor space**. `createEnemy` always calls `beginSpawn()` — rise + burst.

**Debug (F3):** FSM, combo, HP, ult charge, AI intents/scores, encounter phase, anim height/feet Δ vs idle ref, green = measured feet, red = sparkle origins, **sparkle/burst FX status** (incl. front mask), `P` hint when `debugForceUltimate` is on (P works without F3).

---

## Persistence

`RunState` → JSON at `oz.runState`:

```json
{
  "selectedCharacter": "dorothy",
  "selectedPath": "emerald",
  "difficulty": "normal"
}
```

Character Select clears path before Munchkinland so each run picks a fresh fork.

---

## Rules of the house

1. All gameplay numbers in **`tuning.ts`**.
2. Character / enemy branching at **`createPlayer` / `createEnemy`** (+ attached brains).
3. Combat / AI in **floor coordinates** only.
4. East = +x; gate west.
5. **Masters immutable** — pipelines read masters, write models/public/src cache.
6. Optional FX must not block scene boot (`tryInit` pattern in Game).
7. **All FX textures transparent** — pipelines read RGBA sheets; shader quads use `transparentTexture.ts`.

---

## Roadmap & playtest

### Not yet

- **Phase B** — `EncounterDirector`, attack tokens, commit cadence
- Real kits for Tin-Man / Lion / Scarecrow
- **Enemy spawn Stage 2** — front/back layered wrap (40% front veil + full back)
- **Enemy spawn Stage 3** — ground-line clip + optional silhouette mask on front layer
- Slipper ray burst (when desired — currently shelved)
- Settings UI → `DifficultyParams.custom`

### Playtest checklist

1. Character Select → difficulty → Dorothy → Munchkinland.
2. Walk to fork (**x ≈ 900**); pick path by depth (↑/↓).
3. Confirm **Game loads** — Dorothy moves, road visible, not frozen.
4. **J** rhythm combo (marker windows) · **L** bolt · **U** at full charge.
5. Slipper crimson rim when ult ready (fades in with burst); ground burst sandwich once at 100%. **P** alone replays both (no F3).
6. **]** debug spawn — enemy rises from below floor with spawn burst (no black box).
7. Encounters at **380 / 720 / 1100**; arena unlocks after clear.
8. **F3** — AI debug, foot markers, Δheight/Δfeet, sparkle `pipe=` / burst `anim=` + `burstF mask=` lines.
9. Difficulty changes **behavior** more than sponge HP.

---

## Definition of done (greybox)

- [x] Floor-plane travel + Munchkinland → Game on relative-path build
- [x] Dorothy passive + rhythm light (**8-way Light1** @ 42 fps → **800 ms**) + heavy + ultimate
- [x] Ultimate charge + overhead HP; corner HUD = heavy CD
- [x] Duplicate-sprite crimson slipper glow (all anims) + crimson floor light disc + sandwich ground burst
- [x] Debug force ultimate (**P** alone) + F3 glow/burst diagnostics
- [x] Enemy spawn rise + ground burst FX (Stage 1)
- [x] Utility AI monkeys / Wheelers + triggered encounters + arena lock
- [x] F3 sprite + AI ground-truth
- [x] Dorothy NEW unified scale + feet pivot + z-only jump
- [ ] Phase B director / tokens
- [ ] Light2 / Light3 sprites + other character kits + full art pipeline
