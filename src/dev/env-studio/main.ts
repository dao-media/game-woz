/**
 * Environment Studio — Phase A.
 * Open via /env-studio.html (dev MPA; not in the game bundle).
 */
import { tuning } from '../../config/tuning';
import { Projection } from '../../core/Projection';
import { paletteSwatches, snapToPalette } from '../../render/palette';
import { hexFromRgbNumber } from '../../render/outline';
import { composeElement, hitTestPrimitive } from './compose';
import { downloadPng, downloadText, scenerySnippet } from './export';
import { bootPreview, type EnvPreviewApi } from './scene';
import {
  defaultSpecForType,
  ELEMENT_TYPES,
  newPrimitiveId,
  parseSpec,
  specToJson,
  type EnvElementSpec,
  type EnvElementTypeId,
  type EnvPrimitive,
  type PrimitiveKind,
} from './spec';

const STORAGE_KEY = 'oz-env-studio-spec';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const hud = $('hud');
const statusEl = $('status');
const composeView = $('compose-view') as HTMLCanvasElement;
const composeCtx = composeView.getContext('2d')!;

const MAX_HISTORY = 80;

type HistoryEntry = {
  spec: EnvElementSpec;
  selectedId: string | null;
};

let spec = loadInitialSpec();
let selectedId: string | null = spec.primitives[0]?.id ?? null;
let preview: EnvPreviewApi | null = null;
let composed: HTMLCanvasElement | null = null;
let zoom = 8;
let drag: { id: string; dx: number; dy: number } | null = null;
let dragMoved = false;
let suppress = false;
let composeTimer = 0;
let applyingHistory = false;
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
let committed = captureHistory();

function loadInitialSpec(): EnvElementSpec {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseSpec(JSON.parse(raw) as unknown);
  } catch {
    /* fall through */
  }
  return defaultSpecForType('post');
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, specToJson(spec));
}

function captureHistory(): HistoryEntry {
  return { spec: structuredClone(spec), selectedId };
}

function restoreHistory(entry: HistoryEntry): void {
  spec = structuredClone(entry.spec);
  selectedId = entry.selectedId;
}

function syncHistoryButtons(): void {
  ($('btn-undo') as HTMLButtonElement).disabled = undoStack.length === 0;
  ($('btn-redo') as HTMLButtonElement).disabled = redoStack.length === 0;
}

function commitChange(): void {
  if (suppress || applyingHistory) {
    void refreshSpec();
    return;
  }
  undoStack.push(committed);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack.length = 0;
  committed = captureHistory();
  syncHistoryButtons();
  void refreshSpec();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(committed);
  applyingHistory = true;
  restoreHistory(prev);
  committed = captureHistory();
  applyingHistory = false;
  syncHistoryButtons();
  void refreshSpec();
  setStatus('Undo');
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(committed);
  applyingHistory = true;
  restoreHistory(next);
  committed = captureHistory();
  applyingHistory = false;
  syncHistoryButtons();
  void refreshSpec();
  setStatus('Redo');
}

function selected(): EnvPrimitive | undefined {
  return spec.primitives.find((p) => p.id === selectedId);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function fillTypeSelect(): void {
  const sel = $('type-select') as HTMLSelectElement;
  sel.innerHTML = ELEMENT_TYPES.map(
    (t) => `<option value="${t.id}">${t.label}</option>`,
  ).join('');
}

function fillPalette(): void {
  const root = $('palette');
  root.replaceChildren();
  for (const s of paletteSwatches()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `${s.key} ${s.hex}`;
    b.style.background = s.hex;
    b.addEventListener('click', () => {
      const p = selected();
      if (!p) return;
      p.fill = s.hex;
      commitChange();
    });
    root.appendChild(b);
  }
}

function bindFields(): void {
  fillTypeSelect();
  fillPalette();

  ($('type-select') as HTMLSelectElement).addEventListener('change', (e) => {
    spec.type = (e.target as HTMLSelectElement).value as EnvElementTypeId;
    commitChange();
  });
  $('field-id').addEventListener('change', () => {
    spec.id = ($('field-id') as HTMLInputElement).value.trim() || spec.id;
    commitChange();
  });
  $('field-w').addEventListener('change', () => {
    spec.width = clampSize(($('field-w') as HTMLInputElement).value);
    commitChange();
  });
  $('field-h').addEventListener('change', () => {
    spec.height = clampSize(($('field-h') as HTMLInputElement).value);
    commitChange();
  });
  $('btn-new').addEventListener('click', () => {
    const type = ($('type-select') as HTMLSelectElement).value as EnvElementTypeId;
    spec = defaultSpecForType(type);
    selectedId = spec.primitives[0]?.id ?? null;
    commitChange();
    setStatus(`New ${type} spec`);
  });

  $('compose-zoom').addEventListener('input', () => {
    zoom = Number(($('compose-zoom') as HTMLInputElement).value) || 8;
    drawCompose();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((btn) => {
    btn.addEventListener('click', () => addPrimitive(btn.dataset.kind as PrimitiveKind));
  });

  bindPrimField('prim-x', (p, v) => {
    p.x = v;
  });
  bindPrimField('prim-y', (p, v) => {
    p.y = v;
  });
  bindPrimField('prim-w', (p, v) => {
    p.w = Math.max(1, v);
  });
  bindPrimField('prim-h', (p, v) => {
    p.h = Math.max(1, v);
  });
  $('prim-fill').addEventListener('change', () => {
    const p = selected();
    if (!p) return;
    p.fill = snapToPalette(($('prim-fill') as HTMLInputElement).value);
    commitChange();
  });
  $('prim-role').addEventListener('change', () => {
    const p = selected();
    if (!p) return;
    p.role = ($('prim-role') as HTMLSelectElement).value === 'foliage' ? 'foliage' : 'anchor';
    commitChange();
  });
  $('blob-seed').addEventListener('change', () => {
    const p = selected();
    if (!p || p.kind !== 'blob') return;
    p.blobSeed = Number(($('blob-seed') as HTMLInputElement).value) || 1;
    commitChange();
  });
  $('poly-points').addEventListener('change', () => {
    const p = selected();
    if (!p || p.kind !== 'polygon') return;
    p.points = ($('poly-points') as HTMLTextAreaElement).value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [x, y] = line.split(',').map((n) => Number(n.trim()));
        return { x: x || 0, y: y || 0 };
      });
    commitChange();
  });

  $('btn-dup').addEventListener('click', () => {
    const p = selected();
    if (!p) return;
    const copy = { ...p, id: newPrimitiveId(p.kind), x: p.x + 2, y: p.y + 2 };
    if (p.points) copy.points = p.points.map((pt) => ({ x: pt.x + 2, y: pt.y + 2 }));
    spec.primitives.push(copy);
    selectedId = copy.id;
    commitChange();
  });
  $('btn-del').addEventListener('click', () => {
    if (!selectedId) return;
    spec.primitives = spec.primitives.filter((p) => p.id !== selectedId);
    selectedId = spec.primitives.at(-1)?.id ?? null;
    commitChange();
  });
  $('btn-back').addEventListener('click', () => moveSelected(-1));
  $('btn-fwd').addEventListener('click', () => moveSelected(1));

  const floor = $('floor-y') as HTMLInputElement;
  floor.min = String(tuning.depthFar);
  floor.max = String(tuning.depthNear);
  floor.addEventListener('input', () => {
    preview?.setFloorY(Number(floor.value));
    updateFloorReadout();
  });
  $('btn-near').addEventListener('click', () => setTrackFloor('near'));
  $('btn-far').addEventListener('click', () => setTrackFloor('far'));

  ($('sug-kind') as HTMLSelectElement).addEventListener('change', () => {
    spec.suggested.kind = ($('sug-kind') as HTMLSelectElement).value as EnvElementSpec['suggested']['kind'];
    commitChange();
  });
  ($('sug-track') as HTMLSelectElement).addEventListener('change', () => {
    spec.suggested.track = ($('sug-track') as HTMLSelectElement).value as EnvElementSpec['suggested']['track'];
    commitChange();
  });
  $('sug-floorx').addEventListener('change', () => {
    spec.suggested.floorX = Math.round(Number(($('sug-floorx') as HTMLInputElement).value) || 0);
    commitChange();
  });

  $('btn-export-png').addEventListener('click', () => {
    if (!composed) return;
    downloadPng(composed, `${spec.id}.png`);
    setStatus(`Exported ${spec.id}.png · ${composed.width}×${composed.height} · outline baked`);
  });
  $('btn-copy').addEventListener('click', async () => {
    const text = scenerySnippet(spec);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied scenery snippet');
    } catch {
      setStatus('Copy failed — select the snippet and copy manually');
    }
  });
  $('btn-save-json').addEventListener('click', () => {
    downloadText(specToJson(spec), `${spec.id}.json`, 'application/json');
    setStatus(`Saved ${spec.id}.json`);
  });
  $('load-json').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    try {
      spec = parseSpec(JSON.parse(await file.text()) as unknown);
      selectedId = spec.primitives[0]?.id ?? null;
      commitChange();
      setStatus(`Loaded ${file.name}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Invalid spec JSON');
    }
  });
  $('import-png').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    const dataUrl = await readFileDataUrl(file);
    spec.baseImage = { dataUrl, x: 0, y: 0, w: spec.width, h: spec.height };
    commitChange();
    setStatus(`Imported ${file.name}`);
  });
  $('btn-clear-png').addEventListener('click', () => {
    delete spec.baseImage;
    commitChange();
  });

  $('btn-undo').addEventListener('click', () => undo());
  $('btn-redo').addEventListener('click', () => redo());
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement
    ) {
      return;
    }
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    if (e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }
    if (e.key === 'y') {
      e.preventDefault();
      redo();
    }
  });

  composeView.addEventListener('pointerdown', onComposePointerDown);
  composeView.addEventListener('pointermove', onComposePointerMove);
  window.addEventListener('pointerup', () => {
    if (drag && dragMoved) commitChange();
    drag = null;
    dragMoved = false;
  });
}

function bindPrimField(id: string, apply: (p: EnvPrimitive, v: number) => void): void {
  $(id).addEventListener('change', () => {
    const p = selected();
    if (!p) return;
    apply(p, Number(($(id) as HTMLInputElement).value) || 0);
    commitChange();
  });
}

function clampSize(raw: string): number {
  return Math.max(4, Math.min(256, Math.round(Number(raw) || 8)));
}

function addPrimitive(kind: PrimitiveKind): void {
  const fill = snapToPalette(hexFromRgbNumber(tuning.colors.fenceWoodMid));
  const p: EnvPrimitive = {
    id: newPrimitiveId(kind),
    kind,
    role: kind === 'ellipse' || kind === 'blob' ? 'foliage' : 'anchor',
    x: 2,
    y: 2,
    w: Math.max(6, Math.round(spec.width * 0.6)),
    h: Math.max(6, Math.round(spec.height * 0.35)),
    fill,
  };
  if (kind === 'polygon') {
    p.points = [
      { x: p.x + p.w / 2, y: p.y },
      { x: p.x + p.w, y: p.y + p.h },
      { x: p.x, y: p.y + p.h },
    ];
  }
  if (kind === 'blob') p.blobSeed = spec.primitives.length + 1;
  spec.primitives.push(p);
  selectedId = p.id;
  commitChange();
}

function moveSelected(dir: number): void {
  const i = spec.primitives.findIndex((p) => p.id === selectedId);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= spec.primitives.length) return;
  const [item] = spec.primitives.splice(i, 1);
  spec.primitives.splice(j, 0, item!);
  commitChange();
}

function setTrackFloor(id: 'near' | 'far'): void {
  const api = preview;
  const tracks = api?.getTracks();
  if (!api || !tracks) return;
  const t = tracks.find((tr) => tr.id === id);
  if (!t) return;
  ($('floor-y') as HTMLInputElement).value = String(Math.round(t.floorY));
  api.setFloorY(t.floorY);
  updateFloorReadout();
}

function onComposePointerDown(e: PointerEvent): void {
  const { x, y } = composeLocal(e);
  const id = hitTestPrimitive(spec, x, y);
  selectedId = id;
  syncPrimUi();
  drawCompose();
  if (!id) return;
  const p = spec.primitives.find((pr) => pr.id === id);
  if (!p) return;
  drag = { id, dx: x - p.x, dy: y - p.y };
  dragMoved = false;
  composeView.setPointerCapture(e.pointerId);
}

function onComposePointerMove(e: PointerEvent): void {
  if (!drag) return;
  const { x, y } = composeLocal(e);
  const p = spec.primitives.find((pr) => pr.id === drag!.id);
  if (!p) return;
  const nx = Math.round(x - drag.dx);
  const ny = Math.round(y - drag.dy);
  const dx = nx - p.x;
  const dy = ny - p.y;
  if (dx === 0 && dy === 0) return;
  dragMoved = true;
  p.x = nx;
  p.y = ny;
  if (p.points) {
    for (const pt of p.points) {
      pt.x += dx;
      pt.y += dy;
    }
  }
  scheduleCompose();
  syncPrimUi();
}

function composeLocal(e: PointerEvent): { x: number; y: number } {
  const rect = composeView.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoom,
    y: (e.clientY - rect.top) / zoom,
  };
}

function scheduleCompose(): void {
  window.clearTimeout(composeTimer);
  composeTimer = window.setTimeout(() => void refreshSpec(), 16);
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsDataURL(file);
  });
}

function syncElementUi(): void {
  suppress = true;
  ($('type-select') as HTMLSelectElement).value = spec.type;
  ($('field-id') as HTMLInputElement).value = spec.id;
  ($('field-w') as HTMLInputElement).value = String(spec.width);
  ($('field-h') as HTMLInputElement).value = String(spec.height);
  ($('sug-kind') as HTMLSelectElement).value = spec.suggested.kind;
  ($('sug-track') as HTMLSelectElement).value = spec.suggested.track;
  ($('sug-floorx') as HTMLInputElement).value = String(spec.suggested.floorX);
  ($('snippet') as HTMLTextAreaElement).value = scenerySnippet(spec);
  suppress = false;
  syncPrimList();
  syncPrimUi();
}

function syncPrimList(): void {
  const root = $('prim-list');
  root.replaceChildren();
  for (const p of spec.primitives) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `prim-row${p.id === selectedId ? ' selected' : ''}`;
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = p.fill;
    const label = document.createElement('span');
    label.textContent = `${p.id} · ${p.kind} · ${p.role}`;
    btn.append(sw, label);
    btn.addEventListener('click', () => {
      selectedId = p.id;
      syncPrimList();
      syncPrimUi();
      drawCompose();
    });
    root.appendChild(btn);
  }
}

function syncPrimUi(): void {
  const p = selected();
  $('sel-label').textContent = p ? `${p.id} (${p.kind})` : 'None';
  ($('prim-x') as HTMLInputElement).value = String(p?.x ?? 0);
  ($('prim-y') as HTMLInputElement).value = String(p?.y ?? 0);
  ($('prim-w') as HTMLInputElement).value = String(p?.w ?? 0);
  ($('prim-h') as HTMLInputElement).value = String(p?.h ?? 0);
  ($('prim-fill') as HTMLInputElement).value = p?.fill ?? '';
  ($('prim-role') as HTMLSelectElement).value = p?.role ?? 'anchor';
  const blobRow = $('blob-seed-row');
  const polyRow = $('poly-row');
  blobRow.hidden = p?.kind !== 'blob';
  polyRow.hidden = p?.kind !== 'polygon';
  if (p?.kind === 'blob') {
    ($('blob-seed') as HTMLInputElement).value = String(p.blobSeed ?? 1);
  }
  if (p?.kind === 'polygon') {
    ($('poly-points') as HTMLTextAreaElement).value = (p.points ?? [])
      .map((pt) => `${pt.x},${pt.y}`)
      .join('\n');
  }
}

function drawCompose(): void {
  const src = composed;
  const w = spec.width;
  const h = spec.height;
  composeView.width = Math.max(1, w * zoom);
  composeView.height = Math.max(1, h * zoom);
  composeCtx.imageSmoothingEnabled = false;
  composeCtx.clearRect(0, 0, composeView.width, composeView.height);
  if (src) composeCtx.drawImage(src, 0, 0, composeView.width, composeView.height);
  const p = selected();
  if (!p) return;
  composeCtx.strokeStyle = '#8fba6a';
  composeCtx.lineWidth = 1;
  composeCtx.strokeRect(p.x * zoom + 0.5, p.y * zoom + 0.5, p.w * zoom - 1, p.h * zoom - 1);
}

function updateFloorReadout(): void {
  const fy = preview?.getFloorY() ?? tuning.depthNear;
  const scale = Projection.depthScale(fy);
  ($('floor-y') as HTMLInputElement).value = String(Math.round(fy));
  $('floor-readout').textContent = `floorY ${fy.toFixed(0)} · depthScale ${scale.toFixed(3)} · foreshorten ${tuning.foreshorten}`;
  $('btn-near').classList.toggle('active', Math.abs(fy - nearFloor()) < 8);
  $('btn-far').classList.toggle('active', Math.abs(fy - farFloor()) < 8);
  hud.textContent =
    `${spec.id}  ${spec.width}×${spec.height}\n` +
    `outline 1px alpha-edge  ${spec.outline.color}\n` +
    `floorY ${fy.toFixed(0)}  depthScale ${scale.toFixed(3)}`;
}

function nearFloor(): number {
  return preview?.getTracks().find((t) => t.id === 'near')?.floorY ?? tuning.depthNear;
}

function farFloor(): number {
  return preview?.getTracks().find((t) => t.id === 'far')?.floorY ?? tuning.depthFar;
}

async function refreshSpec(): Promise<void> {
  if (suppress) return;
  persist();
  syncElementUi();
  try {
    composed = await composeElement(spec);
    preview?.setCanvas(composed);
    drawCompose();
    updateFloorReadout();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Compose failed');
  }
}

bindFields();

bootPreview($('viewport'), (api) => {
  preview = api;
  const near = api.getTracks().find((t) => t.id === 'near');
  if (near) api.setFloorY(near.floorY);
  void refreshSpec();
  setStatus('Environment Studio · Phase A · shared palette / outline / Projection');
});
