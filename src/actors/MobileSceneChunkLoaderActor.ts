import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { isMobileDevice } from '../utils/mobile-device.js';

type GlbPlacement = {
  name: string;
  modelUrl: ENGINE.ModelPath;
  position: THREE.Vector3;
  scale?: THREE.Vector3;
  rotation?: THREE.Euler;
};

const FRAME_DELAY_MS = 34;
const HIDDEN_LOAD_Y = -1000;

const BEDROOM_CHUNK: readonly GlbPlacement[] = [
  {
    name: 'MobileBedroom',
    modelUrl: '@project/assets/models/Halloween game.glb' as ENGINE.ModelPath,
    position: new THREE.Vector3(11.7, 2.3, -20.6),
    scale: new THREE.Vector3(0.7, 0.7, 0.7),
  },
];

const HOUSE_CHUNK: readonly GlbPlacement[] = [
  {
    name: 'MobileHouse_A',
    modelUrl: '@project/assets/models/Double house.glb' as ENGINE.ModelPath,
    position: new THREE.Vector3(-1.7, 3.8, -20.1),
  },
  {
    name: 'MobileHouse_B',
    modelUrl: '@project/assets/models/Double house.glb' as ENGINE.ModelPath,
    position: new THREE.Vector3(-30.1, 3.8, -20.1),
  },
];

const PROP_CHUNKS: readonly (readonly GlbPlacement[])[] = [
  [
    {
      name: 'MobileCar_A',
      modelUrl: '@project/assets/models/car 2.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(-0.56824, 0.279418, -9.184645),
      scale: new THREE.Vector3(0.25, 0.25, 0.25),
    },
  ],
  [
    {
      name: 'MobileCar_B',
      modelUrl: '@project/assets/models/Car.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(16.7, 0.2, -16.7),
      scale: new THREE.Vector3(0.25, 0.25, 0.25),
    },
    {
      name: 'MobileCar_C',
      modelUrl: '@project/assets/models/Car.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(-26.214521, 0.2, -15.079049),
      scale: new THREE.Vector3(0.25, 0.25, 0.25),
    },
  ],
  [
    {
      name: 'MobileHedge_A',
      modelUrl: '@project/assets/models/Hedge.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(4.867622, -0.884932, -17.342079),
      scale: new THREE.Vector3(0.075321, 0.075321, 0.075321),
    },
    {
      name: 'MobileHedge_B',
      modelUrl: '@project/assets/models/Hedge.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(-8.320137, -0.884932, -25.489639),
      scale: new THREE.Vector3(0.075321, 0.075321, 0.075321),
    },
    {
      name: 'MobileHedge_C',
      modelUrl: '@project/assets/models/Hedge.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(-8.320137, -0.884932, -17.055371),
      scale: new THREE.Vector3(0.075321, 0.075321, 0.075321),
    },
  ],
  [
    {
      name: 'MobileBin_A',
      modelUrl: '@project/assets/models/Bin.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(7.569617, -0.3433, -10.3152),
      scale: new THREE.Vector3(3, 3, 3),
    },
    {
      name: 'MobileBin_B',
      modelUrl: '@project/assets/models/Bin.glb' as ENGINE.ModelPath,
      position: new THREE.Vector3(8.189708, -0.557035, -10.873028),
      scale: new THREE.Vector3(3, 3, 3),
    },
  ],
];

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

  public loadIntroBedroom(): Promise<void> {
    this._introPromise ??= this._loadIntroBedroom();
    return this._introPromise;
  }

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
    await delay(FRAME_DELAY_MS * 2);
    await this._loadGlbChunk(HOUSE_CHUNK);

    for (const chunk of PROP_CHUNKS) {
      await delay(FRAME_DELAY_MS * 3);
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

    const ambient = ENGINE.Actor.create({
      name: 'MobileAmbientLight',
      rootComponent: ENGINE.AmbientLightComponent.create({
        color: new THREE.Color(0.32, 0.25, 0.55),
        intensity: 5.5,
      }),
    });
    world.addActor(ambient);

    const fill = ENGINE.Actor.create({
      name: 'MobileFillLight',
      rootComponent: ENGINE.PointLightComponent.create({
        color: new THREE.Color(0.74, 0.55, 1),
        intensity: 18,
        distance: 45,
        position: new THREE.Vector3(0, 8, -8),
      }),
    });
    world.addActor(fill);
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

    const ground = ENGINE.Actor.create({
      name: 'MobileVisualGround',
      rootComponent: ENGINE.MeshComponent.create({
        geometry: new THREE.BoxGeometry(90, 0.04, 90),
        material: new THREE.MeshStandardMaterial({
          color: new THREE.Color(0.045, 0.035, 0.065),
          roughness: 1,
        }),
        position: new THREE.Vector3(0, -0.92, 0),
        physicsOptions: { enabled: false },
        castShadow: false,
        receiveShadow: false,
      }),
    });
    world.addActor(ground);

    const roadMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.08, 0.075, 0.095),
      roughness: 1,
    });

    for (const [index, rootComponent] of [
      ENGINE.MeshComponent.create({
        geometry: new THREE.BoxGeometry(70, 0.035, 8),
        material: roadMat,
        position: new THREE.Vector3(0, -0.88, -12),
        physicsOptions: { enabled: false },
        castShadow: false,
        receiveShadow: false,
      }),
      ENGINE.MeshComponent.create({
        geometry: new THREE.BoxGeometry(8, 0.035, 70),
        material: roadMat,
        position: new THREE.Vector3(-8, -0.87, 0),
        physicsOptions: { enabled: false },
        castShadow: false,
        receiveShadow: false,
      }),
    ].entries()) {
      world.addActor(ENGINE.Actor.create({
        name: `MobileRoad_${index + 1}`,
        rootComponent,
      }));
    }
  }

  private async _loadGlbChunk(chunk: readonly GlbPlacement[]): Promise<void> {
    for (const placement of chunk) {
      await this._spawnGlbPlacement(placement);
      await delay(FRAME_DELAY_MS);
    }
  }

  private async _spawnGlbPlacement(placement: GlbPlacement): Promise<void> {
    const world = this.getWorld();
    if (!world || world.getActors().some(actor => actor.name === placement.name)) {
      return;
    }

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: placement.modelUrl,
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
