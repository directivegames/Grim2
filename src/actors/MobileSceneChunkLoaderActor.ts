import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { isMobileDevice } from '../utils/mobile-device.js';
import { BEDROOM_CHUNK, ENVIRONMENT_CHUNKS, type GlbPlacement } from './mobile-scene-chunks.js';

const HIDDEN_LOAD_Y = -1000;

/** Delay between individual placements so unique-model decodes don't spike at once. */
const PLACEMENT_DELAY_MS = 24;
/** Extra breather between chunks. */
const CHUNK_DELAY_MS = 40;

/** Town combat area is authored around the origin; the bedroom diorama sits here. */
const BEDROOM_ANCHOR = new THREE.Vector3(188.6, 3, -51);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

@ENGINE.GameClass()
export class MobileSceneChunkLoaderActor extends ENGINE.Actor {
  private static _instance: MobileSceneChunkLoaderActor | null = null;

  private _introPromise: Promise<void> | null = null;
  private _backgroundPromise: Promise<void> | null = null;
  private _lightingReady = false;
  private _simpleGroundReady = false;

  public override initialize(options?: ENGINE.ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    root.position.set(0, HIDDEN_LOAD_Y, 0);
    super.initialize({ ...options, rootComponent: root });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    MobileSceneChunkLoaderActor._instance = this;
  }

  protected override doEndPlay(): void {
    if (MobileSceneChunkLoaderActor._instance === this) {
      MobileSceneChunkLoaderActor._instance = null;
    }
    super.doEndPlay();
  }

  public static ensureExists(world: ENGINE.World): MobileSceneChunkLoaderActor | null {
    if (!isMobileDevice()) {
      return null;
    }

    const existing = MobileSceneChunkLoaderActor._instance
      ?? world.getActors().find((actor): actor is MobileSceneChunkLoaderActor =>
        actor instanceof MobileSceneChunkLoaderActor);

    if (existing) {
      return existing;
    }

    const actor = MobileSceneChunkLoaderActor.create({ name: 'MobileSceneChunkLoader' });
    world.addActor(actor);
    return actor;
  }

  /** Loads the bedroom diorama + lighting first so the intro camera has something to frame. */
  public loadIntroBedroom(): Promise<void> {
    this._introPromise ??= this._loadIntroBedroom();
    return this._introPromise;
  }

  /** Streams the rest of the town in nearest-to-origin order. */
  public startBackgroundLoad(): Promise<void> {
    this._backgroundPromise ??= this._loadBackgroundChunks();
    return this._backgroundPromise;
  }

  private async _loadIntroBedroom(): Promise<void> {
    this._ensureLighting();
    this._ensureSimpleGround();
    await this._loadGlbChunk(BEDROOM_CHUNK);
  }

  private async _loadBackgroundChunks(): Promise<void> {
    await this.loadIntroBedroom();

    for (const chunk of ENVIRONMENT_CHUNKS) {
      await delay(CHUNK_DELAY_MS);
      await this._loadGlbChunk(chunk);
    }
  }

  private _ensureLighting(): void {
    if (this._lightingReady) {
      return;
    }
    this._lightingReady = true;

    const world = this.getWorld();
    if (!world) {
      return;
    }

    world.addActor(ENGINE.Actor.create({
      name: 'MobileAmbientLight',
      rootComponent: ENGINE.AmbientLightComponent.create({
        color: new THREE.Color(0.42, 0.36, 0.62),
        intensity: 4.5,
      }),
    }));

    // Town fill (gameplay around origin).
    world.addActor(ENGINE.Actor.create({
      name: 'MobileTownLight',
      rootComponent: ENGINE.PointLightComponent.create({
        color: new THREE.Color(0.78, 0.6, 1),
        intensity: 60,
        distance: 120,
        position: new THREE.Vector3(0, 14, 0),
      }),
    }));

    // Bedroom diorama fill (intro camera target).
    world.addActor(ENGINE.Actor.create({
      name: 'MobileBedroomLight',
      rootComponent: ENGINE.PointLightComponent.create({
        color: new THREE.Color(0.85, 0.62, 1),
        intensity: 28,
        distance: 40,
        position: BEDROOM_ANCHOR.clone(),
      }),
    }));
  }

  private _ensureSimpleGround(): void {
    if (this._simpleGroundReady) {
      return;
    }
    this._simpleGroundReady = true;

    const world = this.getWorld();
    if (!world) {
      return;
    }

    // Replace the placeholder ground from mobile-empty.genesys-scene with a dark
    // atmospheric ground that spans both the town (origin) and bedroom (~188,-51).
    const placeholder = world.getActors().find(actor => actor.name === 'MobileGround');
    if (placeholder) {
      world.removeActor(placeholder);
    }

    const ground = ENGINE.Actor.create({
      name: 'MobileVisualGround',
      rootComponent: ENGINE.MeshComponent.create({
        geometry: new THREE.BoxGeometry(440, 0.1, 440),
        material: new THREE.MeshStandardMaterial({
          color: new THREE.Color(0.05, 0.04, 0.07),
          roughness: 1,
        }),
        position: new THREE.Vector3(40, -1, -20),
        physicsOptions: { enabled: false },
        castShadow: false,
        receiveShadow: false,
      }),
    });
    world.addActor(ground);
  }

  private async _loadGlbChunk(chunk: readonly GlbPlacement[]): Promise<void> {
    for (const placement of chunk) {
      await this._spawnGlbPlacement(placement);
      await delay(PLACEMENT_DELAY_MS);
    }
  }

  private async _spawnGlbPlacement(placement: GlbPlacement): Promise<void> {
    const world = this.getWorld();
    if (!world || world.getActors().some(actor => actor.name === placement.name)) {
      return;
    }

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: placement.modelUrl,
      material: placement.material,
      position: placement.position.clone(),
      scale: placement.scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      rotation: placement.rotation?.clone() ?? new THREE.Euler(),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    const actor = ENGINE.Actor.create({
      name: placement.name,
      rootComponent: visual,
    });
    world.addActor(actor);

    if (!visual.isModelLoaded()) {
      await visual.waitForLoad().catch((error) => {
        console.warn(`[MobileSceneChunkLoader] Failed to load ${placement.name}`, error);
      });
    }
  }
}
