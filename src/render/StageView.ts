import Phaser from 'phaser';
import { tuning } from '../config/tuning';
import type { DepthTrack } from '../core/DepthTracks';
import { Projection } from '../core/Projection';

export type StageLayers = {
  /** Vertical wall — ends exactly on the horizon. */
  backdrop: Phaser.GameObjects.Graphics;
  /** Perspective floor — starts exactly on the horizon. */
  floor: Phaser.GameObjects.Graphics;
};

/**
 * Draws the stage as two cleanly joined layers:
 * - Backdrop (vertical) occupies y ≤ horizon
 * - Floor (perspective plane) occupies y ≥ horizon
 * They share one horizon line; floor never paints into the wall.
 *
 * Backdrop fill uses scrollFactor 1 so the seam stays locked to the floor.
 * Horizontal panel detail shifts by the backdrop track lag for parallax read.
 */
export function createStageLayers(scene: Phaser.Scene): StageLayers {
  return {
    backdrop: scene.add.graphics().setDepth(-2000).setScrollFactor(1),
    floor: scene.add.graphics().setDepth(-1000).setScrollFactor(1),
  };
}

export function redrawStage(
  layers: StageLayers,
  worldWidth: number,
  vanishingX: number,
  cameraScrollX: number,
  backdropTrack: DepthTrack,
): void {
  Projection.setVanishingX(vanishingX);

  const horizon = Projection.horizonY();
  const floorBottom = tuning.depthNear + tuning.worldFloorPad;
  const nearY = Projection.floorYToScreenY(floorBottom);

  redrawBackdrop(layers.backdrop, worldWidth, horizon, cameraScrollX, backdropTrack);
  redrawFloor(layers.floor, worldWidth, horizon, floorBottom, nearY);
}

function redrawBackdrop(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  horizon: number,
  cameraScrollX: number,
  backdropTrack: DepthTrack,
): void {
  g.clear();

  const top = horizon - tuning.backdropHeight;
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const y0 = Phaser.Math.Linear(top, horizon, t0);
    const y1 = Math.min(Phaser.Math.Linear(top, horizon, t1), horizon);
    if (y0 >= horizon) break;
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(tuning.colors.backdropTop),
      Phaser.Display.Color.ValueToColor(tuning.colors.backdropBottom),
      steps,
      i,
    );
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
    g.fillRect(0, y0, worldWidth, Math.max(0, y1 - y0));
  }

  // Panel lines parallax — lag = scroll * (1 - backdropFactor).
  const lag = cameraScrollX * (1 - backdropTrack.scrollFactor);
  const step = tuning.floorGridStepX * 2;
  g.lineStyle(1, tuning.colors.backdropLine, 0.4);
  const start = Math.floor((-lag - step) / step) * step;
  for (let x = start; x <= worldWidth + step; x += step) {
    g.lineBetween(x + lag, top, x + lag, horizon);
  }

  g.lineStyle(2, tuning.colors.horizon, 0.7);
  g.lineBetween(0, horizon, worldWidth, horizon);
}

function redrawFloor(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  horizon: number,
  floorBottom: number,
  nearY: number,
): void {
  g.clear();

  const floorTop = tuning.depthFar;
  drawFloorFill(g, worldWidth, floorTop, floorBottom, horizon);
  drawPerspectiveGrid(g, worldWidth, floorTop, floorBottom, horizon);
  drawBandEdges(g, worldWidth, horizon);

  g.fillStyle(tuning.colors.background, 1);
  g.fillRect(0, nearY, worldWidth, 80);
}

function drawFloorFill(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  floorTop: number,
  floorBottom: number,
  horizon: number,
): void {
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const fy0 = Phaser.Math.Linear(floorTop, floorBottom, t0);
    const fy1 = Phaser.Math.Linear(floorTop, floorBottom, t1);
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(tuning.colors.floorFar),
      Phaser.Display.Color.ValueToColor(tuning.colors.floorNear),
      steps,
      i,
    );
    const color = Phaser.Display.Color.GetColor(c.r, c.g, c.b);

    const tl = Projection.toScreen(0, fy0);
    const tr = Projection.toScreen(worldWidth, fy0);
    const br = Projection.toScreen(worldWidth, fy1);
    const bl = Projection.toScreen(0, fy1);

    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(tl.x, Math.max(tl.y, horizon));
    g.lineTo(tr.x, Math.max(tr.y, horizon));
    g.lineTo(br.x, Math.max(br.y, horizon));
    g.lineTo(bl.x, Math.max(bl.y, horizon));
    g.closePath();
    g.fillPath();
  }
}

function drawPerspectiveGrid(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  floorTop: number,
  floorBottom: number,
  horizon: number,
): void {
  // Cross-lines — shorten toward far via Projection.depthScale / perspectiveFarScale.
  g.lineStyle(1, tuning.colors.floorLine, 0.5);
  for (let fy = floorTop; fy <= tuning.depthNear; fy += tuning.floorGridStepY) {
    const left = Projection.toScreen(0, fy);
    const right = Projection.toScreen(worldWidth, fy);
    g.lineBetween(left.x, Math.max(left.y, horizon), right.x, Math.max(right.y, horizon));
  }

  // Depth lines — constant floorX rays converging to the vanishing point.
  g.lineStyle(1, tuning.colors.floorLine, 0.4);
  for (let fx = 0; fx <= worldWidth; fx += tuning.floorGridStepX) {
    const near = Projection.toScreen(fx, floorBottom);
    const far = Projection.toScreen(fx, floorTop);
    g.lineBetween(near.x, near.y, far.x, Math.max(far.y, horizon));
  }
}

function drawBandEdges(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  horizon: number,
): void {
  g.lineStyle(2, tuning.colors.horizon, 0.45);
  const farL = Projection.toScreen(0, tuning.depthFar);
  const farR = Projection.toScreen(worldWidth, tuning.depthFar);
  const nearL = Projection.toScreen(0, tuning.depthNear);
  const nearR = Projection.toScreen(worldWidth, tuning.depthNear);
  g.lineBetween(farL.x, horizon, farR.x, horizon);
  g.lineBetween(nearL.x, nearL.y, nearR.x, nearR.y);
  g.lineBetween(farL.x, horizon, nearL.x, nearL.y);
  g.lineBetween(farR.x, horizon, nearR.x, nearR.y);
}
