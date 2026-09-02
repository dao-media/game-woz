#!/usr/bin/env python3
"""Measure Dorothy foot contact (nx, ny) per atlas frame from PNG alpha.

Reads NEW multi-atlas JSON + sheet PNGs under models/dorothy/Sprites/NEW/.
Writes src/data/dorothyFeetCache.json (derived runtime cache).

Profile (East/West) frames also record front/back foot clusters when split.

Usage:
  python3 scripts/measure_dorothy_feet.py
"""

from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
NEW_ROOT = ROOT / "models" / "dorothy" / "Sprites" / "NEW"
OUT_PATH = ROOT / "src" / "data" / "dorothyFeetCache.json"

FEET_REGION_RATIO = 0.18
ALPHA_THRESHOLD = 24
SOURCE_EDGE = 460
SOLE_BAND_PX = 8
MIN_CLUSTER_SIZE = 10
MERGE_DIST_NX = 0.075

COMPASS = [
    ("East", "e"),
    ("Southeast", "se"),
    ("South", "s"),
    ("Southwest", "sw"),
    ("West", "w"),
    ("Northwest", "nw"),
    ("North", "n"),
    ("Northeast", "ne"),
]

IDLE_PACKS = [
    ("East", "e"),
    ("West", "w"),
]

LOCO = ("Walk", "Run", "Jump")
PROFILE_DIR_SLUGS = {"e", "w"}


def atlas_key_for(anim: str, dir_slug: str) -> str:
    return f"dorothy-{anim.lower()}-{dir_slug}"


def idle_atlas_key(side: str) -> str:
    return f"dorothy-idle-{side}"


def is_profile_atlas(atlas_key: str) -> bool:
    slug = atlas_key.rsplit("-", 1)[-1]
    return slug in PROFILE_DIR_SLUGS


def centroid(points: list[tuple[int, int]]) -> tuple[float, float]:
    cx = sum(p[0] for p in points) / len(points)
    cy = sum(p[1] for p in points) / len(points)
    return cx, cy


def round_pt(nx: float, ny: float) -> dict[str, float]:
    return {"nx": round(nx, 5), "ny": round(ny, 5)}


def collect_foot_opaque(
    rgba: Image.Image, feet_region_ratio: float
) -> list[tuple[int, int]]:
    w, h = rgba.size
    px = rgba.load()
    y0 = int(h * (1.0 - feet_region_ratio))
    opaque: list[tuple[int, int]] = []
    for y in range(y0, h):
        for x in range(w):
            if px[x, y][3] >= ALPHA_THRESHOLD:
                opaque.append((x, y))
    return opaque


def connected_clusters(points: list[tuple[int, int]]) -> list[list[tuple[int, int]]]:
    point_set = set(points)
    visited: set[tuple[int, int]] = set()
    clusters: list[list[tuple[int, int]]] = []

    for start in points:
        if start in visited:
            continue
        queue: deque[tuple[int, int]] = deque([start])
        component: list[tuple[int, int]] = []
        while queue:
            x, y = queue.popleft()
            if (x, y) in visited:
                continue
            visited.add((x, y))
            component.append((x, y))
            for dx, dy in (
                (-1, 0),
                (1, 0),
                (0, -1),
                (0, 1),
                (-1, -1),
                (1, -1),
                (-1, 1),
                (1, 1),
            ):
                n = (x + dx, y + dy)
                if n in point_set and n not in visited:
                    queue.append(n)
        if len(component) >= MIN_CLUSTER_SIZE:
            clusters.append(component)
    return clusters


def measure_body_nx(rgba: Image.Image) -> float:
    """Horizontal center of mass of all opaque pixels (torso+dress+feet)."""
    w, h = rgba.size
    px = rgba.load()
    total = 0
    sx = 0.0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] >= ALPHA_THRESHOLD:
                total += 1
                sx += x
    if total == 0:
        return 0.5
    return sx / total / w


def measure_single_feet(
    rgba: Image.Image, feet_region_ratio: float
) -> dict[str, float]:
    w, h = rgba.size
    opaque = collect_foot_opaque(rgba, feet_region_ratio)
    body_nx = measure_body_nx(rgba)
    if not opaque:
        return {
            **round_pt(0.5, (407 / 460)),
            "bodyNx": round(body_nx, 5),
        }

    max_y = max(p[1] for p in opaque)
    band = [p for p in opaque if p[1] >= max_y - SOLE_BAND_PX]
    if not band:
        band = opaque

    cx, cy = centroid(band)
    return {
        **round_pt(cx / w, cy / h),
        "bodyNx": round(body_nx, 5),
    }


def measure_profile_feet(
    rgba: Image.Image, feet_region_ratio: float
) -> dict[str, object]:
    w, h = rgba.size
    opaque = collect_foot_opaque(rgba, feet_region_ratio)
    body_nx = measure_body_nx(rgba)
    if not opaque:
        nx, ny = 0.5, (407 / 460)
        return {
            "nx": round(nx, 5),
            "ny": round(ny, 5),
            "bodyNx": round(body_nx, 5),
            "profile": True,
            "merged": True,
        }

    max_y = max(p[1] for p in opaque)
    sole_band = [p for p in opaque if p[1] >= max_y - SOLE_BAND_PX]
    if not sole_band:
        sole_band = opaque

    clusters = connected_clusters(sole_band)
    clusters.sort(key=len, reverse=True)

    if len(clusters) == 0:
        cx, cy = centroid(sole_band)
        return {
            **round_pt(cx / w, cy / h),
            "bodyNx": round(body_nx, 5),
            "profile": True,
            "merged": True,
        }

    if len(clusters) == 1:
        cx, cy = centroid(clusters[0])
        return {
            **round_pt(cx / w, cy / h),
            "bodyNx": round(body_nx, 5),
            "profile": True,
            "merged": True,
        }

    c1, c2 = clusters[0], clusters[1]
    p1 = centroid(c1)
    p2 = centroid(c2)
    dist_nx = abs(p1[0] - p2[0]) / w
    merged = dist_nx < MERGE_DIST_NX

    if p1[1] >= p2[1]:
        front, back = p1, p2
    else:
        front, back = p2, p1

    center = ((p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5)
    entry: dict[str, object] = {
        **round_pt(center[0] / w, center[1] / h),
        "bodyNx": round(body_nx, 5),
        "profile": True,
        "merged": merged,
    }
    if not merged:
        entry["feetFront"] = round_pt(front[0] / w, front[1] / h)
        entry["feetBack"] = round_pt(back[0] / w, back[1] / h)
    return entry


def extract_frame(sheet: Image.Image, frame_rect: dict) -> Image.Image:
    x, y, fw, fh = frame_rect["x"], frame_rect["y"], frame_rect["w"], frame_rect["h"]
    return sheet.crop((x, y, x + fw, y + fh)).convert("RGBA")


def process_atlas(
    json_path: Path, atlas_key: str, out_frames: dict, profile: bool
) -> None:
    data = json.loads(json_path.read_text())
    base = json_path.parent
    sheet_cache: dict[str, Image.Image] = {}

    for tex in data.get("textures", []):
        sheet_name = tex["image"]
        sheet_path = base / sheet_name
        if not sheet_path.is_file():
            print(f"warn: missing sheet {sheet_path}", file=sys.stderr)
            continue
        if sheet_name not in sheet_cache:
            sheet_cache[sheet_name] = Image.open(sheet_path).convert("RGBA")

        sheet = sheet_cache[sheet_name]
        for fr in tex.get("frames", []):
            name = fr["filename"]
            src = fr.get("sourceSize", {"w": SOURCE_EDGE, "h": SOURCE_EDGE})
            sw, sh = src["w"], src["h"]
            crop = extract_frame(sheet, fr["frame"])
            if crop.size != (sw, sh):
                crop = crop.resize((sw, sh), Image.Resampling.NEAREST)

            if profile:
                out_frames.setdefault(atlas_key, {})[name] = measure_profile_feet(
                    crop, FEET_REGION_RATIO
                )
            else:
                out_frames.setdefault(atlas_key, {})[name] = measure_single_feet(
                    crop, FEET_REGION_RATIO
                )


def main() -> int:
    frames: dict[str, dict[str, dict[str, object]]] = {}
    profile_split = 0
    profile_merged = 0

    for folder, dir_slug in COMPASS:
        for anim in LOCO:
            json_path = NEW_ROOT / folder / "Traversal" / anim / f"{anim}.json"
            if not json_path.is_file():
                print(f"skip missing {json_path}", file=sys.stderr)
                continue
            key = atlas_key_for(anim, dir_slug)
            profile = dir_slug in PROFILE_DIR_SLUGS
            process_atlas(json_path, key, frames, profile)
            n = len(frames.get(key, {}))
            print(f"measured {key}: {n} frames ({'profile' if profile else 'single'})")
            if profile:
                for fr in frames.get(key, {}).values():
                    if fr.get("merged"):
                        profile_merged += 1
                    elif fr.get("feetFront"):
                        profile_split += 1

    for folder, side in IDLE_PACKS:
        json_path = NEW_ROOT / folder / "Idle" / "Idle.json"
        if not json_path.is_file():
            print(f"skip missing {json_path}", file=sys.stderr)
            continue
        key = idle_atlas_key(side)
        process_atlas(json_path, key, frames, profile=True)
        n = len(frames.get(key, {}))
        print(f"measured {key}: {n} frames (profile)")
        for fr in frames.get(key, {}).values():
            if fr.get("merged"):
                profile_merged += 1
            elif fr.get("feetFront"):
                profile_split += 1

    payload = {
        "version": 2,
        "feetRegionRatio": FEET_REGION_RATIO,
        "sourceEdgePx": SOURCE_EDGE,
        "granularity": "per-frame",
        "mergeDistNx": MERGE_DIST_NX,
        "frames": frames,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    total = sum(len(v) for v in frames.values())
    print(
        f"wrote {OUT_PATH} ({total} frame entries; "
        f"profile split={profile_split} merged={profile_merged})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
