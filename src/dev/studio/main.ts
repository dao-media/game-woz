/**
 * Dorothy 3D Studio — clip stack, Mixamo remap, transparent PNG export.
 * Open via /3d-studio.html
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import {
  builtInClips,
  STUDIO_CHARACTERS,
  type CatalogClip,
  type StudioCharacterId,
} from './clipCatalog';
import { ClipStack } from './clipStack';
import {
  detectRigKind,
  remapClipToDorothy,
  applyRootMotionMode,
  mirrorAnimationClip,
  type RootMotionMode,
} from './remapClip';
import { applyAlphaOutline, exportPngSequence, timelineToAnimTime } from './exporter';

const TARGET_HEIGHT_M = 1.7;
const DEFAULT_CHARACTER: StudioCharacterId = 'rigged';
/** Clockwise 90° from above (align body facing to Mixamo forward). */
const MODEL_YAW_CLOCKWISE_RAD = -Math.PI / 2;
/** Orbit pitch locked: degrees down from horizontal. Pan / azimuth / zoom stay free. */
const CAMERA_DOWN_DEG = 28;
/** Default look-at height above ground (meters). */
const CAMERA_LOOK_Y_DEFAULT = 1.3;
const DEFAULT_EXPORT_FPS = 30;
/** Cap on each loop-extend pad (seconds). */
const MAX_TIMELINE_PAD_SEC = 30;

/** Filename-safe segment for export prefix parts. */
function slugifyPart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'x'
  );
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const hud = $('hud');
const clipListEl = $('clip-list');
const stackEl = $('stack-list');
const statusEl = $('status');
const clothNote = $('cloth-note');

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setHud(text: string): void {
  hud.textContent = text;
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) found = obj as THREE.SkinnedMesh;
  });
  return found;
}

function getBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.Bone).isBone && obj.name === name) found = obj as THREE.Bone;
  });
  return found;
}

/**
 * Mixamo Dorothy GLBs often export white metalness=1 materials with no map.
 * Prefer embedded albedo when present; otherwise bind the shared atlas.
 */
async function applyCharacterAlbedo(
  root: THREE.Object3D,
  albedoUrl: string | undefined,
): Promise<void> {
  let needsExternal = false;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std?.isMeshStandardMaterial && !std.map) needsExternal = true;
    }
  });

  let map: THREE.Texture | null = null;
  if (needsExternal && albedoUrl) {
    map = await new THREE.TextureLoader().loadAsync(albedoUrl);
    // glTF meshes use glTF UV convention (origin top-left).
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
  }

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      mat.side = THREE.FrontSide;
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        if (map) {
          std.map = map;
          std.color.set(0xffffff);
        }
        if (std.map) {
          std.map.colorSpace = THREE.SRGBColorSpace;
          std.map.anisotropy = Math.max(std.map.anisotropy, 8);
        }
        // Untextured exports defaulted to metalness 1 → clay/chrome look.
        if (std.metalness > 0.2) std.metalness = 0;
        if (std.roughness < 0.35) std.roughness = 0.72;
        std.needsUpdate = true;
      } else if (map && 'map' in mat) {
        (mat as THREE.MeshBasicMaterial).map = map;
        mat.needsUpdate = true;
      }
    }
  });
}

function skeletonWorldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let any = false;
  const p = new THREE.Vector3();
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    obj.getWorldPosition(p);
    box.expandByPoint(p);
    any = true;
  });
  if (!any || box.isEmpty()) box.setFromObject(root);
  return box;
}

function normalizeCharacterPose(root: THREE.Object3D): number {
  root.rotation.set(0, MODEL_YAW_CLOCKWISE_RAD, 0);
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  const head = getBone(root, 'Head');
  const foot =
    getBone(root, 'LeftFoot') ??
    getBone(root, 'RightFoot') ??
    getBone(root, 'L_Foot') ??
    getBone(root, 'R_Foot') ??
    getBone(root, 'Hips') ??
    getBone(root, 'Pelvis') ??
    getBone(root, 'Hip');
  let up = new THREE.Vector3();
  if (head && foot) {
    up.copy(head.getWorldPosition(new THREE.Vector3())).sub(foot.getWorldPosition(new THREE.Vector3()));
  } else {
    const size = skeletonWorldBox(root).getSize(new THREE.Vector3());
    up.set(size.x, size.y, size.z);
  }
  const ax = Math.abs(up.x);
  const ay = Math.abs(up.y);
  const az = Math.abs(up.z);
  if (ay < ax || ay < az) {
    if (az >= ax) root.rotation.x = up.z >= 0 ? -Math.PI / 2 : Math.PI / 2;
    else root.rotation.z = up.x >= 0 ? Math.PI / 2 : -Math.PI / 2;
    root.updateMatrixWorld(true);
  }

  let height = 1;
  if (head && foot) {
    height = Math.max(
      Math.abs(head.getWorldPosition(new THREE.Vector3()).y - foot.getWorldPosition(new THREE.Vector3()).y),
      1e-3,
    );
  } else {
    height = Math.max(skeletonWorldBox(root).getSize(new THREE.Vector3()).y, 1e-3);
  }
  const scale = Math.min(Math.max(TARGET_HEIGHT_M / height, 0.001), 20);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const grounded = skeletonWorldBox(root);
  root.position.y -= grounded.min.y;
  root.position.x -= (grounded.min.x + grounded.max.x) * 0.5;
  root.position.z -= (grounded.min.z + grounded.max.z) * 0.5;
  root.updateMatrixWorld(true);
  return scale;
}

function fitCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D,
): { groundY: number; topY: number; lookY: number } {
  const box = skeletonWorldBox(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, 0.5);
  const width = Math.max(size.x, size.z, 0.5);
  const fitH = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const fitW = width / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  const dist = Math.max(fitH, fitW) * 1.35;
  const pitch = THREE.MathUtils.degToRad(CAMERA_DOWN_DEG);
  // Three-quarter view (not straight-on) so the face isn't foreshortened into the floor.
  const yaw = THREE.MathUtils.degToRad(38);
  camera.near = Math.max(0.05, dist / 100);
  camera.far = Math.max(100, dist * 20);
  camera.updateProjectionMatrix();
  camera.position.set(
    center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    center.y + Math.sin(pitch) * dist,
    center.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  controls.target.copy(center);
  controls.minDistance = dist * 0.25;
  controls.maxDistance = dist * 6;
  // Lock polar at CAMERA_DOWN_DEG below horizontal (azimuth orbit / pan / zoom free).
  const polar = Math.PI / 2 - pitch;
  controls.minPolarAngle = polar;
  controls.maxPolarAngle = polar;
  controls.update();
  return { groundY: box.min.y, topY: box.max.y, lookY: center.y };
}

/**
 * Raise/lower the whole rig (camera + look target) on world Y.
 * Polar stays locked; this only cranes the look height.
 */
function setCameraCraneHeight(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  lookY: number,
): void {
  const dy = lookY - controls.target.y;
  controls.target.y += dy;
  camera.position.y += dy;
  controls.update();
}

/** Eight compass notches for sprite/export orbit (45°). */
const SCENE_YAW_DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
const SCENE_YAW_STEP = Math.PI / 4;

function normalizeAngle(rad: number): number {
  const twoPi = Math.PI * 2;
  return ((rad % twoPi) + twoPi) % twoPi;
}

/** Lock orbit azimuth to an 8-way notch (keeps distance + locked polar). */
function setSceneYawNotch(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  index: number,
): void {
  const i = ((Math.round(index) % 8) + 8) % 8;
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  // +π: label E = camera on the west side looking east (character faces the label).
  spherical.theta = i * SCENE_YAW_STEP + Math.PI;
  // Keep polar locked to OrbitControls clamp.
  spherical.phi = controls.getPolarAngle();
  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  controls.update();
}

function sceneYawIndexFromAzimuth(theta: number): number {
  return Math.round(normalizeAngle(theta - Math.PI) / SCENE_YAW_STEP) % 8;
}

function flattenCubicSplineClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  /**
   * glTF CUBICSPLINE stores 3× values per key (in-tangent, value, out-tangent).
   * If the custom interpolant is ever lost, Linear reads tangents as quats → frozen/NaN pose.
   * Flatten to LINEAR value keys so playback is bulletproof.
   */
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const trackAny = track as THREE.KeyframeTrack & {
      createInterpolant?: ((result: Float32Array) => unknown) & {
        isInterpolantFactoryMethodGLTFCubicSpline?: boolean;
      };
    };
    const isCubic = !!trackAny.createInterpolant?.isInterpolantFactoryMethodGLTFCubicSpline;
    if (!isCubic) {
      tracks.push(track.clone());
      continue;
    }
    const valueSize = track.getValueSize() / 3;
    const n = track.times.length;
    const values = new Float32Array(n * valueSize);
    for (let i = 0; i < n; i++) {
      const src = i * valueSize * 3 + valueSize; // skip in-tangent
      for (let k = 0; k < valueSize; k++) values[i * valueSize + k] = track.values[src + k]!;
    }
    const Ctor = track.constructor as new (
      name: string,
      times: ArrayLike<number>,
      values: ArrayLike<number>,
    ) => THREE.KeyframeTrack;
    tracks.push(new Ctor(track.name, track.times.slice(), values));
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function captureBoneLocals(root: THREE.Object3D): Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }> {
  const map = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }>();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    map.set(obj.name, {
      pos: obj.position.clone(),
      quat: obj.quaternion.clone(),
      scale: obj.scale.clone(),
    });
  });
  return map;
}

/**
 * Temporal pose smoothening: after the mixer writes the raw Mixamo frame,
 * ease bone locals toward that target. Amount 0 = off, 1 ≈ strong damping.
 */
function applyPoseSmoothening(
  root: THREE.Object3D,
  prev: Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>,
  amount: number,
  dt: number,
): void {
  if (amount <= 0.001) {
    prev.clear();
    root.traverse((obj) => {
      if (!(obj as THREE.Bone).isBone) return;
      prev.set(obj.name, { pos: obj.position.clone(), quat: obj.quaternion.clone() });
    });
    return;
  }
  // Half-life from ~2 frames (light) to ~20 frames (heavy) at 60fps.
  const halfLife = THREE.MathUtils.lerp(1 / 60, 20 / 60, amount);
  const alpha = 1 - Math.pow(0.5, dt / Math.max(halfLife, 1e-4));
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const bone = obj as THREE.Bone;
    let state = prev.get(bone.name);
    if (!state) {
      state = { pos: bone.position.clone(), quat: bone.quaternion.clone() };
      prev.set(bone.name, state);
    }
    const targetPos = bone.position.clone();
    const targetQuat = bone.quaternion.clone();
    state.pos.lerp(targetPos, alpha);
    state.quat.slerp(targetQuat, alpha);
    bone.position.copy(state.pos);
    bone.quaternion.copy(state.quat);
  });
}

function restoreBoneLocals(
  root: THREE.Object3D,
  rest: Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }>,
): void {
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    const r = rest.get(obj.name);
    if (!r) return;
    obj.position.copy(r.pos);
    obj.quaternion.copy(r.quat);
    obj.scale.copy(r.scale);
  });
  root.updateMatrixWorld(true);
}

/**
 * skeleton.pose() on these glTFs writes Hips.scale=0.01 (armature bind quirk).
 * Prefer captured locals for mixamo_char; pose() is OK for Tripo.
 */
function resetToRest(
  skinned: THREE.SkinnedMesh,
  root: THREE.Object3D,
  rest: Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }> | null,
  rig: 'mixamo_char' | 'tripo',
): void {
  if (rig === 'mixamo_char' && rest) {
    restoreBoneLocals(root, rest);
  } else {
    skinned.skeleton.pose();
  }
}

function hasClothBones(root: THREE.Object3D): boolean {
  const keys = /cloth|hair|skirt|dress|cape|ribbon|ponytail|bang/i;
  let found = false;
  root.traverse((obj) => {
    if ((obj as THREE.Bone).isBone && keys.test(obj.name)) found = true;
  });
  return found;
}

async function loadClipFromUrl(
  url: string,
  kind: 'fbx' | 'glb',
  label: string,
  targetSkinned: THREE.SkinnedMesh,
): Promise<THREE.AnimationClip> {
  const rigKind = detectRigKind(targetSkinned);
  if (kind === 'glb') {
    const gltf = await new GLTFLoader().loadAsync(url);
    const clip = gltf.animations[0];
    if (!clip) throw new Error(`No animation in ${label}`);
    return remapClipToDorothy(clip, { name: label, targetSkinned, kind: rigKind });
  }
  const fbx = await new FBXLoader().loadAsync(url);
  const clip = fbx.animations[0];
  if (!clip) throw new Error(`No animation in ${label}`);
  return remapClipToDorothy(clip, {
    name: label,
    targetSkinned,
    sourceRoot: fbx,
    kind: rigKind,
  });
}

async function loadClipFromFile(
  file: File,
  targetSkinned: THREE.SkinnedMesh,
): Promise<THREE.AnimationClip> {
  const url = URL.createObjectURL(file);
  try {
    const kind =
      file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')
        ? 'glb'
        : 'fbx';
    return await loadClipFromUrl(url, kind, file.name.replace(/\.[^.]+$/, ''), targetSkinned);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderClipLibrary(
  characterId: StudioCharacterId,
  onAdd: (clip: CatalogClip) => void,
): void {
  clipListEl.innerHTML = '';
  for (const clip of builtInClips(characterId)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'clip-row';
    row.innerHTML = `<span>${clip.label}</span><span class="muted">${clip.kind.toUpperCase()}</span>`;
    row.addEventListener('click', () => onAdd(clip));
    clipListEl.appendChild(row);
  }
}

function renderStack(
  stack: ClipStack,
  onChange: () => void,
  onRemoveLabel?: (label: string) => void,
): void {
  stackEl.innerHTML = '';
  if (stack.layers.length === 0) {
    stackEl.innerHTML = `<p class="empty">No clips in stack. Pick from the library or drop an FBX/GLB.</p>`;
    return;
  }
  for (const layer of stack.layers) {
    const card = document.createElement('div');
    card.className = 'stack-card';
    card.innerHTML = `
      <div class="stack-head">
        <label class="check"><input type="checkbox" data-k="enabled" ${layer.enabled ? 'checked' : ''}/> ${layer.label}</label>
        <div class="stack-actions">
          <button type="button" data-act="up" title="Move up">↑</button>
          <button type="button" data-act="down" title="Move down">↓</button>
          <button type="button" data-act="rm" title="Remove">×</button>
        </div>
      </div>
      <label class="field">Weight <input type="range" min="0" max="1" step="0.05" value="${layer.weight}" data-k="weight"/><span>${layer.weight.toFixed(2)}</span></label>
      <label class="field">Fade in <input type="number" min="0" max="2" step="0.05" value="${layer.fadeIn}" data-k="fadeIn"/></label>
      <label class="field">Fade out <input type="number" min="0" max="2" step="0.05" value="${layer.fadeOut}" data-k="fadeOut"/></label>
      <label class="check"><input type="checkbox" data-k="loop" ${layer.loop ? 'checked' : ''}/> Loop</label>
    `;
    card.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        const k = (input as HTMLElement).dataset.k;
        if (!k) return;
        if (k === 'enabled' || k === 'loop') {
          stack.updateLayer(layer.id, { [k]: (input as HTMLInputElement).checked });
        } else if (k === 'weight') {
          const v = Number((input as HTMLInputElement).value);
          stack.updateLayer(layer.id, { weight: v });
          const span = input.parentElement?.querySelector('span');
          if (span) span.textContent = v.toFixed(2);
        } else {
          stack.updateLayer(layer.id, { [k]: Number((input as HTMLInputElement).value) });
        }
        onChange();
      });
    });
    card.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = (btn as HTMLElement).dataset.act;
        if (act === 'up') stack.move(layer.id, -1);
        if (act === 'down') stack.move(layer.id, 1);
        if (act === 'rm') {
          onRemoveLabel?.(layer.label);
          stack.remove(layer.id);
        }
        onChange();
      });
    });
    stackEl.appendChild(card);
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const initialChar = (params.get('char') as StudioCharacterId) || DEFAULT_CHARACTER;
  const character =
    STUDIO_CHARACTERS.find((c) => c.id === initialChar) ?? STUDIO_CHARACTERS[0]!;

  const charSelect = $('character-select') as HTMLSelectElement;
  charSelect.innerHTML = '';
  for (const c of STUDIO_CHARACTERS) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    if (c.id === character.id) opt.selected = true;
    charSelect.appendChild(opt);
  }
  charSelect.addEventListener('change', () => {
    const next = charSelect.value;
    const url = new URL(window.location.href);
    url.searchParams.set('char', next);
    window.location.href = url.toString();
  });

  const viewport = $('viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0c0d10, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  viewport.appendChild(renderer.domElement);

  /** 2D overlay: same alpha-outline pass as export, composited on studio bg. */
  const outlinePreview = document.createElement('canvas');
  outlinePreview.id = 'outline-preview';
  outlinePreview.setAttribute('aria-hidden', 'true');
  viewport.appendChild(outlinePreview);
  const outlinePreviewCtx = outlinePreview.getContext('2d')!;
  const PREVIEW_BG = '#0c0d10';
  /** Cap outline work for live preview (export still uses full resolution). */
  const OUTLINE_PREVIEW_MAX_EDGE = 900;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0d10);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const lockedPolar = Math.PI / 2 - THREE.MathUtils.degToRad(CAMERA_DOWN_DEG);
  controls.minPolarAngle = lockedPolar;
  controls.maxPolarAngle = lockedPolar;

  const hemi = new THREE.HemisphereLight(0xdde6ff, 0x1a1c22, 1.4);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e8, 2.0);
  key.position.set(2.4, 4, 2.8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88a0ff, 0.55);
  rim.position.set(-2, 2, -2);
  scene.add(rim);
  /** Viewport-only helpers — never included in PNG export. */
  const studioEnv = new THREE.Group();
  studioEnv.name = 'studio-env';
  const grid = new THREE.GridHelper(4, 16, 0x3a3d48, 0x22252e);
  studioEnv.add(grid);
  scene.add(studioEnv);

  function resize(): void {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const dpr = renderer.getPixelRatio();
    outlinePreview.width = Math.max(1, Math.floor(w * dpr));
    outlinePreview.height = Math.max(1, Math.floor(h * dpr));
  }
  resize();
  window.addEventListener('resize', resize);

  setHud(`Loading ${character.label}…`);
  let gltf: Awaited<ReturnType<InstanceType<typeof GLTFLoader>['loadAsync']>>;
  try {
    gltf = await new GLTFLoader().loadAsync(character.url);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const looksLikeHtml =
      /doctype|is not valid JSON|Unexpected token\s+'<'/i.test(raw);
    setHud(
      [
        `Missing model: ${character.url}`,
        'Restore models/dorothy/MASTER (+ Animations), then refresh.',
        looksLikeHtml
          ? 'Vite returned HTML for a missing file — asset is not on disk.'
          : raw,
      ].join('\n'),
    );
    setStatus('Model missing — restore models/dorothy then refresh');
    clothNote.textContent = 'No character loaded.';
    const tickEmpty = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(tickEmpty);
    return;
  }
  const dorothy = gltf.scene;
  scene.add(dorothy);
  const skinned = findSkinnedMesh(dorothy);
  if (!skinned) {
    setHud(`No skinned mesh in ${character.label}`);
    setStatus('No skinned mesh in character file');
    const tickEmpty = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(tickEmpty);
    return;
  }

  dorothy.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Drop leftover authoring helpers (e.g. Mixamo Icosphere markers) from view + export.
    const geo = mesh.geometry as THREE.BufferGeometry | undefined;
    const verts = geo?.attributes?.position?.count ?? 0;
    const isHelper =
      /icosphere|sphere|helper|marker|target|empty/i.test(mesh.name) ||
      (!(mesh as THREE.SkinnedMesh).isSkinnedMesh && verts > 0 && verts < 200);
    if (isHelper) {
      mesh.visible = false;
      return;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && 'side' in mat) mat.side = THREE.FrontSide;
    }
  });
  await applyCharacterAlbedo(dorothy, character.albedoUrl);

  const scale = normalizeCharacterPose(dorothy);
  // Capture locals AFTER normalize (root scale) but BEFORE any skeleton.pose().
  const boneRest = captureBoneLocals(dorothy);
  /** Root transform after first normalize — restore on Stop (never re-infer tip). */
  const rootRest = {
    position: dorothy.position.clone(),
    quaternion: dorothy.quaternion.clone(),
    scale: dorothy.scale.clone(),
  };

  const restoreStudioRest = () => {
    stack.stopAll();
    resetToRest(skinned, dorothy, boneRest, character.rig);
    dorothy.position.copy(rootRest.position);
    dorothy.quaternion.copy(rootRest.quaternion);
    dorothy.scale.copy(rootRest.scale);
    dorothy.updateMatrixWorld(true);
  };
  const camBounds = fitCamera(camera, controls, dorothy);
  const defaultLookY = Math.min(
    Math.max(camBounds.groundY + CAMERA_LOOK_Y_DEFAULT, camBounds.groundY),
    camBounds.topY,
  );
  setCameraCraneHeight(camera, controls, defaultLookY);

  const cloth = hasClothBones(dorothy);
  clothNote.textContent = cloth
    ? 'Cloth/hair bones detected — cloth clips can target them.'
    : `Rig: ${character.rig} · no separate cloth/hair bones (dress/hair ride body weights).`;

  const stack = new ClipStack(dorothy);
  let skeletonHelper: THREE.SkeletonHelper | null = null;
  let playing = false;
  /** Wall-clock scrub of the export timeline (Speed slider). Mixer stays 1×. */
  let previewSpeed = 1;
  /** Animation-seconds into the current export package (pads + loops × clip). */
  let previewAnimTime = 0;
  /** Accumulator for discrete export-FPS frame steps. */
  let previewFrameAccum = 0;
  /** Loop-extend pads (seconds) — shared by timeline UI, preview, and export. */
  let padBeforeSec = 0;
  let padAfterSec = 0;
  const smoothedPose = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>();
  let smoothAmount = 0;
  let rootMotionMode: RootMotionMode = 'inplace';
  let mirrorEnabled = false;
  /** Travel-preserving sources so In place / Travel / Mirror can re-apply. */
  const stackSources: { label: string; travelClip: THREE.AnimationClip }[] = [];
  (window as unknown as { __studio?: unknown }).__studio = {
    character,
    dorothy,
    skinned,
    stack,
    gltf,
    camera,
    controls,
    get playing() {
      return playing;
    },
    get mirror() {
      return mirrorEnabled;
    },
    get rootMotion() {
      return rootMotionMode;
    },
  };

  const exportPrefixEl = $('export-prefix') as HTMLInputElement;
  const exportLoopsEl = $('export-loops') as HTMLInputElement;
  const exportLoopsVal = $('export-loops-val');
  const tlTrack = $('tl-track');
  const tlPadBefore = $('tl-pad-before');
  const tlCore = $('tl-core');
  const tlPadAfter = $('tl-pad-after');
  const tlPlayhead = $('tl-playhead');
  const tlHandleL = $('tl-handle-l');
  const tlHandleR = $('tl-handle-r');
  const tlBeforeVal = $('tl-before-val');
  const tlCoreVal = $('tl-core-val');
  const tlAfterVal = $('tl-after-val');
  const tlPadBeforeInput = $('tl-pad-before-input') as HTMLInputElement;
  const tlPadAfterInput = $('tl-pad-after-input') as HTMLInputElement;

  /** Last auto-generated prefix; if the field still matches, keep syncing character_direction_animation. */
  let lastAutoExportPrefix = '';

  const buildExportPrefix = (): string => {
    const charPart = slugifyPart(character.label.split(/\s+/)[0] ?? character.id);
    const dirIdx = ((Number(($('scene-yaw') as HTMLInputElement).value) % 8) + 8) % 8;
    const dirPart = slugifyPart(SCENE_YAW_DIRS[dirIdx] ?? 'E');
    const animLabels = stack.layers.filter((l) => l.enabled).map((l) => l.label);
    const animPart = slugifyPart(animLabels.length > 0 ? animLabels.join(' ') : 'clip');
    return `${charPart}_${dirPart}_${animPart}`;
  };

  const syncExportPrefix = (force = false) => {
    const next = buildExportPrefix();
    if (force || !exportPrefixEl.value.trim() || exportPrefixEl.value === lastAutoExportPrefix) {
      exportPrefixEl.value = next;
    }
    lastAutoExportPrefix = next;
  };

  const clampPad = (sec: number) =>
    Math.max(0, Math.min(MAX_TIMELINE_PAD_SEC, Math.round(sec * 100) / 100));

  const readLoops = () =>
    Math.max(1, Math.min(20, Math.round(Number(exportLoopsEl.value) || 1)));

  const readExportPreviewUi = () => {
    const loops = readLoops();
    const fpsRaw = Number(($('export-fps') as HTMLSelectElement).value);
    const fps = Number.isFinite(fpsRaw) && fpsRaw > 0 ? fpsRaw : DEFAULT_EXPORT_FPS;
    const prefix = (exportPrefixEl.value || lastAutoExportPrefix || 'dorothy_e_clip').replace(
      /[^\w-]+/g,
      '_',
    );
    return {
      loops,
      fps,
      prefix,
      padBeforeSec,
      padAfterSec,
      outline: {
        enabled: ($('export-outline') as HTMLInputElement).checked,
        width: Math.max(
          1,
          Math.min(16, Math.round(Number(($('export-outline-width') as HTMLInputElement).value) || 2)),
        ),
        color: ($('export-outline-color') as HTMLInputElement).value || '#000000',
      },
    };
  };

  const packageTiming = (fps = DEFAULT_EXPORT_FPS) => {
    const loops = readLoops();
    const frameDt = 1 / Math.max(1, fps);
    const clipDur = Math.max(stack.duration(), frameDt);
    const coreDur = clipDur * loops;
    const totalDur = padBeforeSec + coreDur + padAfterSec;
    const totalFrames = Math.max(1, Math.round(totalDur * fps));
    return { loops, clipDur, coreDur, totalDur, totalFrames, frameDt };
  };

  const sampleTimeline = (timelineSec: number, clipDur: number, smoothDt: number) => {
    const animT = timelineToAnimTime(timelineSec, padBeforeSec, clipDur);
    stack.scrubTo(animT);
    applyPoseSmoothening(dorothy, smoothedPose, smoothAmount, smoothDt);
    dorothy.updateMatrixWorld(true);
  };

  const paintTimeline = () => {
    const ui = readExportPreviewUi();
    const { loops, clipDur, coreDur, totalDur } = packageTiming(ui.fps);
    const span = Math.max(totalDur, 1e-6);
    const beforePct = (padBeforeSec / span) * 100;
    const corePct = (coreDur / span) * 100;
    const afterPct = (padAfterSec / span) * 100;

    tlPadBefore.style.flexBasis = `${beforePct}%`;
    tlCore.style.flexBasis = `${corePct}%`;
    tlPadAfter.style.flexBasis = `${afterPct}%`;
    tlCore.style.setProperty('--tl-loops', String(loops));

    const leftHandlePct = beforePct;
    const rightHandlePct = beforePct + corePct;
    tlHandleL.style.left = `${leftHandlePct}%`;
    tlHandleR.style.left = `${rightHandlePct}%`;

    exportLoopsEl.value = String(loops);
    exportLoopsVal.textContent = `×${loops}`;
    tlBeforeVal.textContent = `−${padBeforeSec.toFixed(2)}s`;
    tlCoreVal.textContent = `${coreDur.toFixed(2)}s · ${clipDur.toFixed(2)}s × ${loops}`;
    tlAfterVal.textContent = `+${padAfterSec.toFixed(2)}s`;

    if (document.activeElement !== tlPadBeforeInput) {
      tlPadBeforeInput.value = String(padBeforeSec);
    }
    if (document.activeElement !== tlPadAfterInput) {
      tlPadAfterInput.value = String(padAfterSec);
    }

    if (playing && totalDur > 0) {
      tlPlayhead.hidden = false;
      tlPlayhead.style.left = `${(previewAnimTime / span) * 100}%`;
    } else {
      tlPlayhead.hidden = true;
    }
  };

  const setPads = (before: number, after: number) => {
    padBeforeSec = clampPad(before);
    padAfterSec = clampPad(after);
    paintTimeline();
  };

  const bindPadHandle = (handle: HTMLElement, side: 'before' | 'after') => {
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      handle.setPointerCapture(ev.pointerId);
      const startX = ev.clientX;
      const startBefore = padBeforeSec;
      const startAfter = padAfterSec;
      const trackW = Math.max(1, tlTrack.getBoundingClientRect().width);
      const { totalDur } = packageTiming(readExportPreviewUi().fps);
      const pxPerSec = trackW / Math.max(totalDur, 0.25);

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        if (side === 'before') {
          // Drag left → more pad before; drag right → less.
          setPads(startBefore - dx / pxPerSec, startAfter);
        } else {
          setPads(startBefore, startAfter + dx / pxPerSec);
        }
      };
      const onUp = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  };
  bindPadHandle(tlHandleL, 'before');
  bindPadHandle(tlHandleR, 'after');

  tlPadBeforeInput.addEventListener('change', () => {
    setPads(Number(tlPadBeforeInput.value) || 0, padAfterSec);
  });
  tlPadAfterInput.addEventListener('change', () => {
    setPads(padBeforeSec, Number(tlPadAfterInput.value) || 0);
  });
  exportLoopsEl.addEventListener('input', () => {
    exportLoopsEl.value = String(readLoops());
    paintTimeline();
  });
  exportLoopsEl.addEventListener('change', () => paintTimeline());
  ($('export-fps') as HTMLSelectElement).addEventListener('change', () => paintTimeline());

  const resetExportPreviewClock = () => {
    previewAnimTime = 0;
    previewFrameAccum = 0;
    stack.mixer.timeScale = 1;
    stack.mixer.setTime(0);
  };

  const beginExportPreview = (note?: string) => {
    if (stack.layers.length === 0) return;
    smoothedPose.clear();
    resetExportPreviewClock();
    stack.playAll();
    // Scrub mode: actions stay paused; sampleTimeline drives pose.
    playing = true;
    const ui = readExportPreviewUi();
    const { totalFrames, clipDur } = packageTiming(ui.fps);
    sampleTimeline(0, clipDur, 0);
    paintTimeline();
    setStatus(
      note ??
        `Preview · ${ui.prefix}_0000 · loop 1/${ui.loops} · ${totalFrames}f @ ${ui.fps}fps`,
    );
  };

  const refreshStack = () => {
    renderStack(stack, refreshStack, (label) => {
      const i = stackSources.findIndex((s) => s.label === label);
      if (i >= 0) stackSources.splice(i, 1);
    });
    syncExportPrefix();
    paintTimeline();
    // Removing the last clip must return to the captured upright rest — do not
    // re-run normalizeCharacterPose (that re-tips Mixamo bind into the floor).
    if (stack.layers.length === 0) {
      playing = false;
      smoothedPose.clear();
      restoreStudioRest();
    }
  };
  refreshStack();

  const btnInPlace = $('btn-inplace');
  const btnTravel = $('btn-travel');
  const btnMirrorOff = $('btn-mirror-off');
  const btnMirrorOn = $('btn-mirror-on');
  const syncRootMotionButtons = () => {
    btnInPlace.classList.toggle('active', rootMotionMode === 'inplace');
    btnTravel.classList.toggle('active', rootMotionMode === 'travel');
    btnInPlace.setAttribute('aria-pressed', rootMotionMode === 'inplace' ? 'true' : 'false');
    btnTravel.setAttribute('aria-pressed', rootMotionMode === 'travel' ? 'true' : 'false');
  };
  const syncMirrorButtons = () => {
    btnMirrorOff.classList.toggle('active', !mirrorEnabled);
    btnMirrorOn.classList.toggle('active', mirrorEnabled);
    btnMirrorOff.setAttribute('aria-pressed', mirrorEnabled ? 'false' : 'true');
    btnMirrorOn.setAttribute('aria-pressed', mirrorEnabled ? 'true' : 'false');
  };

  const rebuildStackFromSources = (note?: string) => {
    while (stack.layers.length > 0) {
      stack.remove(stack.layers[0]!.id);
    }
    const hips =
      getBone(dorothy, 'Hips') ??
      getBone(dorothy, 'mixamorigHips') ??
      getBone(dorothy, 'mixamorig:Hips');
    for (const src of stackSources) {
      const mirrored = mirrorEnabled ? mirrorAnimationClip(src.travelClip) : src.travelClip;
      const clipped = applyRootMotionMode(mirrored, rootMotionMode, { hips });
      stack.add(flattenCubicSplineClip(clipped), src.label);
    }
    refreshStack();
    if (stack.layers.length > 0) {
      const motion = rootMotionMode === 'inplace' ? 'in place' : 'travel';
      const mirror = mirrorEnabled ? ' · mirrored' : '';
      beginExportPreview(
        note ?? `Preview · ${motion}${mirror} · ${stack.layers.map((l) => l.label).join(', ')}`,
      );
    }
  };

  const setRootMotionMode = (mode: RootMotionMode) => {
    if (mode === rootMotionMode) return;
    rootMotionMode = mode;
    syncRootMotionButtons();
    if (stackSources.length > 0) rebuildStackFromSources();
    else setStatus(mode === 'inplace' ? 'Root motion: in place' : 'Root motion: travel');
  };
  const setMirrorEnabled = (on: boolean) => {
    if (on === mirrorEnabled) return;
    mirrorEnabled = on;
    syncMirrorButtons();
    if (stackSources.length > 0) rebuildStackFromSources();
    else setStatus(on ? 'Mirror: on' : 'Mirror: off');
  };
  btnInPlace.addEventListener('click', () => setRootMotionMode('inplace'));
  btnTravel.addEventListener('click', () => setRootMotionMode('travel'));
  btnMirrorOff.addEventListener('click', () => setMirrorEnabled(false));
  btnMirrorOn.addEventListener('click', () => setMirrorEnabled(true));
  syncRootMotionButtons();
  syncMirrorButtons();

  const addAndPlay = (clip: THREE.AnimationClip, label: string, note: string) => {
    // Library picks replace the stack so clips don't blend into a walk mush.
    while (stack.layers.length > 0) {
      stack.remove(stack.layers[0]!.id);
    }
    stackSources.length = 0;
    stackSources.push({ label, travelClip: clip.clone() });
    rebuildStackFromSources(note);
  };

  const onPickClip = async (cat: CatalogClip) => {
    setStatus(`Loading ${cat.label}…`);
    try {
      // Same-bake characters (walking/running GLBs) may embed one clip — only
      // reuse it when the library row matches that file.
      const embedFile = character.url.split('/').pop() ?? '';
      const embedOk =
        character.rig === 'mixamo_char' &&
        cat.kind === 'glb' &&
        !!embedFile &&
        cat.id === embedFile &&
        gltf.animations.length > 0;
      if (embedOk) {
        const embed = gltf.animations[0]!;
        const clip = remapClipToDorothy(embed.clone(), {
          name: cat.label,
          targetSkinned: skinned,
          kind: detectRigKind(skinned),
        });
        addAndPlay(
          clip,
          cat.label,
          `Playing ${cat.label} from character GLB (${clip.tracks.length} tracks)`,
        );
        return;
      }
      const clip = await loadClipFromUrl(cat.url, cat.kind, cat.label, skinned);
      addAndPlay(
        clip,
        cat.label,
        `Playing ${cat.label} (${clip.tracks.length} tracks, ${clip.duration.toFixed(2)}s)`,
      );
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  renderClipLibrary(character.id, onPickClip);

  $('btn-play').addEventListener('click', () => {
    if (stack.layers.length === 0) {
      setStatus('Add a clip from the library first');
      return;
    }
    beginExportPreview();
  });
  $('btn-stop').addEventListener('click', () => {
    playing = false;
    resetExportPreviewClock();
    smoothedPose.clear();
    stackSources.length = 0;
    while (stack.layers.length > 0) {
      stack.remove(stack.layers[0]!.id);
    }
    refreshStack();
    restoreStudioRest();
    paintTimeline();
    setStatus('Stopped');
  });
  $('btn-skeleton').addEventListener('click', () => {
    if (!skeletonHelper) {
      skeletonHelper = new THREE.SkeletonHelper(dorothy);
      scene.add(skeletonHelper);
      setStatus('Skeleton on');
    } else {
      scene.remove(skeletonHelper);
      skeletonHelper = null;
      setStatus('Skeleton off');
    }
  });

  const camHeight = $('cam-height') as HTMLInputElement;
  const camHeightVal = $('cam-height-val');
  const sceneYaw = $('scene-yaw') as HTMLInputElement;
  const sceneYawVal = $('scene-yaw-val');
  const poseSmooth = $('pose-smooth') as HTMLInputElement;
  const poseSmoothVal = $('pose-smooth-val');
  const animSpeed = $('anim-speed') as HTMLInputElement;
  const animSpeedVal = $('anim-speed-val');
  const camSpan = Math.max(camBounds.topY - camBounds.groundY, 0.01);
  const lookYFromSlider = (pct: number) => camBounds.groundY + (pct / 100) * camSpan;
  const sliderFromLookY = (y: number) =>
    Math.round(((y - camBounds.groundY) / camSpan) * 100);

  camHeight.value = String(sliderFromLookY(defaultLookY));
  poseSmooth.addEventListener('input', () => {
    smoothAmount = Number(poseSmooth.value) / 100;
    poseSmoothVal.textContent = `${Math.round(smoothAmount * 100)}%`;
    if (smoothAmount <= 0) smoothedPose.clear();
  });
  poseSmoothVal.textContent = '0%';

  const setAnimSpeed = (pct: number) => {
    previewSpeed = Math.max(0.1, pct / 100);
    stack.mixer.timeScale = 1;
    animSpeedVal.textContent = `${previewSpeed.toFixed(2)}×`;
  };
  animSpeed.addEventListener('input', () => setAnimSpeed(Number(animSpeed.value)));
  setAnimSpeed(Number(animSpeed.value));

  const lightAmbient = $('light-ambient') as HTMLInputElement;
  const lightAmbientVal = $('light-ambient-val');
  const lightKey = $('light-key') as HTMLInputElement;
  const lightKeyVal = $('light-key-val');
  const lightRim = $('light-rim') as HTMLInputElement;
  const lightRimVal = $('light-rim-val');
  const lightExposure = $('light-exposure') as HTMLInputElement;
  const lightExposureVal = $('light-exposure-val');

  const applyLightingFromUi = () => {
    hemi.intensity = Number(lightAmbient.value) / 100;
    key.intensity = Number(lightKey.value) / 100;
    rim.intensity = Number(lightRim.value) / 100;
    renderer.toneMappingExposure = Number(lightExposure.value) / 100;
    lightAmbientVal.textContent = hemi.intensity.toFixed(2);
    lightKeyVal.textContent = key.intensity.toFixed(2);
    lightRimVal.textContent = rim.intensity.toFixed(2);
    lightExposureVal.textContent = `${renderer.toneMappingExposure.toFixed(2)}×`;
  };
  for (const el of [lightAmbient, lightKey, lightRim, lightExposure]) {
    el.addEventListener('input', applyLightingFromUi);
  }
  applyLightingFromUi();

  const updateHudCam = () => {
    const y = controls.target.y;
    const yawLabel = SCENE_YAW_DIRS[Number(sceneYaw.value) % 8] ?? '—';
    camHeightVal.textContent = `${y.toFixed(2)}m`;
    setHud(
      [
        'Dorothy 3D Studio',
        `${character.label} · scale×${scale.toFixed(3)} · look ${y.toFixed(2)}m · ${yawLabel}`,
        '8-way direction · yaw orbit · pan · zoom · cam height · skeleton',
      ].join('\n'),
    );
  };

  const syncSceneYawUi = (index: number) => {
    const i = ((Math.round(index) % 8) + 8) % 8;
    sceneYaw.value = String(i);
    sceneYawVal.textContent = SCENE_YAW_DIRS[i]!;
  };
  const applySceneYawFromSlider = () => {
    const i = Number(sceneYaw.value);
    setSceneYawNotch(camera, controls, i);
    syncSceneYawUi(i);
    syncExportPrefix();
    updateHudCam();
  };
  {
    const start = sceneYawIndexFromAzimuth(controls.getAzimuthalAngle());
    setSceneYawNotch(camera, controls, start);
    syncSceneYawUi(start);
    syncExportPrefix(true);
  }
  sceneYaw.addEventListener('input', applySceneYawFromSlider);
  // Free orbit → snap to nearest of 8 directions when interaction ends.
  controls.addEventListener('end', () => {
    const snapped = sceneYawIndexFromAzimuth(controls.getAzimuthalAngle());
    setSceneYawNotch(camera, controls, snapped);
    syncSceneYawUi(snapped);
    syncExportPrefix();
    updateHudCam();
  });

  camHeight.addEventListener('input', () => {
    setCameraCraneHeight(camera, controls, lookYFromSlider(Number(camHeight.value)));
    updateHudCam();
  });
  updateHudCam();

  const drop = $('dropzone');
  const fileInput = $('file-input') as HTMLInputElement;
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    setStatus(`Loading ${file.name}…`);
    try {
      const clip = await loadClipFromFile(file, skinned);
      addAndPlay(clip, file.name.replace(/\.[^.]+$/, ''), `Playing ${file.name}`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    fileInput.value = '';
  });
  ;['dragenter', 'dragover'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  });
  ;['dragleave', 'drop'].forEach((ev) => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    });
  });
  drop.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    setStatus(`Loading ${file.name}…`);
    try {
      const clip = await loadClipFromFile(file, skinned);
      addAndPlay(clip, file.name.replace(/\.[^.]+$/, ''), `Playing ${file.name}`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  $('btn-export').addEventListener('click', async () => {
    if (stack.layers.length === 0) {
      setStatus('Add a clip before export');
      return;
    }
    const ui = readExportPreviewUi();
    const size = Number(($('export-size') as HTMLSelectElement).value) || 512;
    // Export runs the configured package exactly once (loops × clip + pads) — never
    // resumes infinite preview playback afterward.
    const loops = Math.max(1, ui.loops);
    const { clipDur, totalFrames, totalDur } = packageTiming(ui.fps);
    setStatus(`Exporting · ${loops} loop${loops === 1 ? '' : 's'} · ${totalFrames}f…`);
    smoothedPose.clear();
    resetExportPreviewClock();
    playing = false;
    // Pause the live viewport loop so it can't re-draw helpers between export frames.
    renderer.setAnimationLoop(null);
    try {
      const hideDuringExport: THREE.Object3D[] = [studioEnv];
      if (skeletonHelper) hideDuringExport.push(skeletonHelper);
      await exportPngSequence({
        renderer,
        scene,
        camera,
        durationSec: stack.duration(),
        options: {
          loops,
          fps: ui.fps,
          size,
          filePrefix: ui.prefix,
          padBeforeSec: ui.padBeforeSec,
          padAfterSec: ui.padAfterSec,
          outline: {
            enabled: ui.outline.enabled,
            width: ui.outline.width,
            color: ui.outline.color,
          },
        },
        hideDuringExport,
        sampleAt: (t) => {
          sampleTimeline(t, clipDur, 1 / ui.fps);
        },
        onProgress: (frac, label) =>
          setStatus(
            `Export ${Math.round(frac * 100)}% · ${loops} loop${loops === 1 ? '' : 's'} · ${label}`,
          ),
      });
      // Hold the last exported frame; do not restart looping preview.
      playing = false;
      previewAnimTime = Math.max(0, totalDur - 1 / ui.fps);
      sampleTimeline(previewAnimTime, clipDur, 0);
      paintTimeline();
      setStatus(
        `Export complete · ${totalFrames} frames · ${loops} loop${loops === 1 ? '' : 's'} @ ${ui.fps}fps (preview stopped)`,
      );
    } catch (err) {
      playing = false;
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      renderer.setAnimationLoop(tick);
    }
  });

  const outlineToggle = $('export-outline') as HTMLInputElement;
  const outlineOpts = $('export-outline-opts');
  const syncOutlineOpts = () => {
    outlineOpts.hidden = !outlineToggle.checked;
  };
  outlineToggle.addEventListener('change', syncOutlineOpts);
  syncOutlineOpts();

  const paintOutlinePreview = (): void => {
    const ol = readExportPreviewUi().outline;
    if (!ol.enabled) {
      outlinePreview.classList.remove('is-on');
      renderer.domElement.style.opacity = '1';
      return;
    }

    const prevBg = scene.background;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const envWas = studioEnv.visible;
    const skelWas = skeletonHelper?.visible ?? false;

    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    studioEnv.visible = false;
    if (skeletonHelper) skeletonHelper.visible = false;
    renderer.render(scene, camera);
    studioEnv.visible = envWas;
    if (skeletonHelper) skeletonHelper.visible = skelWas;
    scene.background = prevBg;
    renderer.setClearColor(prevClear, prevAlpha);

    const src = renderer.domElement;
    const maxEdge = Math.max(src.width, src.height);
    const scale = Math.min(1, OUTLINE_PREVIEW_MAX_EDGE / Math.max(1, maxEdge));
    let outlined: HTMLCanvasElement;
    if (scale < 0.999) {
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.floor(src.width * scale));
      tmp.height = Math.max(1, Math.floor(src.height * scale));
      tmp.getContext('2d')!.drawImage(src, 0, 0, tmp.width, tmp.height);
      const width = Math.max(1, Math.round(ol.width * scale));
      outlined = applyAlphaOutline(tmp, { width, color: ol.color });
    } else {
      outlined = applyAlphaOutline(src, { width: ol.width, color: ol.color });
    }

    outlinePreviewCtx.setTransform(1, 0, 0, 1, 0, 0);
    outlinePreviewCtx.globalCompositeOperation = 'copy';
    outlinePreviewCtx.fillStyle = PREVIEW_BG;
    outlinePreviewCtx.fillRect(0, 0, outlinePreview.width, outlinePreview.height);
    outlinePreviewCtx.globalCompositeOperation = 'source-over';
    outlinePreviewCtx.drawImage(
      outlined,
      0,
      0,
      outlinePreview.width,
      outlinePreview.height,
    );
    outlinePreview.classList.add('is-on');
    // Keep WebGL canvas for OrbitControls hit-testing; hide its pixels.
    renderer.domElement.style.opacity = '0';
  };

  setStatus(`Ready · ${character.label} · ${builtInClips(character.id).length} clips`);

  const clock = new THREE.Clock();
  let statusAcc = 0;
  const tick = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (playing && stack.layers.length > 0) {
      const ui = readExportPreviewUi();
      const { loops, clipDur, coreDur, totalDur, totalFrames, frameDt } = packageTiming(ui.fps);

      // Same discrete timeline steps as export; Speed only scrubs wall-clock through that package.
      previewFrameAccum += dt * previewSpeed;
      let stepped = false;
      while (previewFrameAccum >= frameDt) {
        previewFrameAccum -= frameDt;
        previewAnimTime += frameDt;
        stepped = true;

        if (previewAnimTime >= totalDur - 1e-9) {
          previewAnimTime = 0;
          previewFrameAccum = 0;
          smoothedPose.clear();
          break;
        }
      }
      if (stepped) {
        sampleTimeline(previewAnimTime, clipDur, frameDt);
        paintTimeline();
      }

      statusAcc += dt;
      if (statusAcc >= 0.1) {
        statusAcc = 0;
        const frameIdx = Math.min(
          totalFrames - 1,
          Math.max(0, Math.floor(previewAnimTime * ui.fps + 1e-9)),
        );
        const coreT = previewAnimTime - padBeforeSec;
        const loopIdx =
          coreT < 0 ? 0 : Math.min(loops, Math.floor(coreT / clipDur) + 1);
        const head = stack.playhead();
        const clipNote = head ? ` · ${head.label}` : '';
        const smoothNote = smoothAmount > 0 ? ` · smooth ${Math.round(smoothAmount * 100)}%` : '';
        const speedNote = Math.abs(previewSpeed - 1) > 0.01 ? ` · ${previewSpeed.toFixed(2)}×` : '';
        const outlineNote = ui.outline.enabled ? ` · outline ${ui.outline.width}px` : '';
        const padNote =
          padBeforeSec > 0 || padAfterSec > 0
            ? ` · pad −${padBeforeSec.toFixed(2)}/+${padAfterSec.toFixed(2)}s`
            : '';
        const loopNote =
          coreT < 0
            ? ' · pre-roll'
            : coreT >= coreDur
              ? ' · post-roll'
              : ` · loop ${loopIdx}/${loops}`;
        setStatus(
          `Preview · ${ui.prefix}_${String(frameIdx).padStart(4, '0')}${clipNote}${loopNote} · ${frameIdx + 1}/${totalFrames}f @ ${ui.fps}fps${padNote}${speedNote}${outlineNote}${smoothNote}`,
        );
      }
    }
    controls.update();
    if (readExportPreviewUi().outline.enabled) {
      paintOutlinePreview();
    } else {
      outlinePreview.classList.remove('is-on');
      renderer.domElement.style.opacity = '1';
      renderer.render(scene, camera);
    }
  };
  renderer.setAnimationLoop(tick);
}

main().catch((err) => {
  setHud(`Failed:\n${err instanceof Error ? err.message : String(err)}`);
  console.error(err);
});
