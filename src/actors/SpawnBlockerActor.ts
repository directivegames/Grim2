/**
 * SpawnBlockerActor — invisible static volume that blocks Grim and excludes spawns.
 *
 * Place in the editor over roads / out-of-play areas. Scale the actor or edit half-extents.
 * Visible as a red preview box in the editor; hidden in play unless Show Wireframe In Game is on.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, EditorPropertyChangedResult } from '@gnsx/genesys.js';
import {
  registerSpawnBlocker,
  unregisterSpawnBlocker,
} from '../mission/spawn-blockers.js';

const BLOCKER_PROFILE_NAME = 'SpawnBlockerStatic';

const INVISIBLE_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

const _localPoint = new THREE.Vector3();

function ensureSpawnBlockerCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  if (cfg.getProfile(BLOCKER_PROFILE_NAME)) {
    return;
  }

  const profile = new ENGINE.CollisionProfile(
    BLOCKER_PROFILE_NAME,
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.WorldStatic,
    [
      { channel: ENGINE.CollisionChannel.Pawn, response: ENGINE.CollisionResponse.Block },
      { channel: ENGINE.CollisionChannel.WorldStatic, response: ENGINE.CollisionResponse.Block },
      { channel: ENGINE.CollisionChannel.WorldDynamic, response: ENGINE.CollisionResponse.Block },
    ],
  );
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

@ENGINE.GameClass()
export class SpawnBlockerActor extends ENGINE.Actor {
  @ENGINE.property({ type: 'number', min: 0.25, max: 200, step: 0.25, category: 'Spawn Blocker' })
  public halfExtentX = 4;

  @ENGINE.property({ type: 'number', min: 0.25, max: 50, step: 0.25, category: 'Spawn Blocker' })
  public halfExtentY = 2;

  @ENGINE.property({ type: 'number', min: 0.25, max: 200, step: 0.25, category: 'Spawn Blocker' })
  public halfExtentZ = 4;

  /** Red preview while playing (editor preview is always on). */
  @ENGINE.property({ type: 'boolean', category: 'Spawn Blocker' })
  public showWireframeInGame = false;

  private _mesh: ENGINE.MeshComponent | null = null;
  private _fillMaterial: THREE.MeshBasicMaterial | null = null;
  private _edgeLines: THREE.LineSegments | null = null;
  private _edgeMaterial: THREE.LineBasicMaterial | null = null;
  private _lastGeomKey = '';

  public override initialize(options?: ActorOptions): void {
    ensureSpawnBlockerCollisionProfile();

    const root = ENGINE.MeshComponent.create({
      name: 'BlockerRoot',
      material: INVISIBLE_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Static,
        collisionProfile: BLOCKER_PROFILE_NAME,
      },
      castShadow: false,
      receiveShadow: false,
    });

    this._mesh = root;
    this._applyBoxGeometry(root);

    super.initialize({ ...options, rootComponent: root });
  }

  public override postLoad(): void {
    super.postLoad();
    this._refreshEditorPreview();
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    this._refreshEditorPreview();
  }

  public override onEditorPropertyChanged(
    path: string,
    _value: unknown,
    result: EditorPropertyChangedResult,
  ): void {
    super.onEditorPropertyChanged(path, _value, result);
    if (
      path === 'halfExtentX' ||
      path === 'halfExtentY' ||
      path === 'halfExtentZ' ||
      path === 'showWireframeInGame'
    ) {
      this._refreshEditorPreview();
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (this._isEditorWorld()) {
      this._refreshEditorPreview();
    }
    super.tickPrePhysics(deltaTime);
  }

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }this._syncVisualMaterial();
    if (!this._isEditorWorld()) {
      registerSpawnBlocker(this);
    }
  
    return true;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    unregisterSpawnBlocker(this);
    return true;
  }

  /** Point-in-OBB test (respects actor position, rotation, and scale). */
  public containsWorldPoint(worldPos: THREE.Vector3): boolean {
    _localPoint.copy(worldPos);
    this.rootComponent.worldToLocal(_localPoint);

    const sx = this.halfExtentX * Math.abs(this.rootComponent.scale.x);
    const sy = this.halfExtentY * Math.abs(this.rootComponent.scale.y);
    const sz = this.halfExtentZ * Math.abs(this.rootComponent.scale.z);

    return (
      Math.abs(_localPoint.x) <= sx &&
      Math.abs(_localPoint.y) <= sy &&
      Math.abs(_localPoint.z) <= sz
    );
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Box';
  }

  private _isEditorWorld(): boolean {
    return this.getWorld()?.isEditorWorld === true;
  }

  private _shouldShowVolume(): boolean {
    return this._isEditorWorld() || this.showWireframeInGame;
  }

  private _getMesh(): ENGINE.MeshComponent | null {
    if (this._mesh) {
      return this._mesh;
    }
    const root = this.rootComponent;
    return root instanceof ENGINE.MeshComponent ? root : null;
  }

  private _refreshEditorPreview(): void {
    const mesh = this._getMesh();
    if (!mesh) {
      return;
    }
    this._mesh = mesh;
    this._applyBoxGeometry(mesh);
    this._syncVisualMaterial();
  }

  private _applyBoxGeometry(mesh: ENGINE.MeshComponent): void {
    const w = Math.max(0.5, this.halfExtentX * 2);
    const h = Math.max(0.5, this.halfExtentY * 2);
    const d = Math.max(0.5, this.halfExtentZ * 2);
    const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
    if (key === this._lastGeomKey) {
      return;
    }
    this._lastGeomKey = key;

    const geom = new THREE.BoxGeometry(w, h, d);
    mesh.geometry = geom;
    this._updateEdgeLines(mesh, geom);
  }

  private _updateEdgeLines(mesh: ENGINE.MeshComponent, boxGeom: THREE.BoxGeometry): void {
    const threeMesh = mesh.mesh;
    if (!threeMesh) {
      return;
    }

    if (this._edgeLines) {
      threeMesh.remove(this._edgeLines);
      this._edgeLines.geometry.dispose();
      this._edgeLines = null;
    }

    if (!this._shouldShowVolume()) {
      return;
    }

    if (!this._edgeMaterial) {
      this._edgeMaterial = new THREE.LineBasicMaterial({
        color: 0xff2222,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
      });
    }

    const edges = new THREE.EdgesGeometry(boxGeom);
    this._edgeLines = new THREE.LineSegments(edges, this._edgeMaterial);
    this._edgeLines.name = 'BlockerEdges';
    this._edgeLines.frustumCulled = false;
    threeMesh.add(this._edgeLines);
  }

  private _syncVisualMaterial(): void {
    const mesh = this._getMesh();
    if (!mesh) {
      return;
    }

    const show = this._shouldShowVolume();
    const threeMesh = mesh.mesh;
    if (threeMesh) {
      threeMesh.visible = true;
    }

    if (show) {
      if (!this._fillMaterial) {
        this._fillMaterial = new THREE.MeshBasicMaterial({
          color: 0xff5555,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      }
      mesh.material = this._fillMaterial;
      if (this._edgeLines) {
        this._edgeLines.visible = true;
      }
    } else {
      mesh.material = INVISIBLE_MATERIAL;
      if (this._edgeLines) {
        this._edgeLines.visible = false;
      }
    }
  }
}
