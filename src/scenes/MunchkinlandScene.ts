import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import { getServices } from '../core/Registry';
import {
  createDepthTracks,
  getTrack,
  type DepthTrack,
  type DepthTrackId,
} from '../core/DepthTracks';
import { Projection } from '../core/Projection';
import { branchForFloorY, type ForkBranch } from '../data/branches';
import { DEFAULT_CHARACTER_ID } from '../data/characters';
import { munchkinScenery } from '../data/scenery';
import { createPlayer } from '../entities/createPlayer';
import { Player } from '../entities/Player';
import { StageProp } from '../entities/StageProp';
import { Fence } from '../entities/Fence';
import { PlantField } from '../entities/PlantField';
import { YellowBrickRoad } from '../entities/YellowBrickRoad';
import { ybrRoadLength } from '../data/ybr';
import { buildApproachFraming } from '../render/FacadeGate';
import { MunchkinGate } from '../render/MunchkinGate';
import { createStageLayers, redrawStage, type StageLayers } from '../render/StageView';
import { LayeredAtmospherics } from '../fx/LayeredAtmospherics';
import { DebugOverlay } from '../ui/DebugOverlay';
import { IntroCameraMove } from './IntroCameraMove';

type Beat = 'intro' | 'walk' | 'play';

/**
 * Approach → IntroCameraMove → short walk out of gate → free floor travel → fork.
 * Environment: Projection one-point floor + vertical wall seam + depth-track parallax.
 */
export class MunchkinlandScene extends Phaser.Scene {
  private player!: Player;
  private props: StageProp[] = [];
  private fence!: Fence;
  private plants!: PlantField;
  private ybr!: YellowBrickRoad;
  private gate!: MunchkinGate;
  private tracks: readonly DepthTrack[] = [];
  private stage!: StageLayers;
  private atmospherics!: LayeredAtmospherics;
  private approach!: Phaser.GameObjects.Container;
  private intro!: IntroCameraMove;
  private debug!: DebugOverlay;
  private committed: ForkBranch | null = null;
  private hint!: Phaser.GameObjects.Text;
  private beat: Beat = 'intro';
  private readonly worldWidth = ybrRoadLength(tuning.munchkinYbrSegments);

  constructor() {
    super('Munchkinland');
  }

  create(): void {
    const { input, runState } = getServices(this);
    input.bind(this);
    input.setEnabled(false);

    this.committed = null;
    this.beat = 'intro';
    this.tracks = createDepthTracks();
    this.cameras.main.setBackgroundColor(tuning.colors.background);

    const horizon = Projection.horizonY();
    const floorBottom = tuning.depthNear + tuning.worldFloorPad;
    const screenNear = Projection.floorYToScreenY(floorBottom);
    const camTop = horizon - tuning.backdropHeight - 20;
    const camBottom = screenNear + 40;
    this.cameras.main.setBounds(0, camTop, this.worldWidth, camBottom - camTop);

    this.stage = createStageLayers(this);
    this.stage.backdrop.setAlpha(0);
    this.stage.floor.setAlpha(0);
    this.atmospherics = new LayeredAtmospherics(this, this.worldWidth);

    this.gate = new MunchkinGate(this);
    this.gate.setAlpha(0);

    this.props = munchkinScenery.map((def) => {
      const track = getTrack(this.tracks, def.track as DepthTrackId);
      const prop = new StageProp(this, def, track);
      prop.setAlpha(0);
      return prop;
    });
    this.ybr = new YellowBrickRoad(this, tuning.munchkinYbrSegments);
    this.ybr.setAlpha(0);
    this.plants = new PlantField(this, this.worldWidth);
    this.plants.setAlpha(0);
    this.fence = new Fence(this, this.worldWidth);
    this.fence.setAlpha(0);

    const characterId = runState.selectedCharacter ?? DEFAULT_CHARACTER_ID;
    this.player = createPlayer(
      this,
      characterId,
      {
        floorX: tuning.gateSpawnFloorX,
        floorY: tuning.gateOpeningFloorY,
      },
      { xMin: 0, xMax: this.worldWidth },
    );
    this.player.setHeld(true);
    this.player.setScriptedMove(null);

    this.approach = buildApproachFraming(this);

    const sideScrollTargets: Phaser.GameObjects.GameObject[] = [
      this.stage.backdrop,
      this.stage.floor,
      ...this.atmospherics.displayObjects,
      ...this.gate.displayObjects,
      ...this.props.flatMap((p) => p.displayObjects),
      ...this.ybr.displayObjects,
      ...this.plants.displayObjects,
      ...this.fence.displayObjects,
    ];

    this.intro = new IntroCameraMove(this, this.approach, sideScrollTargets, {
      onComplete: () => this.beginWalkThrough(),
    });

    this.debug = new DebugOverlay(this);
    this.hint = this.add
      .text(16, tuning.gameHeight - 28, 'Approaching the gate…', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#c4c4d0',
      })
      .setScrollFactor(0)
      .setDepth(99999);

    this.syncCameraAndStage();
    this.intro.playIntroOrbit();
  }

  update(_t: number, dt: number): void {
    const { input, runState } = getServices(this);
    if (input.justDown('debug')) this.debug.toggle();

    if (this.beat === 'intro') {
      this.syncCameraAndStage(dt);
      this.debug.update(this.player, this.committed, runState.selectedCharacter, {
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
      });
      return;
    }

    if (this.beat === 'walk' && this.player.floorX >= tuning.gateWalkHandoffFloorX) {
      this.finishWalkOut();
    }

    this.player.update(input, dt);
    this.syncCameraAndStage(dt);

    this.debug.update(this.player, this.committed, runState.selectedCharacter, {
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
    });

    if (
      this.beat === 'play' &&
      !this.committed &&
      this.player.floorX >= tuning.forkSplitFloorX
    ) {
      void this.commitFork();
    }
  }

  private syncCameraAndStage(dtMs = 16): void {
    const cam = this.cameras.main;
    cam.scrollX = this.player.floorX - tuning.gameWidth / 2;
    cam.scrollY = Projection.horizonY() - tuning.backdropHeight * 0.35;

    const vanishingX = cam.scrollX + tuning.gameWidth / 2;
    redrawStage(
      this.stage,
      this.worldWidth,
      vanishingX,
      cam.scrollX,
      getTrack(this.tracks, 'backdrop'),
    );

    this.gate.syncVisual();
    this.props.forEach((p) => p.syncVisual());
    this.fence.syncVisual();
    this.ybr.syncVisual();
    this.plants.syncVisual();
    this.player.syncVisual();
    this.atmospherics.update(dtMs, cam.scrollX);
  }

  private beginWalkThrough(): void {
    this.beat = 'walk';
    this.player.setHeld(false);
    this.player.setScriptedMove({ x: 1, y: 0 });
    getServices(this).input.setEnabled(false);
    this.hint.setText('Walking out through the gate…');
    this.syncCameraAndStage();
  }

  private finishWalkOut(): void {
    this.beat = 'play';
    this.player.setScriptedMove(null);
    getServices(this).input.setEnabled(true);
    this.hint.setText(
      `←→ walk · ↑↓ depth · Shift run · Space jump · fork by depth  ·  ; or \` debug`,
    );
  }

  private async commitFork(): Promise<void> {
    if (this.committed) return;
    try {
      const branch = branchForFloorY(this.player.floorY);
      this.committed = branch;
      const { storage, runState, input } = getServices(this);
      input.setEnabled(false);
      this.player.setScriptedMove(null);
      this.registry.set('gameHandoff', {
        floorY: this.player.floorY,
        branchId: branch.id,
      });
      await runState.setPath(branch.id, storage);
      this.hint.setText(`Path chosen: ${branch.label} →`);
      this.time.delayedCall(120, () => {
        if (!this.scene.isActive()) return;
        this.scene.start('Game');
      });
    } catch (err) {
      console.error('[Munchkinland] commitFork failed', err);
      this.committed = null;
      getServices(this).input.setEnabled(true);
      this.hint.setText('Path save failed — try again');
    }
  }
}
