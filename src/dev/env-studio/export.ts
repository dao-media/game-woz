import type { EnvElementSpec } from './spec';
import { elementTypeById } from './spec';

/** Ready-to-paste `data/scenery.ts` line. Does not mutate the décor pipeline. */
export function scenerySnippet(spec: EnvElementSpec): string {
  const t = elementTypeById(spec.type);
  const kind = spec.suggested.kind || t.sceneryKind;
  const track = spec.suggested.track;
  const floorX = spec.suggested.floorX;
  return [
    `// ${spec.id}.png → models/props/game/${spec.id}.png`,
    `// placeOnGround + DepthSort unchanged — paste into munchkinScenery or gameScenery`,
    `{ kind: '${kind}', floorX: ${floorX}, track: '${track}' },`,
  ].join('\n');
}

export function downloadPng(canvas: HTMLCanvasElement, filename: string): void {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.click();
}

export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
