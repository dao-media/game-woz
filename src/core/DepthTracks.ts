import { tuning } from '../config/tuning';
import { Projection } from './Projection';

/**
 * Discrete depth tracks for stage props / décor.
 * Scroll factor is derived from perspective depth scale so farther tracks
 * lag the camera (parallax) while the near track stays locked to the world.
 *
 * scrollFactor 1 → moves with camera scroll (near / gameplay plane)
 * scrollFactor 0 → pinned to the viewport (infinite distance)
 */
export type DepthTrackId = 'backdrop' | 'far' | 'mid' | 'near';

export type DepthTrack = {
  id: DepthTrackId;
  /** Representative floor-Y for props on this track (backdrop uses horizon). */
  floorY: number;
  /**
   * Phaser-style scroll factor for this track.
   * Matched to Projection.depthScale at floorY (backdrop is slower than far).
   */
  scrollFactor: number;
  label: string;
};

/** Parallax speed as a fraction of camera scroll for a given scroll factor. */
export function trackParallaxSpeed(scrollFactor: number, cameraScrollSpeed: number): number {
  return cameraScrollSpeed * scrollFactor;
}

/** How much a track visually lags the camera (world units per camera unit). */
export function trackLagFactor(scrollFactor: number): number {
  return 1 - scrollFactor;
}

function trackFromFloorY(id: DepthTrackId, floorY: number, label: string): DepthTrack {
  return {
    id,
    floorY,
    scrollFactor: Projection.depthScale(floorY),
    label,
  };
}

/**
 * Build the default track set. Backdrop is slower than the far floor so the
 * wall reads as standing behind the road.
 */
export function createDepthTracks(): readonly DepthTrack[] {
  const midY = (tuning.depthFar + tuning.depthNear) / 2;
  const farY = tuning.depthFar + (tuning.depthNear - tuning.depthFar) * 0.18;
  const nearY = tuning.depthFar + (tuning.depthNear - tuning.depthFar) * 0.82;

  const far = trackFromFloorY('far', farY, 'Far track');
  const mid = trackFromFloorY('mid', midY, 'Mid track');
  const near = trackFromFloorY('near', nearY, 'Near track');

  const backdrop: DepthTrack = {
    id: 'backdrop',
    floorY: tuning.depthFar,
    scrollFactor: Math.max(0.15, far.scrollFactor * tuning.backdropParallaxScale),
    label: 'Backdrop',
  };

  return [backdrop, far, mid, near];
}

export function getTrack(
  tracks: readonly DepthTrack[],
  id: DepthTrackId,
): DepthTrack {
  const track = tracks.find((t) => t.id === id);
  if (!track) throw new Error(`Unknown depth track "${id}"`);
  return track;
}

/** Nearest gameplay track (excludes backdrop) for a floor-Y. */
export function nearestFloorTrack(
  tracks: readonly DepthTrack[],
  floorY: number,
): DepthTrack {
  const floorTracks = tracks.filter((t) => t.id !== 'backdrop');
  let best = floorTracks[0]!;
  let bestDist = Math.abs(best.floorY - floorY);
  for (const t of floorTracks) {
    const d = Math.abs(t.floorY - floorY);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}
