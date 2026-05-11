/**
 * WeaponSwingArcComponent - Shows a 180° weapon attack arc on the floor.
 *
 * A faint semi-circular wedge that tracks the mouse cursor position,
 * giving visual feedback on where the weapon will hit when attacking.
 *
 * Implementation follows the same pattern as BlobShadowComponent:
 * - Extends ENGINE.MeshComponent directly
 * - Flat on floor via rotation in initialize()
 * - Updates via tickPrePhysics for continuous mouse tracking
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { SceneComponentOptions } from '@gnsx/genesys.js';

/** Arc radius - slightly larger than typical melee range for visibility. */
const ARC_RADIUS = 1.3;

/** Arc angle - 180° half-circle showing the weapon swing area. */
const ARC_ANGLE = Math.PI;

/** Segments for smooth arc edges. */
const ARC_SEGMENTS = 32;

/** Arc material opacity - faint enough to not clutter, visible enough to guide. */
const ARC_OPACITY = 0.15;

/** Y offset from ground to avoid z-fighting. */
const ARC_Y_OFFSET = 0.02;

/**
 * Creates a custom half-circle (180°) sector geometry.
 * The arc spans from -90° to +90° around +Z (forward).
 */
function createHalfCircleGeometry(radius: number, segments: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];

  // Center point at origin
  vertices.push(0, 0, 0);

  // Arc edge points from -90° to +90° (left to right of forward)
  const halfAngle = Math.PI / 2;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = -halfAngle + t * ARC_ANGLE; // -90° to +90°
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    vertices.push(x, 0, z);
  }

  // Triangles: center (0) + each consecutive pair of edge points
  for (let i = 0; i < segments; i++) {
    indices.push(0, i + 1, i + 2);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

const SHARED_ARC_GEOMETRY = createHalfCircleGeometry(ARC_RADIUS, ARC_SEGMENTS);

@ENGINE.GameClass()
export class WeaponSwingArcComponent extends ENGINE.MeshComponent {
  public override initialize(options?: SceneComponentOptions): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x88ccff, // Light blue, subtle
      transparent: true,
      opacity: ARC_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    super.initialize({
      ...options,
      geometry: SHARED_ARC_GEOMETRY,
      material,
      // No X rotation needed - geometry is already flat on XZ plane
      position: new THREE.Vector3(0, ARC_Y_OFFSET, 0),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });
  }

  /**
   * Update the arc rotation to match the aim direction.
   * Call this from the pawn's tickPrePhysics to track mouse position.
   * @param yaw - The aim angle in radians (0 = forward/-Z)
   */
  public setAimDirection(yaw: number): void {
    // Rotate around Y to face the aim direction
    // Explicitly set (0, yaw, 0) to ensure only Y rotation
    this.rotation.set(0, yaw, 0);
  }

  /**
   * Set arc visibility.
   */
  public setArcVisible(visible: boolean): void {
    this.visible = visible;
  }

  /**
   * Change arc color for different states (e.g., attack charging, ready, etc.)
   */
  public setArcColor(color: THREE.Color): void {
    if (this.material instanceof THREE.MeshBasicMaterial) {
      this.material.color.copy(color);
    }
  }
}
