/**
 * Staged WebGPU/TSL cloud-shadow isolation test.
 *
 * Disable scene patching and run one stage at a time. Increment TEST_STAGE after
 * each stage renders without crashing.
 *
 * Stage 1: red constant
 * Stage 2: materialColor
 * Stage 3: materialColor × 0.5
 * Stage 4: positionWorld debug
 * Stage 5: cloud texture (mesh UV)
 * Stage 6: world-space scrolling cloud sample
 * Stage 7: full shadow multiplier (grayscale)
 * Stage 8: base color × multiplier (final)
 */
import * as THREE from 'three';
import {
  color,
  float,
  materialColor,
  positionWorld,
  smoothstep,
  texture,
  time,
  uv,
  vec2,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

/** Increment by 1 after each successful stage (1–8). */
export const CLOUD_SHADOW_TSL_TEST_STAGE = 1;

const TEST_PLANE_NAME = 'CloudShadowTSLTestPlane';

export type CloudShadowTslTestOptions = {
  /** World position for the test plane. */
  position?: THREE.Vector3;
  /** Plane half-size (geometry is 2× this). */
  size?: number;
};

function buildTestColorNode(
  stage: number,
  cloudTexture: THREE.Texture,
): unknown {
  switch (stage) {
    case 1:
      // TEST 1 — constant red. If this crashes, NodeMaterial/TSL path is broken.
      return color(new THREE.Color(1, 0, 0));

    case 2:
      // TEST 2 — built-in material color node.
      return materialColor;

    case 3:
      // TEST 3 — basic TSL multiply on color.
       
      return (materialColor as any).mul(float(0.5));

    case 4:
      // TEST 4 — world-space accessor (should show a gradient, not flat red).
       
      return (positionWorld.xz as any).mul(float(0.01));

    case 5:
      // TEST 5 — cloud texture sampled with mesh UV.
      return texture(cloudTexture, uv()).r;

    case 6: {
      // TEST 6 — world-space scrolling cloud sample.
      const t = time.mul(float(0.1));
      const uv1 = positionWorld.xz.mul(float(0.01)).add(vec2(1, 0.35).mul(t));
      return texture(cloudTexture, uv1).r;
    }

    case 7: {
      // TEST 7 — full shadow multiplier graph (grayscale pattern only).
      const t = time.mul(float(0.1));
      const uv1 = positionWorld.xz.mul(float(0.01)).add(vec2(1, 0.35).mul(t));
      const uv2 = positionWorld.xz
        .mul(float(0.023))
        .sub(vec2(0.35, 1).mul(t.mul(float(0.45))));
      const c1 = texture(cloudTexture, uv1).r;
      const c2 = texture(cloudTexture, uv2).r;
      const mask = smoothstep(0.35, 0.75, c1.mul(float(0.7)).add(c2.mul(float(0.3))));
      return float(1.0).sub(mask.mul(float(0.8)));
    }

    case 8: {
      // TEST 8 — final: base color × moving cloud shadow.
      const t = time.mul(float(0.1));
      const uv1 = positionWorld.xz.mul(float(0.01)).add(vec2(1, 0.35).mul(t));
      const uv2 = positionWorld.xz
        .mul(float(0.023))
        .sub(vec2(0.35, 1).mul(t.mul(float(0.45))));
      const c1 = texture(cloudTexture, uv1).r;
      const c2 = texture(cloudTexture, uv2).r;
      const mask = smoothstep(0.35, 0.75, c1.mul(float(0.7)).add(c2.mul(float(0.3))));
      const multiplier = float(1.0).sub(mask.mul(float(0.8)));
       
      return (color(new THREE.Color(1, 1, 1)) as any).mul(multiplier);
    }

    default:
      console.warn(`[CloudShadowTest] Unknown stage ${stage}, using TEST 1`);
      return color(new THREE.Color(1, 0, 0));
  }
}

/**
 * Spawn a horizontal test plane with a fresh MeshBasicNodeMaterial at the
 * given TSL test stage. Safe to call once at startup.
 */
export function spawnCloudShadowTslTest(
  scene: THREE.Scene,
  cloudTexture: THREE.Texture,
  options: CloudShadowTslTestOptions = {},
): THREE.Mesh {
  // Remove previous test plane if re-spawned.
  const existing = scene.getObjectByName(TEST_PLANE_NAME);
  if (existing) {
    existing.removeFromParent();
  }

  cloudTexture.wrapS = THREE.RepeatWrapping;
  cloudTexture.wrapT = THREE.RepeatWrapping;
  cloudTexture.colorSpace = THREE.NoColorSpace;
  cloudTexture.needsUpdate = true;

  const stage = CLOUD_SHADOW_TSL_TEST_STAGE;
  const mat = new MeshBasicNodeMaterial();
  mat.color = new THREE.Color(1, 1, 1);

  const colorNode = buildTestColorNode(stage, cloudTexture);
   
  (mat as any).colorNode = colorNode;

  const size = options.size ?? 20;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1), mat);
  mesh.name = TEST_PLANE_NAME;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(options.position ?? new THREE.Vector3(0, 0.05, 0));
  mesh.renderOrder = 999;

  scene.add(mesh);
  mat.needsUpdate = true;

  console.log(
    `[CloudShadowTest] Stage ${stage}/8 — spawned "${TEST_PLANE_NAME}" at`,
    mesh.position.toArray(),
    stage >= 5 ? '(uses cloud texture)' : '(no texture yet)',
  );
  console.log('[CloudShadowTest] Increment CLOUD_SHADOW_TSL_TEST_STAGE after this stage renders OK');

  return mesh;
}
