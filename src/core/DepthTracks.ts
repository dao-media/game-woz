import { tuning } from '../config/tuning';
import { Projection } from './Projection';

/**
 * Discrete depth tracks for stage props / décor.
 * Scroll factor is derived from perspective depth scale so farther tracks
 * lag the camera (parallax) while the near track stays locked to the world.
 *
 * scrollFactor 1 → moves with camera scroll (near / gameplay plane)
 * scrollFactor 0 → pinned to the viewport (infinite distance)
 *
 * Gameplay (player / obstacles) stays on scroll factor 1.
 */
export type DepthTrackId = 'backdrop' | 'beyond' | 'far' | 'midFar' | 'mid' | 'near';

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

function trackFromFloorY(id: DepthTrackId, floorY: number, label: string): DepthTrack {
  return {
    id,
    floorY,
    scrollFactor: Projection.depthScale(floorY),
    label,
  };
}

/**
 * Default track set. `beyond` is the grass strip outside the far fence.
 * Backdrop is slower than that strip so the wall reads behind the ground.
 */
export function createDepthTracks(): readonly DepthTrack[] {
  const span = tuning.depthNear - tuning.depthFar;
  const at = (t: number) => tuning.depthFar + span * t;

  const beyond = trackFromFloorY('beyond', Projection.farSceneryFloorY(), 'Beyond fence');
  const far = trackFromFloorY('far', at(0.12), 'Far track');
  const midFar = trackFromFloorY('midFar', at(0.35), 'Mid-far track');
  const mid = trackFromFloorY('mid', at(0.58), 'Mid track');
  const near = trackFromFloorY('near', at(0.85), 'Near track');

  const backdrop: DepthTrack = {
    id: 'backdrop',
    floorY: Projection.horizonFloorY(),
    scrollFactor: Math.max(0.15, beyond.scrollFactor * tuning.backdropParallaxScale),
    label: 'Backdrop',
  };

  return [backdrop, beyond, far, midFar, mid, near];
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
