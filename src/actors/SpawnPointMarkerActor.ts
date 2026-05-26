/**
 * Shared editor gizmo for scene-placed spawn markers (no gameplay collision).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, EditorPropertyChangedResult } from '@gnsx/genesys.js';

const INVISIBLE_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

export interface SpawnPointMarkerColors {
  readonly fill: number;
  readonly edge: number;
}

export abstract class SpawnPointMarkerActor extends ENGINE.Actor {
  @ENGINE.property({ type: 'boolean', category: 'Spawn Point' })
  public enabled = true;

  @ENGINE.property({ type: 'number', min: 0.15, max: 4, step: 0.05, category: 'Spawn Point' })
  public halfExtentX = 0.45;

  @ENGINE.property({ type: 'number', min: 0.15, max: 4, step: 0.05, category: 'Spawn Point' })
  public halfExtentY = 0.9;

  @ENGINE.property({ type: 'number', min: 0.15, max: 4, step: 0.05, category: 'Spawn Point' })
  public halfExtentZ = 0.45;

  @ENGINE.property({ type: 'boolean', category: 'Spawn Point' })
  public showWireframeInGame = false;

  private _mesh: ENGINE.MeshComponent | null = null;
  private _fillMaterial: THREE.MeshBasicMaterial | null = null;
  private _edgeLines: THREE.LineSegments | null = null;
  private _edgeMaterial: THREE.LineBasicMaterial | null = null;
  private _lastGeomKey = '';

  protected abstract getMarkerColors(): SpawnPointMarkerColors;

  public getSpawnWorldPosition(out: THREE.Vector3): void {
    this.rootComponent.getWorldPosition(out);
  }

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.MeshComponent.create({
      material: INVISIBLE_MATERIAL,
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
    const w = Math.max(0.3, this.halfExtentX * 2);
    const h = Math.max(0.3, this.halfExtentY * 2);
    const d = Math.max(0.3, this.halfExtentZ * 2);
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

    const colors = this.getMarkerColors();
    if (!this._edgeMaterial) {
      this._edgeMaterial = new THREE.LineBasicMaterial({
        color: colors.edge,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
      });
    } else {
      this._edgeMaterial.color.setHex(colors.edge);
    }

    const edges = new THREE.EdgesGeometry(boxGeom);
    this._edgeLines = new THREE.LineSegments(edges, this._edgeMaterial);
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
      const colors = this.getMarkerColors();
      if (!this._fillMaterial) {
        this._fillMaterial = new THREE.MeshBasicMaterial({
          color: colors.fill,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      } else {
        this._fillMaterial.color.setHex(colors.fill);
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
