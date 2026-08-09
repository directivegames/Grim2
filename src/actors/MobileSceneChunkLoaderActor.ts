import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { isMobileDevice } from '../utils/mobile-device.js';
import { downscaleModelTextures } from '../utils/downscale-model-textures.js';
import { SpawnBlockerActor } from './SpawnBlockerActor.js';
import { InnocentSpawnPointActor } from './InnocentSpawnPointActor.js';
import {
  BEDROOM_CHUNK,
  ENVIRONMENT_CHUNKS,
  GROUND_TILES,
  SPAWN_BLOCKERS,
  INNOCENT_PROP,
  INNOCENT_SPAWN_POINTS,
  type GlbPlacement,
  type GroundTilePlacement,
  type SpawnBlockerPlacement,
  type SpawnPointPlacement,
} from './mobile-scene-chunks.js';

const HIDDEN_LOAD_Y = -1000;

/** Delay between individual placements so unique-model decodes don't spike at once. */
const PLACEMENT_DELAY_MS = 24;
/** Extra breather between chunks. */
const CHUNK_DELAY_MS = 40;

/**
 * Max texture dimension on mobile. GLB-embedded textures are decoded at full size
 * and uploaded to the GPU; capping them keeps the resident footprint under
 * mobile Safari's per-tab memory limit. Bump up if the bedroom looks too soft.
 */
const MOBILE_TEXTURE_MAX_DIM = 512;

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
  private _groundReady = false;

  public override initialize(options?: ENGINE.ActorOptions): void {
    const root = ENGINE.SceneComponent.create({ name: 'Root' });
    root.position.set(0, HIDDEN_LOAD_Y, 0);
    super.initialize({ ...options, rootComponent: root });
  }

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }MobileSceneChunkLoaderActor._instance = this;
  
    return true;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    if (MobileSceneChunkLoaderActor._instance === this) {
      MobileSceneChunkLoaderActor._instance = null;
    }
    return true;
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

  /** Returns the in-flight background load promise, or a resolved promise if not yet started. */
  public waitForBackgroundLoad(): Promise<void> {
    return this._backgroundPromise ?? Promise.resolve();
  }

  private async _loadIntroBedroom(): Promise<void> {
    this._ensureLighting();
    this._ensureGroundSetup();
    await this._loadGlbChunk(BEDROOM_CHUNK);
  }

  private async _loadBackgroundChunks(): Promise<void> {
    await this.loadIntroBedroom();

    // Floor first so the player has visible grass/road as soon as gameplay starts.
    await this._loadGroundTiles();
    this._spawnSpawnBlockers();

    // Innocent markers + prop early so the mission can reveal innocents at their
    // authored places (InnocentHandler binds to the "innocent" actor at mission start).
    this._spawnInnocentSpawnPoints();
    await this._spawnInnocentProp();

    for (const chunk of ENVIRONMENT_CHUNKS) {
      await delay(CHUNK_DELAY_MS);
      await this._loadGlbChunk(chunk);
    }
  }

  private _spawnInnocentSpawnPoints(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    for (const point of INNOCENT_SPAWN_POINTS) {
      this._spawnInnocentSpawnPoint(point);
    }
  }

  private _spawnInnocentSpawnPoint(point: SpawnPointPlacement): void {
    const world = this.getWorld();
    if (!world || world.getActors().some(actor => actor.name === point.name)) {
      return;
    }

    world.addActor(InnocentSpawnPointActor.create({
      name: point.name,
      position: point.position.clone(),
      scale: point.scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      rotation: point.rotation?.clone() ?? new THREE.Euler(),
    }));
  }

  /**
   * Recreate the single scene "innocent" prop. InnocentHandler.bind() looks up the
   * actor literally named "innocent" and drives it; the mobile empty scene has none,
   * so without this innocents never reveal. Spawned hidden — the handler positions /
   * reveals it on demand.
   */
  private async _spawnInnocentProp(): Promise<void> {
    const world = this.getWorld();
    if (!world || !INNOCENT_PROP) {
      return;
    }
    if (world.getActors().some(actor => actor.name.toLowerCase() === 'innocent')) {
      return;
    }

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: INNOCENT_PROP.modelUrl,
      material: INNOCENT_PROP.material,
      position: INNOCENT_PROP.position.clone(),
      scale: INNOCENT_PROP.scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      rotation: INNOCENT_PROP.rotation?.clone() ?? new THREE.Euler(),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    const actor = ENGINE.Actor.create({ name: 'innocent', rootComponent: visual });
    world.addActor(actor);
    actor.setHiddenInGame(true);

    if (!visual.isModelLoaded()) {
      await visual.waitForLoad().catch((error) => {
        console.warn('[MobileSceneChunkLoader] Failed to load innocent prop', error);
      });
    }

    downscaleModelTextures(visual.getModel(), MOBILE_TEXTURE_MAX_DIM);
    downscaleModelTextures(visual.getModelTemplate(), MOBILE_TEXTURE_MAX_DIM);
  }

  /**
   * The startup navmesh + collision floor is the `MobileGround` actor from
   * mobile-empty.genesys-scene (top ≈ y -0.95). Hide its mesh so it no longer
   * z-fights with / buries the real grass-road tiles (which sit at ≈ -0.93..-1.0),
   * while keeping its physics body and navmesh contribution. A separate low grey
   * backdrop fills gaps between tiles without ever covering them.
   */
  private _ensureGroundSetup(): void {
    if (this._groundReady) {
      return;
    }
    this._groundReady = true;

    const world = this.getWorld();
    if (!world) {
      return;
    }

    const placeholder = world.getActors().find(actor => actor.name === 'MobileGround');
    const placeholderMesh = placeholder?.rootComponent;
    if (placeholderMesh instanceof ENGINE.MeshComponent && placeholderMesh.mesh) {
      // Keep physics + navmesh, drop only the visual so tiles render on top.
      placeholderMesh.mesh.visible = false;
    }

    // Low grey backdrop (visual only) below all tiles — fills the gaps the desktop
    // scene's large base Ground used to cover. Spans town + bedroom.
    world.addActor(ENGINE.Actor.create({
      name: 'MobileGroundBackdrop',
      rootComponent: ENGINE.MeshComponent.create({
        geometry: new THREE.BoxGeometry(520, 0.1, 520),
        material: new THREE.MeshStandardMaterial({
          color: new THREE.Color(0.07, 0.07, 0.08),
          roughness: 1,
        }),
        position: new THREE.Vector3(40, -1.35, -20),
        physicsOptions: { enabled: false },
        castShadow: false,
        receiveShadow: false,
      }),
    }));
  }

  private _spawnSpawnBlockers(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    for (let i = 0; i < SPAWN_BLOCKERS.length; i++) {
      this._spawnSpawnBlocker(SPAWN_BLOCKERS[i]!);
    }
  }

  private _spawnSpawnBlocker(blocker: SpawnBlockerPlacement): void {
    const world = this.getWorld();
    if (!world || world.getActors().some(actor => actor.name === blocker.name)) {
      return;
    }

    world.addActor(SpawnBlockerActor.create({
      name: blocker.name,
      position: blocker.position.clone(),
      scale: blocker.scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      rotation: blocker.rotation?.clone() ?? new THREE.Euler(),
    }));
  }

  private async _loadGroundTiles(): Promise<void> {
    const TILES_PER_BATCH = 12;
    for (let i = 0; i < GROUND_TILES.length; i++) {
      this._spawnGroundTile(GROUND_TILES[i]);
      if ((i + 1) % TILES_PER_BATCH === 0) {
        await delay(PLACEMENT_DELAY_MS);
      }
    }
  }

  private _spawnGroundTile(tile: GroundTilePlacement): void {
    const world = this.getWorld();
    if (!world || world.getActors().some(actor => actor.name === tile.name)) {
      return;
    }

    const mesh = ENGINE.MeshComponent.create({
      material: tile.material,
      position: tile.position.clone(),
      scale: tile.scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      rotation: tile.rotation?.clone() ?? new THREE.Euler(),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    world.addActor(ENGINE.Actor.create({ name: tile.name, rootComponent: mesh }));
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

    // Fences and walls have no collision on mobile so enemies can path through freely.
    const url = placement.modelUrl.toLowerCase();
    const noCollision =
      url.includes('woodenfence') ||
      url.includes('wall.glb');
    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: placement.modelUrl,
      material: placement.material,
      position: placement.position.clone(),
      scale: placement.scale?.clone() ?? new THREE.Vector3(1, 1, 1),
      rotation: placement.rotation?.clone() ?? new THREE.Euler(),
      physicsOptions: noCollision
        ? { enabled: false }
        : { enabled: true, motionType: ENGINE.PhysicsMotionType.Static },
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

    // Shrink full-res textures to fit the mobile memory budget. Textures are shared
    // across instances, so this only does real work the first time each is seen.
    // Process both the displayed clone and the cached template (override meshes swap
    // the clone's material but the template keeps the original full-size texture resident).
    downscaleModelTextures(visual.getModel(), MOBILE_TEXTURE_MAX_DIM);
    downscaleModelTextures(visual.getModelTemplate(), MOBILE_TEXTURE_MAX_DIM);
  }
}
