import { tuning } from '../config/tuning';
import { hexFromRgbNumber, parseCssColor } from './outline';

export type PaletteSwatch = {
  key: string;
  value: number;
  hex: string;
};

/** Every color in `tuning.colors` — the game's only fill palette. */
export function paletteSwatches(): PaletteSwatch[] {
  return Object.entries(tuning.colors).map(([key, value]) => ({
    key,
    value,
    hex: hexFromRgbNumber(value),
  }));
}

/** Snap an authored hex to the nearest `tuning.colors` entry (RGB distance). */
export function snapToPalette(hex: string): string {
  const [r, g, b] = parseCssColor(hex);
  const swatches = paletteSwatches();
  let best = swatches[0]!;
  let bestD = Infinity;
  for (const s of swatches) {
    const [sr, sg, sb] = parseCssColor(s.hex);
    const d = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best.hex;
}
