import type { SceneryKind, SceneryTrack } from '../../data/scenery';
import { snapToPalette } from '../../render/palette';
import { hexFromRgbNumber } from '../../render/outline';
import { tuning } from '../../config/tuning';

export type PrimitiveKind = 'rect' | 'ellipse' | 'polygon' | 'blob';

/** Role is data — Phase B uses foliage vs anchor; Phase A stores it only. */
export type PrimitiveRole = 'anchor' | 'foliage';

export type EnvPoint = { x: number; y: number };

export type EnvPrimitive = {
  id: string;
  kind: PrimitiveKind;
  /** Pixel coords in the element's native canvas (top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Palette-snapped CSS hex. */
  fill: string;
  role: PrimitiveRole;
  /** Polygon vertices in canvas pixels. Ignored for rect/ellipse/blob. */
  points?: EnvPoint[];
  /** Reproducible irregularity for blob. */
  blobSeed?: number;
};

export type EnvBaseImage = {
  dataUrl: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type EnvElementTypeId = 'post' | 'rock' | 'tree' | 'bush' | 'sign';

export type EnvElementType = {
  id: EnvElementTypeId;
  label: string;
  sceneryKind: SceneryKind;
  defaultTrack: SceneryTrack;
  width: number;
  height: number;
};

/** Element kinds are data — add a row, not a new tool. */
export const ELEMENT_TYPES: readonly EnvElementType[] = [
  { id: 'post', label: 'Post', sceneryKind: 'post', defaultTrack: 'near', width: 14, height: 64 },
  { id: 'rock', label: 'Rock', sceneryKind: 'crate', defaultTrack: 'near', width: 40, height: 28 },
  { id: 'tree', label: 'Tree', sceneryKind: 'tree', defaultTrack: 'beyond', width: 48, height: 80 },
  { id: 'bush', label: 'Bush', sceneryKind: 'tree', defaultTrack: 'far', width: 44, height: 32 },
  { id: 'sign', label: 'Sign', sceneryKind: 'marker', defaultTrack: 'mid', width: 28, height: 40 },
];

/** Motion kinds are data — Phase B consumes `sway`; Phase A authors `none`. */
export const MOTION_TYPES = [
  { id: 'none', label: 'None' },
  { id: 'sway', label: 'Foliage sway' },
] as const;

export type MotionTypeId = (typeof MOTION_TYPES)[number]['id'];

export type EnvElementSpec = {
  version: 1;
  id: string;
  type: EnvElementTypeId;
  width: number;
  height: number;
  /** Feet origin in 0–1 of the texture (game décor uses 0.5, 1). */
  origin: { x: number; y: number };
  primitives: EnvPrimitive[];
  baseImage?: EnvBaseImage;
  outline: { enabled: boolean; width: number; color: string };
  suggested: {
    kind: SceneryKind;
    track: SceneryTrack;
    floorX: number;
  };
  motion: { type: MotionTypeId };
};

export function elementTypeById(id: string): EnvElementType {
  return ELEMENT_TYPES.find((t) => t.id === id) ?? ELEMENT_TYPES[0]!;
}

export function newPrimitiveId(kind: PrimitiveKind): string {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

const wood = {
  mid: hexFromRgbNumber(tuning.colors.fenceWoodMid),
  side: hexFromRgbNumber(tuning.colors.fenceWoodSide),
  light: hexFromRgbNumber(tuning.colors.fenceWoodLight),
  dark: hexFromRgbNumber(tuning.colors.fenceWoodDark),
  grass: hexFromRgbNumber(tuning.colors.grass),
  grassFar: hexFromRgbNumber(tuning.colors.sceneryGroundFar),
  grassNear: hexFromRgbNumber(tuning.colors.sceneryGroundNear),
  marker: hexFromRgbNumber(tuning.colors.forkMarker),
  divider: hexFromRgbNumber(tuning.colors.divider),
};

export function defaultSpecForType(typeId: EnvElementTypeId): EnvElementSpec {
  const t = elementTypeById(typeId);
  const outlineColor = hexFromRgbNumber(tuning.colors.fenceOutline);
  const base: Omit<EnvElementSpec, 'primitives'> = {
    version: 1,
    id: t.id === 'post' ? 'fence-post' : t.id,
    type: t.id,
    width: t.width,
    height: t.height,
    origin: { x: 0.5, y: 1 },
    outline: { enabled: true, width: 1, color: outlineColor },
    suggested: { kind: t.sceneryKind, track: t.defaultTrack, floorX: 300 },
    motion: { type: 'none' },
  };

  if (t.id === 'post') {
    return {
      ...base,
      primitives: [
        prim('shaft', 'rect', 'anchor', 2, 2, 8, 60, wood.mid),
        prim('side', 'rect', 'anchor', 8, 2, 4, 60, wood.side),
        prim('cap', 'rect', 'anchor', 2, 2, 10, 5, wood.light),
      ],
    };
  }
  if (t.id === 'rock') {
    return {
      ...base,
      primitives: [
        { ...prim('mass', 'blob', 'anchor', 3, 6, 34, 20, wood.dark), blobSeed: 11 },
        { ...prim('hi', 'blob', 'anchor', 8, 8, 18, 10, wood.mid), blobSeed: 3 },
      ],
    };
  }
  if (t.id === 'tree') {
    return {
      ...base,
      primitives: [
        prim('trunk', 'rect', 'anchor', 20, 42, 8, 36, wood.mid),
        prim('canopy', 'ellipse', 'foliage', 6, 4, 36, 44, wood.grass),
        prim('canopy-hi', 'ellipse', 'foliage', 12, 8, 22, 18, wood.grassNear),
      ],
    };
  }
  if (t.id === 'bush') {
    return {
      ...base,
      primitives: [
        { ...prim('clump', 'blob', 'foliage', 4, 6, 36, 24, wood.grass), blobSeed: 7 },
        { ...prim('clump-2', 'blob', 'foliage', 10, 4, 22, 16, wood.grassNear), blobSeed: 19 },
      ],
    };
  }
  return {
    ...base,
    primitives: [
      prim('post', 'rect', 'anchor', 12, 8, 5, 30, wood.mid),
      prim('board', 'rect', 'anchor', 3, 6, 22, 14, wood.light),
      prim('stripe', 'rect', 'anchor', 3, 6, 22, 3, wood.marker),
    ],
  };
}

function prim(
  id: string,
  kind: PrimitiveKind,
  role: PrimitiveRole,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): EnvPrimitive {
  return { id, kind, role, x, y, w, h, fill: snapToPalette(fill) };
}

export function specToJson(spec: EnvElementSpec): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

export function parseSpec(raw: unknown): EnvElementSpec {
  if (!raw || typeof raw !== 'object') throw new Error('Spec must be an object');
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) throw new Error('Unsupported spec version');
  if (typeof o.id !== 'string' || !o.id.trim()) throw new Error('Spec needs an id');
  const type = elementTypeById(String(o.type ?? 'post')).id;
  const width = Math.max(4, Math.round(Number(o.width) || 14));
  const height = Math.max(4, Math.round(Number(o.height) || 64));
  const originObj = (o.origin ?? {}) as Record<string, unknown>;
  const primitivesIn = Array.isArray(o.primitives) ? o.primitives : [];
  const outlineObj = (o.outline ?? {}) as Record<string, unknown>;
  const suggestedObj = (o.suggested ?? {}) as Record<string, unknown>;
  const motionObj = (o.motion ?? {}) as Record<string, unknown>;
  const t = elementTypeById(type);

  const spec: EnvElementSpec = {
    version: 1,
    id: slugId(String(o.id)),
    type,
    width,
    height,
    origin: {
      x: clamp01(Number(originObj.x) || 0.5),
      y: clamp01(Number(originObj.y) || 1),
    },
    primitives: primitivesIn.map(parsePrimitive),
    outline: {
      enabled: outlineObj.enabled !== false,
      width: 1,
      color: snapToPalette(String(outlineObj.color || hexFromRgbNumber(tuning.colors.fenceOutline))),
    },
    suggested: {
      kind: asSceneryKind(String(suggestedObj.kind || t.sceneryKind)),
      track: asTrack(String(suggestedObj.track || t.defaultTrack)),
      floorX: Math.round(Number(suggestedObj.floorX) || 300),
    },
    motion: {
      type: motionObj.type === 'sway' ? 'sway' : 'none',
    },
  };

  if (o.baseImage && typeof o.baseImage === 'object') {
    const b = o.baseImage as Record<string, unknown>;
    if (typeof b.dataUrl === 'string' && b.dataUrl.startsWith('data:image/')) {
      spec.baseImage = {
        dataUrl: b.dataUrl,
        x: Number(b.x) || 0,
        y: Number(b.y) || 0,
        w: Math.max(1, Number(b.w) || width),
        h: Math.max(1, Number(b.h) || height),
      };
    }
  }

  return spec;
}

function parsePrimitive(raw: unknown, index: number): EnvPrimitive {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = asKind(String(o.kind ?? 'rect'));
  const fill = snapToPalette(String(o.fill || wood.mid));
  const primOut: EnvPrimitive = {
    id: String(o.id || `p${index}`),
    kind,
    role: o.role === 'foliage' ? 'foliage' : 'anchor',
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    w: Math.max(1, Number(o.w) || 8),
    h: Math.max(1, Number(o.h) || 8),
    fill,
  };
  if (kind === 'polygon' && Array.isArray(o.points)) {
    primOut.points = o.points
      .map((p) => {
        const pt = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
        return { x: Number(pt.x) || 0, y: Number(pt.y) || 0 };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  }
  if (kind === 'blob') {
    primOut.blobSeed = Number.isFinite(Number(o.blobSeed)) ? Number(o.blobSeed) : index + 1;
  }
  return primOut;
}

function asKind(s: string): PrimitiveKind {
  if (s === 'ellipse' || s === 'polygon' || s === 'blob' || s === 'rect') return s;
  return 'rect';
}

function asSceneryKind(s: string): SceneryKind {
  if (s === 'post' || s === 'tree' || s === 'marker' || s === 'crate') return s;
  return 'post';
}

function asTrack(s: string): SceneryTrack {
  if (s === 'beyond' || s === 'far' || s === 'midFar' || s === 'mid' || s === 'near') return s;
  return 'near';
}

function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'element';
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
