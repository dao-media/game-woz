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
 * They share one horizon line; the hillside may rise into the lower sky
 * so the ridge is visible against the backdrop. Floor underlay never
 * paints above the horizon; hill quads may.
 *
 * Far scenery strip is a full-width hill band (horizon → far fence) so start/end
 * of the road don't clip to a perspective ray. Grass end-caps fill the
 * wing triangles between those rays and the world edges.
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
  const roadFarY = Projection.floorYToScreenY(tuning.depthFar);

  redrawBackdrop(layers.backdrop, worldWidth, horizon, cameraScrollX, backdropTrack);
  redrawFloor(layers.floor, worldWidth, horizon, roadFarY, nearY);
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
  roadFarY: number,
  nearY: number,
): void {
  g.clear();

  drawSceneryStrip(g, worldWidth, horizon, roadFarY);
  drawEndCaps(g, worldWidth, roadFarY, nearY);
  drawRoadUnderlay(g, worldWidth);

  g.fillStyle(tuning.colors.background, 1);
  g.fillRect(0, nearY, worldWidth, 80);
}

/** Grass under the YBR tiles so 1px seams read as ground, not a hole. */
function drawRoadUnderlay(g: Phaser.GameObjects.Graphics, worldWidth: number): void {
  const farY = Projection.floorYToScreenY(tuning.fenceFarFloorY);
  const nearFenceY = Projection.floorYToScreenY(tuning.fenceNearFloorY);
  g.fillStyle(tuning.colors.sceneryGroundNear, 1);
  g.fillRect(0, farY, worldWidth, Math.max(0, nearFenceY - farY));
}

/**
 * Far-fence field: a full-width grass underlay, then a perspective hillside
 * whose ridge undulates and rises into the sky so the landform is visible.
 */
function drawSceneryStrip(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  horizon: number,
  roadFarY: number,
): void {
  const far = Phaser.Display.Color.ValueToColor(tuning.colors.sceneryGroundFar);
  const near = Phaser.Display.Color.ValueToColor(tuning.colors.sceneryGroundNear);
  const lit = Phaser.Display.Color.ValueToColor(tuning.colors.sceneryHillLit);
  const shadow = Phaser.Display.Color.ValueToColor(tuning.colors.sceneryHillShadow);

  g.fillStyle(tuning.colors.sceneryGroundFar, 1);
  g.fillRect(0, horizon, worldWidth, Math.max(0, roadFarY - horizon));

  const alongSteps = 10;
  const xStep = 72;
  for (let i = 0; i < alongSteps; i++) {
    const a0 = i / alongSteps;
    const a1 = (i + 1) / alongSteps;
    for (let x = 0; x < worldWidth; x += xStep) {
      const x1 = Math.min(worldWidth, x + xStep);
      const p00 = Projection.hillToScreen(x, a0);
      const p10 = Projection.hillToScreen(x1, a0);
      const p11 = Projection.hillToScreen(x1, a1);
      const p01 = Projection.hillToScreen(x, a1);

      const ridgeTilt = p10.y - p00.y;
      const shade = Phaser.Math.Clamp(0.78 - ridgeTilt * 0.045 + (1 - a0) * 0.1, 0.52, 1.08);
      const band = Phaser.Display.Color.Interpolate.ColorWithColor(far, near, alongSteps, i);
      const sun = Phaser.Display.Color.Interpolate.ColorWithColor(
        shadow,
        lit,
        100,
        Phaser.Math.Clamp(Math.round((shade - 0.52) * (100 / 0.56)), 0, 100),
      );
      const r = Math.round(band.r * 0.55 + sun.r * 0.45);
      const gg = Math.round(band.g * 0.55 + sun.g * 0.45);
      const b = Math.round(band.b * 0.55 + sun.b * 0.45);
      g.fillStyle(Phaser.Display.Color.GetColor(r, gg, b), 1);
      g.beginPath();
      g.moveTo(p00.x, p00.y);
      g.lineTo(p10.x, p10.y);
      g.lineTo(p11.x, p11.y);
      g.lineTo(p01.x, p01.y);
      g.closePath();
      g.fillPath();
    }
  }

  g.lineStyle(2, tuning.colors.sceneryHillShadow, 0.55);
  g.beginPath();
  let first = true;
  for (let x = 0; x <= worldWidth; x += xStep) {
    const p = Projection.hillToScreen(x, 0);
    if (first) {
      g.moveTo(p.x, p.y);
      first = false;
    } else {
      g.lineTo(p.x, p.y);
    }
  }
  g.strokePath();
}

/**
 * Grass wings between the road's perspective sides and the world edges,
 * so the YBR sits in a field instead of cutting into void at start/end.
 */
function drawEndCaps(
  g: Phaser.GameObjects.Graphics,
  worldWidth: number,
  roadFarY: number,
  nearY: number,
): void {
  const farL = Projection.toScreen(0, tuning.depthFar);
  const farR = Projection.toScreen(worldWidth, tuning.depthFar);
  const nearL = Projection.toScreen(0, tuning.depthNear + tuning.worldFloorPad);
  const nearR = Projection.toScreen(worldWidth, tuning.depthNear + tuning.worldFloorPad);

  g.fillStyle(tuning.colors.sceneryGroundNear, 1);

  g.beginPath();
  g.moveTo(0, roadFarY);
  g.lineTo(farL.x, farL.y);
  g.lineTo(nearL.x, nearL.y);
  g.lineTo(0, nearY);
  g.closePath();
  g.fillPath();

  g.beginPath();
  g.moveTo(worldWidth, roadFarY);
  g.lineTo(farR.x, farR.y);
  g.lineTo(nearR.x, nearR.y);
  g.lineTo(worldWidth, nearY);
  g.closePath();
  g.fillPath();
}

