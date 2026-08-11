/**
 * Dev preview: Dorothy_new.glb (and walk if the file includes a skinned clip).
 * Open via /fbx-preview.html
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DOROTHY_URL = './models/dorothy/Dorothy_new.glb';

const TARGET_HEIGHT_M = 1.7;
/** Orbit pitch locked: degrees down from horizontal. */
const CAMERA_DOWN_DEG = 28;
const _worldPos = new THREE.Vector3();

const hud = document.getElementById('hud')!;

function setHud(text: string): void {
  hud.textContent = text;
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.SkinnedMesh).isSkinnedMesh) {
      found = obj as THREE.SkinnedMesh;
    }
  });
  return found;
}

function findAnyMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.Mesh).isMesh) found = obj as THREE.Mesh;
  });
  return found;
}

function getBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (!found && (obj as THREE.Bone).isBone && obj.name === name) {
      found = obj as THREE.Bone;
    }
  });
  return found;
}

function skeletonWorldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let any = false;
  root.traverse((obj) => {
    if (!(obj as THREE.Bone).isBone) return;
    obj.getWorldPosition(_worldPos);
    box.expandByPoint(_worldPos);
    any = true;
  });
  if (!any || box.isEmpty()) {
    box.setFromObject(root);
  }
  return box;
}

function normalizeCharacterPose(root: THREE.Object3D): { height: number; scale: number } {
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);

  // Prefer foot→head bones; fall back to mesh AABB. Fix Z-up assets.
  const head =
    getBone(root, 'Head') ??
    getBone(root, 'HeadTop_End') ??
    getBone(root, 'mixamorigHead') ??
    getBone(root, 'mixamorig:Head');
  const foot =
    getBone(root, 'L_Foot') ??
    getBone(root, 'R_Foot') ??
    getBone(root, 'mixamorigLeftFoot') ??
    getBone(root, 'mixamorig:LeftFoot') ??
    getBone(root, 'Hip') ?? getBone(root, 'Pelvis');

  let up = new THREE.Vector3();
  if (head && foot) {
    up.copy(head.getWorldPosition(new THREE.Vector3())).sub(foot.getWorldPosition(new THREE.Vector3()));
  } else {
    const size = skeletonWorldBox(root).getSize(new THREE.Vector3());
    up.set(
      size.x >= size.y && size.x >= size.z ? size.x : 0,
      size.y >= size.x && size.y >= size.z ? size.y : 0,
      size.z >= size.x && size.z >= size.y ? size.z : 0,
    );
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

  const scale = TARGET_HEIGHT_M / height;
  const safeScale = Math.min(Math.max(scale, 0.001), 20);
  root.scale.setScalar(safeScale);
  root.updateMatrixWorld(true);

  const grounded = skeletonWorldBox(root);
  root.position.y -= grounded.min.y;
  root.position.x -= (grounded.min.x + grounded.max.x) * 0.5;
  root.position.z -= (grounded.min.z + grounded.max.z) * 0.5;
  root.updateMatrixWorld(true);

  return { height: TARGET_HEIGHT_M, scale: root.scale.x };
}

function fitCameraToSkeleton(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  root: THREE.Object3D,
): void {
  const box = skeletonWorldBox(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, 0.5);
  const width = Math.max(size.x, size.z, 0.5);
  const fitH = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const fitW = width / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  const dist = Math.max(fitH, fitW) * 1.35;

  const pitch = THREE.MathUtils.degToRad(CAMERA_DOWN_DEG);
  camera.near = Math.max(0.05, dist / 100);
  camera.far = Math.max(100, dist * 20);
  camera.updateProjectionMatrix();
  camera.position.set(
    center.x,
    center.y + Math.sin(pitch) * dist,
    center.z + Math.cos(pitch) * dist,
  );
  controls.target.copy(center);
  controls.minDistance = dist * 0.25;
  controls.maxDistance = dist * 6;
  const polar = Math.PI / 2 - pitch;
  controls.minPolarAngle = polar;
  controls.maxPolarAngle = polar;
  controls.update();
}

function sanitizeWalkClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const keepPosition = new Set(['Hip', 'Pelvis', 'Hips', 'mixamorigHips', 'mixamorig:Hips']);
  const tracks = clip.tracks.filter((track) => {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) return false;
    const bone = track.name.slice(0, dot).split('/').pop() ?? track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    if (/^(Root|Hip)$/i.test(bone)) return false;
    if (prop === 'scale') return false;
    if (prop === 'position') return keepPosition.has(bone) || /hips/i.test(bone);
    return prop === 'quaternion';
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

async function main(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const lockedPolar = Math.PI / 2 - THREE.MathUtils.degToRad(CAMERA_DOWN_DEG);
  controls.minPolarAngle = lockedPolar;
  controls.maxPolarAngle = lockedPolar;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
  const key = new THREE.DirectionalLight(0xfff2e0, 1.35);
  key.position.set(2.5, 4, 3);
  scene.add(key);

  const grid = new THREE.GridHelper(4, 16, 0x555566, 0x2a2a33);
  scene.add(grid);

  setHud('Loading Dorothy_new.glb…');
  const gltf = await new GLTFLoader().loadAsync(DOROTHY_URL);
  const dorothy = gltf.scene;
  scene.add(dorothy);

  const targetMesh = findSkinnedMesh(dorothy) ?? findAnyMesh(dorothy);
  if (!targetMesh) {
    setHud('No mesh in Dorothy_new.glb');
    return;
  }

  const skinned = findSkinnedMesh(dorothy);
  let boneCount = 0;
  dorothy.traverse((obj) => {
    if ((obj as THREE.Bone).isBone) boneCount += 1;
  });

  dorothy.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && 'side' in mat) mat.side = THREE.FrontSide;
    }
  });

  const { scale } = normalizeCharacterPose(dorothy);
  fitCameraToSkeleton(camera, controls, dorothy);

  const rawClip =
    gltf.animations.find((c) => /traversal_walk|walk/i.test(c.name)) ??
    gltf.animations.find((c) => !/mixamo/i.test(c.name)) ??
    gltf.animations[0] ??
    null;

  const walkClip = rawClip && skinned ? sanitizeWalkClip(rawClip) : null;
  if (walkClip) walkClip.name = rawClip!.name || 'walk';

  let skeletonHelper: THREE.SkeletonHelper | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let walkAction: THREE.AnimationAction | null = null;

  setHud(
    [
      'Dorothy_new.glb',
      `scale×${scale.toFixed(3)} · height≈${TARGET_HEIGHT_M}m`,
      skinned
        ? `Skinned · ${boneCount} bones`
        : 'Static mesh only — no armature/skin in this file',
      walkClip
        ? `Walk ready (${walkClip.tracks.length} tracks, ${walkClip.duration.toFixed(2)}s)`
        : skinned
          ? 'No walk clip embedded'
          : 'Space walk needs a Mixamo download with skin + animation',
      '',
      'Drag orbit (yaw) · Scroll zoom · Right-drag pan · Space walk · H skeleton',
    ].join('\n'),
  );

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyH') {
      ev.preventDefault();
      if (!skinned) {
        setHud('No skeleton in Dorothy_new.glb (static mesh).');
        return;
      }
      if (!skeletonHelper) {
        skeletonHelper = new THREE.SkeletonHelper(dorothy);
        scene.add(skeletonHelper);
      } else {
        scene.remove(skeletonHelper);
        skeletonHelper = null;
      }
      return;
    }

    if (ev.code !== 'Space') return;
    ev.preventDefault();
    if (!walkClip || !skinned) {
      setHud(
        [
          'Dorothy_new.glb has no skinned walk.',
          'In Mixamo: auto-rig → pick Traversal_walk → download as GLB.',
          'Then replace models/dorothy/Dorothy_new.glb with that file.',
        ].join('\n'),
      );
      return;
    }

    if (!mixer) {
      mixer = new THREE.AnimationMixer(dorothy);
      walkAction = mixer.clipAction(walkClip);
    }
    if (!walkAction) return;

    if (walkAction.isRunning()) {
      walkAction.stop();
      skinned.skeleton.pose();
      normalizeCharacterPose(dorothy);
      fitCameraToSkeleton(camera, controls, dorothy);
      setHud(['Dorothy rest pose', 'Walk stopped.', '', 'Space walk · H skeleton'].join('\n'));
    } else {
      walkAction.reset().play();
      setHud(
        ['Dorothy walk', `Playing ${walkClip.name} (${walkClip.duration.toFixed(2)}s)`, 'Space: rest'].join(
          '\n',
        ),
      );
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    mixer?.update(dt);
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  setHud(`Failed to load preview:\n${msg}`);
  console.error(err);
});
