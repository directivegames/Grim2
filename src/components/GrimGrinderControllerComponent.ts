/**
 * Runtime controller for the editor-placed grimgrinder prop.
 * Attached automatically in game.ts — no custom actor class needed.
 *
 * Animations play from clips embedded in grimgrinder.glb via THREE.AnimationMixer.
 * No grimgrinder.anim.json — avoids SDK build stripping that file from .dist.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const GRIM_GRINDER_MESH_KEY = 'grimgrinder';
const HIDDEN_Y = -1000;

const CLIP_RUMBLING = 'rumbling';
const CLIP_SPINNING = 'spinning';


@ENGINE.GameClass()
export class GrimGrinderControllerComponent extends ENGINE.SceneNode {
  private _initialized = false;
  private _mixer: THREE.AnimationMixer | null = null;
  private _prevWallTimeMs = 0;
  private _savedPosition: THREE.Vector3 | null = null;
  private _homePosition: THREE.Vector3 | null = null;
  private _homeRotation: THREE.Euler | null = null;
  private _parked = false;
  private _lockedGroundY: number | null = null;
  private _syncXZ = new THREE.Vector3();
  private _lastYaw = 0;
  private _modelBaselinePos: THREE.Vector3 | null = null;

  public static attachAllInWorld(world: ENGINE.World): void {
    let attached = 0;
    for (const actor of world.getRootNodes()) {
      const mesh = actor.getNode(ENGINE.ModelMeshNode);
      const url = mesh ? (mesh.modelUrl ?? '') : '';
      if (!GrimGrinderControllerComponent._matchesGrimGrinder(actor.name, url)) {
        continue;
      }
      if (actor.getNode(GrimGrinderControllerComponent)) {
        attached += 1;
        continue;
      }
      const ctrl = GrimGrinderControllerComponent.create({ name: 'GrimGrinderController' });
      actor.add(ctrl);
      attached += 1;
    }
    if (attached === 0) {
      console.warn('[GrimGrinder] No grimgrinder prop found in scene.');
    }
  }

  public static findInWorld(world: ENGINE.World): GrimGrinderControllerComponent | null {
    for (const actor of world.getRootNodes()) {
      const ctrl = actor.getNode(GrimGrinderControllerComponent);
      if (ctrl) {
        return ctrl;
      }
    }
    return null;
  }

  private static _matchesGrimGrinder(actorName: string, modelUrl: string): boolean {
    return actorName.toLowerCase().includes(GRIM_GRINDER_MESH_KEY)
      || modelUrl.toLowerCase().includes(GRIM_GRINDER_MESH_KEY);
  }

  public isParked(): boolean {
    return this._parked;
  }

  public park(): void {
    const actor = this.getRoot();
    if (!actor || this._parked) return;
    if (!this._savedPosition) {
      this._savedPosition = actor.position.clone();
    }
    actor.position.y = HIDDEN_Y;
    this._parked = true;
    this._lockedGroundY = null;
  }

  public unpark(): void {
    const actor = this.getRoot();
    if (!actor || !this._parked) return;
    if (this._savedPosition) {
      actor.position.copy(this._savedPosition);
    }
    this._parked = false;
  }

  public teleportTo(worldPosition: THREE.Vector3, yawRadians = 0): void {
    const actor = this.getRoot();
    if (!actor) return;
    this.unpark();
    this._lockedGroundY = worldPosition.y;
    this._syncXZ.set(worldPosition.x, 0, worldPosition.z);
    actor.position.set(worldPosition.x, this._lockedGroundY, worldPosition.z);
    actor.rotation.set(0, yawRadians, 0, 'YXZ');
    this._lastYaw = yawRadians;
    this._savedPosition = actor.position.clone();
    this._captureModelBaseline();
    this._resetModelRootMotion();
  }

  public syncTo(worldPosition: THREE.Vector3, yawRadians = 0): void {
    const actor = this.getRoot();
    if (!actor) return;
    if (this._lockedGroundY === null) {
      this._lockedGroundY = worldPosition.y;
    }
    this._syncXZ.set(worldPosition.x, 0, worldPosition.z);
    this._lastYaw = yawRadians;
    actor.position.set(this._syncXZ.x, this._lockedGroundY, this._syncXZ.z);
    actor.rotation.set(0, yawRadians, 0, 'YXZ');
  }

  public returnHome(): void {
    const actor = this.getRoot();
    if (!actor) return;
    this._captureHomeIfNeeded();
    this._lockedGroundY = null;
    if (this._homePosition) actor.position.copy(this._homePosition);
    if (this._homeRotation) actor.rotation.copy(this._homeRotation);
    this._parked = false;
    this._resetModelRootMotion();
  }

  private _captureHomeIfNeeded(): void {
    if (this._homePosition) return;
    const actor = this.getRoot();
    if (!actor) return;
    this._homePosition = actor.position.clone();
    this._homeRotation = actor.rotation.clone();
  }

  public override tickPrePhysics(_deltaTime: number): void {
    super.tickPrePhysics(_deltaTime);

    const now = performance.now();
    if (this._mixer && this._prevWallTimeMs > 0) {
      const dt = (now - this._prevWallTimeMs) / 1000;
      this._mixer.update(dt);
    }
    this._prevWallTimeMs = now;

    if (this._initialized) {
      return;
    }
    this._initialized = true;
    this._captureHomeIfNeeded();
    void this._startAnimationsFromGlb();
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    if (this._parked || this._lockedGroundY === null) {
      return;
    }
    const actor = this.getRoot();
    if (!actor) {
      return;
    }
    actor.position.set(this._syncXZ.x, this._lockedGroundY, this._syncXZ.z);
    actor.rotation.set(0, this._lastYaw, 0, 'YXZ');
    this._resetModelRootMotion();
  }

  private _captureModelBaseline(): void {
    const model = this._getGltfModel();
    if (model && !this._modelBaselinePos) {
      this._modelBaselinePos = model.position.clone();
    }
  }

  /** GLB clips can carry root motion — keep the actor on the ground. */
  private _resetModelRootMotion(): void {
    const model = this._getGltfModel();
    if (!model) {
      return;
    }
    if (this._modelBaselinePos) {
      model.position.copy(this._modelBaselinePos);
    } else {
      model.position.set(0, 0, 0);
    }
  }

  private _getGltfModel(): THREE.Object3D | null {
    const actor = this.getRoot();
    if (!actor) {
      return null;
    }
    return actor.getNode(ENGINE.ModelMeshNode);
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._mixer?.stopAllAction();
    this._mixer = null;
    this._prevWallTimeMs = 0;
    this._lockedGroundY = null;
    this._modelBaselinePos = null;
    return true;
  }

  /** Remove scene ASM components that 404 on grimgrinder.anim.json (editor leftovers). */
  private _stripSceneAnimJsonMachines(actor: ENGINE.SceneNode): void {
    const toRemove: ENGINE.AnimationStateMachineNode[] = [];
    for (const anim of actor.getNodes(ENGINE.AnimationStateMachineNode)) {
      const url = String((anim as unknown as { configUrl?: string }).configUrl ?? '').toLowerCase();
      if (url.includes('grimgrinder') && url.includes('.anim')) {
        toRemove.push(anim);
      }
    }
    for (const anim of toRemove) {
      anim.destroy();
    }
  }

  private async _startAnimationsFromGlb(): Promise<void> {
    const actor = this.getRoot();
    if (!actor) {
      return;
    }

    this._stripSceneAnimJsonMachines(actor);

    const meshComp = actor.getNode(ENGINE.ModelMeshNode);
    if (!meshComp) {
      console.warn(`[GrimGrinder] "${actor.name}" has no ModelMeshNode.`);
      return;
    }

    const tryStart = (): boolean => {
      const clips = meshComp.getAnimations();
      if (!meshComp.isModelLoaded() || clips.length === 0) {
        return false;
      }

      if (this._mixer) {
        return true;
      }

      const mixer = new THREE.AnimationMixer(meshComp);
      this._mixer = mixer;
      this._captureModelBaseline();

      for (const clipName of [CLIP_RUMBLING, CLIP_SPINNING]) {
        const clip = THREE.AnimationClip.findByName(clips, clipName);
        if (clip) {
          const action = mixer.clipAction(clip);
          action.play();
        } else {
          console.warn(
            `[GrimGrinder] Clip "${clipName}" not in grimgrinder.glb. Available: ${clips.map(c => c.name).join(', ')}`,
          );
        }
      }
      return true;
    };

    if (tryStart()) {
      return;
    }

    meshComp.onMeshLoaded.add(() => {
      tryStart();
    });

    await meshComp.waitForLoad().catch(() => undefined);
    if (!tryStart()) {
      const deadline = performance.now() + 15_000;
      while (performance.now() < deadline) {
        await new Promise<void>(r => window.setTimeout(r, 50));
        if (tryStart()) {
          return;
        }
      }
      console.error('[GrimGrinder] Could not start animations — grimgrinder.glb not ready.');
    }
  }
}
