/**
 * Mobile-only startup reductions (menu load). Desktop paths are unchanged.
 */
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { ScenicFogActor } from '../actors/ScenicFogActor.js';
import { CloudShadowActor } from '../cloudShadow/CloudShadowActor.js';
import { DEFAULT_CLOUD_SHADOW_MAP } from '../cloudShadow/CloudShadowState.js';
import { isMobileDevice } from './mobile-device.js';

let mobileNavReady = false;
let mobileNavPromise: Promise<void> | null = null;
let mobileVisualsSpawned = false;

/** Lighter GPU path while the title menu is up (before first stable frame). */
export function applyMobileMenuRenderingProfile(world: ENGINE.World): void {
  if (!isMobileDevice()) {
    return;
  }
  world.postProcessManager.setPostProcessingEnabled(false);
}

/** Restore post-processing when leaving the menu for gameplay. */
export function restoreMobileGameplayRenderingProfile(world: ENGINE.World): void {
  if (!isMobileDevice()) {
    return;
  }
  world.postProcessManager.setPostProcessingEnabled(true);
}

export function ensureMobileNavigationMesh(world: ENGINE.World): void {
  if (!isMobileDevice() || mobileNavReady) {
    return;
  }
  if (!mobileNavPromise) {
    console.info('[Grim] Building navigation mesh (mobile deferred)…');
    mobileNavPromise = world
      .createNavigationMeshFromScene()
      .then(() => {
        mobileNavReady = true;
        console.info('[Grim] Mobile navigation mesh ready');
      })
      .catch((err: unknown) => {
        console.warn('[Grim] Mobile navigation mesh failed', err);
        mobileNavPromise = null;
      });
  }
}

async function awaitMobileNavigationMesh(world: ENGINE.World): Promise<void> {
  ensureMobileNavigationMesh(world);
  if (mobileNavPromise) {
    await mobileNavPromise;
  }
}

/** Fog + cloud shadows deferred from menu boot on mobile. */
export function ensureMobileGameplayVisuals(world: ENGINE.World): void {
  if (!isMobileDevice() || mobileVisualsSpawned) {
    return;
  }
  mobileVisualsSpawned = true;

  world.addActor(CloudShadowActor.create({
    name: 'CloudShadows',
    cloudMapUrl: DEFAULT_CLOUD_SHADOW_MAP,
  }));

  const placements: Array<{ position: THREE.Vector3; scale: number }> = [
    { position: new THREE.Vector3(38.9, 0.15, -1.2), scale: 4 },
    { position: new THREE.Vector3(3.9, 0.1, -1.4), scale: 3.5 },
    { position: new THREE.Vector3(-8.9, 0.12, 17.3), scale: 4 },
  ];

  for (const { position, scale } of placements) {
    const fog = ScenicFogActor.create();
    fog.rootComponent.position.copy(position);
    fog.rootComponent.scale.set(scale, 1, scale);
    world.addActor(fog);
  }
}

/** Nav mesh + visuals + post-processing before intro / mission (mobile only). */
export async function prepareMobileForGameplay(world: ENGINE.World): Promise<void> {
  if (!isMobileDevice()) {
    return;
  }
  restoreMobileGameplayRenderingProfile(world);
  await awaitMobileNavigationMesh(world);
  ensureMobileGameplayVisuals(world);
}
