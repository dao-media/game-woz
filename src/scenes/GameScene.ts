import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getSelectedCharacterId, getSelectedPath, getServices } from '../core/Registry';
import {
  createDepthTracks,
  getTrack,
  type DepthTrack,
  type DepthTrackId,
} from '../core/DepthTracks';
import { Projection } from '../core/Projection';
import { gameScenery } from '../data/scenery';
import { gameEncounters } from '../data/encounters';
import { createPlayer } from '../entities/createPlayer';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { StageProp } from '../entities/StageProp';
import { Fence } from '../entities/Fence';
import { PlantField } from '../entities/PlantField';
import { YellowBrickRoad } from '../entities/YellowBrickRoad';
import { ybrRoadLength } from '../data/ybr';
import { createStageLayers, redrawStage, type StageLayers } from '../render/StageView';
import { DebugOverlay } from '../ui/DebugOverlay';
import { CombatHUD } from '../ui/CombatHUD';
import { ComboMeter } from '../ui/ComboMeter';
import { OverheadPlayerBars } from '../ui/OverheadPlayerBars';
import { GroundBurstFx } from '../fx/GroundBurstFx';
import {
  computePlayerFeetMarkers,
  computePlayerFeetScreen,
  DorothySlipperAura,
} from '../fx/DorothySlipperAura';
import { LayeredAtmospherics } from '../fx/LayeredAtmospherics';
import { EncounterManager } from '../combat/EncounterManager';
import { resolveDifficultyParams } from '../ai/DifficultyParams';
import type { Input } from '../platform/Input';

function tryDebugForceUltimate(
  player: Player,
  input: Input,
  groundBurst: GroundBurstFx | null,
  slipperAura: DorothySlipperAura | null,
): void {
  if (!tuning.debugForceUltimate) return;
  if (!input.justDown('debugForceUltimate')) return;

  player.debugForceChargeFull();
  // Replay VFX even if charge was already full (cross edge won't fire).
  groundBurst?.replayChargeFull(player);
  slipperAura?.forceChargeFullActivate();
  slipperAura?.beginSparkleFadeIn();
  console.info(
    `[debug] P → force ult charge=${player.ultimateCharge.toFixed(2)}  burst=${groundBurst ? 'ok' : 'null'}  sparkle=${slipperAura ? 'ok' : 'null'}`,
  );
}

export class GameScene extends Phaser.Scene {
  private player!: Player;
  private enemies: Enemy[] = [];
  private props: StageProp[] = [];
  private fence!: Fence;
  private plants!: PlantField;
  private ybr!: YellowBrickRoad;
  private tracks: readonly DepthTrack[] = [];
  private stage!: StageLayers;
  private debug!: DebugOverlay;
  private hud!: CombatHUD;
  private overheadBars!: OverheadPlayerBars;
  private comboMeter!: ComboMeter;
  private slipperAura: DorothySlipperAura | null = null;
  private groundBurst: GroundBurstFx | null = null;
  private atmospherics: LayeredAtmospherics | null = null;
  private encounters!: EncounterManager;
  private finished = false;
  private defeated = false;
  private readonly worldWidth = ybrRoadLength(tuning.continuationYbrSegments);
  private spawnToggle = 0;

  constructor() {
    super('Game');
  }

  create(): void {
    let path;
    try {
      path = getSelectedPath(this);
    } catch (err) {
      console.error('[Game] no fork path selected — returning to Munchkinland', err);
      this.scene.start('Munchkinland');
      return;
    }

    const { input, runState } = getServices(this);
    input.bind(this);
    input.setEnabled(true);
    this.finished = false;
    this.defeated = false;
    this.tracks = createDepthTracks();
    this.enemies = [];

    const difficulty = resolveDifficultyParams(runState.difficulty);

    this.cameras.main.setBackgroundColor(tuning.colors.background);
    const horizon = Projection.horizonY();
    const floorBottom = tuning.depthNear + tuning.worldFloorPad;
    const screenNear = Projection.floorYToScreenY(floorBottom);
    const camTop = horizon - tuning.backdropHeight - 20;
    const camBottom = screenNear + 40;
    this.cameras.main.setBounds(0, camTop, this.worldWidth, camBottom - camTop);

    this.stage = createStageLayers(this);
    this.atmospherics = this.tryInit('atmospherics', () => new LayeredAtmospherics(this, this.worldWidth));

    this.props = gameScenery.map((def) => {
      const track = getTrack(this.tracks, def.track as DepthTrackId);
      return new StageProp(this, def, track);
    });
    this.ybr = new YellowBrickRoad(this, tuning.continuationYbrSegments);
    this.plants = new PlantField(this, this.worldWidth);
    this.fence = new Fence(this, this.worldWidth);

    const spawnY = (path.floorYMin + path.floorYMax) / 2;
    const handoff = this.registry.get('gameHandoff') as
      | { floorY?: number }
      | undefined;
    const startFloorY = handoff?.floorY ?? spawnY;
    this.registry.remove('gameHandoff');

    this.player = createPlayer(
      this,
      getSelectedCharacterId(this),
      { floorX: tuning.gameContinuationSpawnFloorX, floorY: startFloorY },
      { xMin: 0, xMax: this.worldWidth },
    );

    this.encounters = new EncounterManager(
      this,
      gameEncounters,
      this.enemies,
      difficulty,
    );

    this.hud = new CombatHUD(this);
    this.overheadBars = new OverheadPlayerBars(this);
    this.comboMeter = new ComboMeter(this);
    this.slipperAura = this.tryInit('slipperAura', () => new DorothySlipperAura(this));
    this.groundBurst = this.tryInit('groundBurst', () => new GroundBurstFx(this));
    if (this.groundBurst && this.slipperAura) {
      this.groundBurst.onChargeFull = () => this.slipperAura?.beginSparkleFadeIn();
    }
    this.groundBurst?.resetChargeTracking(this.player.ultimateCharge);
    this.debug = new DebugOverlay(this);
    this.add
      .text(
        16,
        tuning.gameHeight - 28,
        `${path.label} → ${path.destination}  ·  J/L/U  ·  ] spawn  ·  ;/F3 debug  ·  P force-ult`,
        {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#c4c4d0',
        },
      )
      .setScrollFactor(0)
      .setDepth(99999);

    this.syncCameraAndStage();
  }

  /** Optional FX — a failure here must not block the road scene from running. */
  private tryInit<T>(label: string, factory: () => T): T | null {
    try {
      return factory();
    } catch (err) {
      console.warn(`[Game] ${label} disabled`, err);
      return null;
    }
  }

  update(_t: number, dt: number): void {
    if (this.finished || this.defeated) return;

    const { input, runState } = getServices(this);
    if (input.justDown('debug')) this.debug.toggle();

    tryDebugForceUltimate(
      this.player,
      input,
      this.groundBurst,
      this.slipperAura,
    );

    if (input.justDown('spawnEnemy')) {
      this.spawnToggle = 1 - this.spawnToggle;
      const id = this.spawnToggle === 0 ? 'wheeler' : 'winged-monkey';
      this.encounters.debugSpawn(
        id,
        this.player.floorX + 120,
        clampSpawnY(this.player.floorY),
      );
    }

    this.encounters.update(dt, this.player.floorX);

    // Arena east clamp before player move settles.
    const liveTargets = this.enemies.filter((e) => e.alive && e.hittable);
    this.player.update(input, dt, liveTargets);
    this.player.floorX = this.encounters.clampPlayerFloorX(this.player.floorX);

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player, this.enemies);
    }

    this.hud.update(this.player);
    this.overheadBars.update(this.player, dt);
    this.comboMeter.update(this.player, dt);
    this.syncCameraAndStage();
    this.slipperAura?.update(this.player, dt);
    this.groundBurst?.update(this.player);
    this.atmospherics?.update(dt, this.cameras.main.scrollX);

    const path = getSelectedPath(this);
    this.debug.update(this.player, path, runState.selectedCharacter, {
      combat: {
        difficulty: runState.difficulty,
        enemies: this.enemies.filter((e) => e.alive),
        encounter: this.encounters,
      },
      fence: {
        tileCount: this.fence.tileCount,
        nearFloorY: tuning.fenceNearFloorY,
        farFloorY: tuning.fenceFarFloorY,
      },
      ybr: {
        segments: this.ybr.segments,
        tileCount: this.ybr.tileCount,
        roadLength: this.ybr.roadLength,
      },
      slipperFeet: this.slipperAura?.getFeetOrigin() ?? null,
      slipperFeetFront: this.slipperAura?.getFeetOrigins()?.front ?? null,
      slipperFeetBack: this.slipperAura?.getFeetOrigins()?.back ?? null,
      playerFeet: computePlayerFeetScreen(this.player),
      playerFeetFront: computePlayerFeetMarkers(this.player)?.front ?? null,
      playerFeetBack: computePlayerFeetMarkers(this.player)?.back ?? null,
      sparkleFx: this.slipperAura?.getDebugState(this.player) ?? null,
      groundBurstFx: this.groundBurst?.getDebugState() ?? null,
    });

    if (this.player.health.isDead) {
      this.defeated = true;
      this.time.delayedCall(600, () => {
        this.scene.start('CharacterSelect');
      });
      return;
    }

    if (
      !this.encounters.arenaLocked &&
      this.player.floorX >= this.worldWidth - tuning.finishMargin
    ) {
      this.finished = true;
      this.scene.start('Win');
    }
  }

  private syncCameraAndStage(): void {
    const cam = this.cameras.main;
    let lookX = this.player.floorX;
    lookX = this.encounters.clampCameraLookX(lookX);
    cam.scrollX = lookX - tuning.gameWidth / 2;
    cam.scrollY = Projection.horizonY() - tuning.backdropHeight * 0.35;

    redrawStage(
      this.stage,
      this.worldWidth,
      cam.scrollX + tuning.gameWidth / 2,
      cam.scrollX,
      getTrack(this.tracks, 'backdrop'),
    );

    this.props.forEach((p) => p.syncVisual());
    this.ybr.syncVisual();
    this.plants.syncVisual();
    this.fence.syncVisual();
    this.player.syncVisual();
    this.enemies.forEach((e) => e.syncVisual());
  }
}

function clampSpawnY(y: number): number {
  return Phaser.Math.Clamp(y + (Math.random() - 0.5) * 60, tuning.depthFar, tuning.depthNear);
}
