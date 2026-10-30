/**
 * Browser-side 3/4 render with the same camera rule for every asset, so renders compare.
 * Markers: RGB axes at the pivot, a yellow floor arrow toward −Z (engine forward),
 * a floor grid, and an orange 1.8 m figure beside the asset when it fits the frame.
 */

import * as THREE from 'three';

import type { Measurement, RenderInfo, RenderOptions } from './types.js';

const FOV_DEG = 30;
/** Camera direction from the target: from the −Z side, offset toward +X, looking down. */
const VIEW_DIR = new THREE.Vector3(1, 0.75, -1).normalize();
const HUMAN_HEIGHT = 1.8;

export function render(root: THREE.Object3D, m: Measurement, opts: RenderOptions): RenderInfo {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(opts.size, opts.size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c9ced6');
  scene.add(root);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });

  const [sx, sy, sz] = m.size;
  const maxDim = Math.max(sx, sy, sz);
  const framed = new THREE.Box3(new THREE.Vector3(...m.min), new THREE.Vector3(...m.max));

  // Scale reference: shown only when the asset is at least about half a person in size.
  const humanShown = maxDim >= HUMAN_HEIGHT * 0.33;
  if (humanShown) {
    const human = makeHuman();
    // Off the +X/+Z corner: beside the asset as seen from the camera, so it never hides it.
    human.position.set(m.max[0] + 0.4, 0, m.max[2] + 0.4);
    scene.add(human);
    framed.expandByObject(human);
  }

  // Engine forward marker on the floor, in front of the asset.
  const arrowLen = Math.max(0.3, Math.max(sx, sz) * 0.3);
  const arrowStart = new THREE.Vector3(0, 0.01, m.min[2] - Math.max(0.1, maxDim * 0.05));
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), arrowStart, arrowLen, 0xf2c200, arrowLen * 0.3, arrowLen * 0.18);
  scene.add(arrow);
  framed.expandByPoint(arrowStart.clone().add(new THREE.Vector3(0, 0, -arrowLen)));

  // Pivot axes, drawn through the model.
  const axisLen = Math.max(0.15, maxDim * 0.2);
  const axes = new THREE.AxesHelper(axisLen);
  const axesMat = axes.material as THREE.LineBasicMaterial;
  axesMat.depthTest = false;
  axes.renderOrder = 999;
  scene.add(axes);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(axisLen * 0.06, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }),
  );
  dot.renderOrder = 999;
  scene.add(dot);

  // Floor: grid lines plus a shadow catcher at y = 0. Neither writes depth, so geometry below
  // the floor stays visible.
  const gridCell = niceStep(Math.max(sx, sz) / 6);
  const span = Math.ceil((Math.max(sx, sz) * 1.8 + 2 * gridCell) / gridCell) * gridCell;
  const divisions = Math.max(2, Math.round(span / gridCell));
  const grid = new THREE.GridHelper(divisions * gridCell, divisions, 0x6b717b, 0x9aa0a8);
  grid.position.set(snap(m.center[0], gridCell), 0, snap(m.center[2], gridCell));
  (grid.material as THREE.Material).depthWrite = false;
  scene.add(grid);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 2, span * 2),
    new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(grid.position);
  floor.receiveShadow = true;
  scene.add(floor);

  // Lights: soft sky fill plus a key from the front-left, shadow frustum fitted to the asset.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  const target = framed.getCenter(new THREE.Vector3());
  const radius = framed.getBoundingSphere(new THREE.Sphere()).radius;
  key.position.copy(target).add(new THREE.Vector3(-0.6, 1.2, -0.8).normalize().multiplyScalar(radius * 3));
  key.target.position.copy(target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -radius * 1.5; sc.right = radius * 1.5; sc.top = radius * 1.5; sc.bottom = -radius * 1.5;
  sc.near = 0.01; sc.far = radius * 6;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = radius * 0.002;
  scene.add(key, key.target);

  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, Math.max(0.01, radius * 0.01), radius * 20);
  fitCamera(camera, framed, target, radius);

  renderer.render(scene, camera);
  const jpegDataUrl = canvas.toDataURL('image/jpeg', opts.quality);
  renderer.dispose();
  renderer.forceContextLoss();

  return {
    jpegDataUrl,
    gridCell,
    humanShown,
    cameraElevationDeg: THREE.MathUtils.radToDeg(Math.asin(VIEW_DIR.y)),
    fovDeg: FOV_DEG,
  };
}

/**
 * Frames the box corners tightly: start from the bounding sphere distance, then re-aim at the
 * projected centre and move in or out until the widest corner sits at the frame margin.
 */
function fitCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3, target: THREE.Vector3, radius: number): void {
  const MARGIN = 0.9;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  const aim = target.clone();
  let dist = radius / Math.sin(THREE.MathUtils.degToRad(FOV_DEG / 2));
  const ndc = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    camera.position.copy(aim).addScaledVector(VIEW_DIR, dist);
    camera.lookAt(aim);
    camera.updateMatrixWorld();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of corners) {
      ndc.copy(c).project(camera);
      minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x);
      minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y);
    }
    // Shift the aim point toward the projected centre, then scale distance to the widest extent.
    const centre = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0.5).unproject(camera);
    const ray = centre.sub(camera.position).normalize();
    const aimDist = camera.position.distanceTo(aim);
    aim.copy(camera.position).addScaledVector(ray, aimDist);
    const extent = Math.max(maxX - minX, maxY - minY) / 2;
    dist *= extent / MARGIN;
  }
  camera.position.copy(aim).addScaledVector(VIEW_DIR, dist);
  camera.lookAt(aim);
}

function makeHuman(): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ color: 0xe0703a, roughness: 0.7 });
  const group = new THREE.Group();
  const bodyRadius = 0.18;
  const bodyLength = 1.15;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(bodyRadius, bodyLength, 4, 12), mat);
  body.position.y = bodyRadius + bodyLength / 2;
  const headRadius = 0.13;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 16, 12), mat);
  head.position.y = HUMAN_HEIGHT - headRadius;
  for (const part of [body, head]) {
    part.castShadow = true;
    group.add(part);
  }
  return group;
}

/** 1, 2 or 5 times a power of ten, at least the given step. */
function niceStep(raw: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-4))));
  for (const f of [1, 2, 5, 10]) {
    if (f * exp >= raw) return f * exp;
  }
  return 10 * exp;
}

function snap(v: number, step: number): number {
  return Math.round(v / step) * step;
}
