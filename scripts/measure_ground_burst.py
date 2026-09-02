#!/usr/bin/env python3
"""Measure ground-burst alpha-bottom within each frame of the FX sheet.

The burst art does not fill the 256×144 frame — empty padding sits below the
visible effect. Runtime anchors the sprite so this measured alpha-bottom sits
on Dorothy's feet (not the frame's bottom edge).

Writes src/data/groundBurstCache.json (derived — do not hand-edit the ratio).

Usage:
  python3 scripts/measure_ground_burst.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / "public" / "fx" / "ground-burst" / "ground_burst_sheet.png"
OUT_PATH = ROOT / "src" / "data" / "groundBurstCache.json"

FRAME_W = 256
FRAME_H = 144
FRAME_COUNT = 10
# Match tuning.groundBurstAnimStartFrame — skip empty lead-in.
ANIM_START_FRAME = 1
ALPHA_THRESHOLD = 24


def frame_alpha_bottom_y(rgba: Image.Image) -> int | None:
    """Lowest opaque pixel row (0 = top), or None if fully transparent."""
    w, h = rgba.size
    px = rgba.load()
    for y in range(h - 1, -1, -1):
        for x in range(w):
            if px[x, y][3] >= ALPHA_THRESHOLD:
                return y
    return None


def main() -> int:
    if not SHEET.is_file():
        print(f"missing sheet: {SHEET}", file=sys.stderr)
        return 1

    sheet = Image.open(SHEET).convert("RGBA")
    w, h = sheet.size
    if w < FRAME_W * FRAME_COUNT or h < FRAME_H:
        print(f"unexpected sheet size {w}×{h}", file=sys.stderr)
        return 1

    per_frame: list[dict[str, float | int | None]] = []
    lowest_y = -1
    for i in range(FRAME_COUNT):
        crop = sheet.crop((i * FRAME_W, 0, (i + 1) * FRAME_W, FRAME_H))
        y = frame_alpha_bottom_y(crop)
        ratio = (y + 0.5) / FRAME_H if y is not None else None
        per_frame.append({"frame": i, "alphaBottomY": y, "alphaBottomRatio": ratio})
        if i >= ANIM_START_FRAME and y is not None:
            lowest_y = max(lowest_y, y)

    if lowest_y < 0:
        print("no opaque pixels in played frames", file=sys.stderr)
        return 1

    # Max lowest-y across played frames = farthest ground contact in the anim.
    burst_ratio = (lowest_y + 0.5) / FRAME_H
    payload = {
        "version": 1,
        "source": "public/fx/ground-burst/ground_burst_sheet.png",
        "frameWidth": FRAME_W,
        "frameHeight": FRAME_H,
        "frameCount": FRAME_COUNT,
        "animStartFrame": ANIM_START_FRAME,
        "alphaThreshold": ALPHA_THRESHOLD,
        "note": "Derived offline — burstAlphaBottomRatio is measured, not guessed.",
        "burstAlphaBottomY": lowest_y,
        "burstAlphaBottomRatio": round(burst_ratio, 5),
        "frames": per_frame,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"wrote {OUT_PATH.relative_to(ROOT)} "
        f"burstAlphaBottomRatio={payload['burstAlphaBottomRatio']} "
        f"(y={lowest_y}/{FRAME_H})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
