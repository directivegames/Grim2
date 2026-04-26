import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { AssetPath } from '@gnsx/genesys.js';
import { GrassSwayShaderMaterial } from '../materials/grass/grassDualBackend.js';
import { GrassUniformManager } from '../materials/grass/GrassUniformManager.js';

/** TallGrassActor — standard vertex-shader swaying + interaction (GPU). */
@ENGINE.GameClass()
export class TallGrassActor extends ENGINE.Actor {
  @ENGINE.property({ type: 'string', category: 'Tall Grass' })
  public textureUrl: ENGINE.TexturePath = '@project/assets/textures/tallgrass.png';

  @ENGINE.property({ type: 'number', min: 0.05, max: 10, step: 0.05, category: 'Tall Grass' })
  public width: number = 1.0;

  @ENGINE.property({ type: 'number', min: 0.05, max: 10, step: 0.05, category: 'Tall Grass' })
  public height: number = 1.5;

  @ENGINE.property({ type: 'number', min: 0, max: 10, step: 0.1, category: 'Wind' })
  public windSpeed: number = 1.8;

  @ENGINE.property({ type: 'number', min: 1, max: 80, step: 1, category: 'Wind' })
  public windRigidness: number = 25;

  @ENGINE.property({ type: 'number', min: 0, max: 0.2, step: 0.001, category: 'Wind' })
  public windAmplitude: number = 0.03;

  @ENGINE.property({ type: 'number', min: -1, max: 2, step: 0.01, category: 'Wind' })
  public yOffset: number = 0.0;

  @ENGINE.property({ type: 'number', min: 0.1, max: 10, step: 0.1, category: 'Interaction' })
  public interactorRadius: number = 1.2;

  @ENGINE.property({ type: 'number', min: 0, max: 1, step: 0.01, category: 'Interaction' })
  public interactorStrength: number = 0.12;

  private _mesh: ENGINE.MeshComponent | null = null;
  private _mat: GrassSwayShaderMaterial | null = null;
  private _textureLoadPromise: Promise<void> | null = null;

  private ensureSingleMeshComponent(): ENGINE.MeshComponent {
    // Reuse any serialized MeshComponent(s) instead of creating duplicates.
    const meshes = this.getComponents(ENGINE.MeshComponent);
    if (meshes.length > 0) {
      const keep = meshes[0]!;
      // Remove extras that got serialized from previous attempts.
      for (let i = 1; i < meshes.length; i++) {
        meshes[i]!.removeFromParent();
      }
      this._mesh = keep;
      return keep;
    }

    const created = ENGINE.MeshComponent.create({
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });
    created.rotation.order = 'YXZ';
    this.rootComponent.add(created);
    this._mesh = created;
    return created;
  }

  private ensureMaterialAndGeometry(mesh: ENGINE.MeshComponent): void {
    // Ensure correct plane geometry (base pivot).
    const geometry = new THREE.PlaneGeometry(this.width, this.height);
    geometry.translate(0, this.height * 0.5, 0);
    // Prevent “invisible until touched” (stale/empty bounds → frustum cull).
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.geometry = geometry;
    mesh.mesh.frustumCulled = false;

    if (!this._mat) {
      this._mat = new GrassSwayShaderMaterial({
        mapUrl: this.textureUrl,
        windSpeed: this.windSpeed,
        windRigidness: this.windRigidness,
        windAmplitude: this.windAmplitude,
        yOffset: this.yOffset,
        interactorRadius: this.interactorRadius,
        interactorStrength: this.interactorStrength,
        alphaTest: 0.3,
      });
    }

    // Bypass MeshComponent's material loader and assign directly.
    mesh.mesh.material = this._mat;
    this._mat.side = THREE.DoubleSide;
    this._mat.transparent = true;
    this._mat.depthWrite = false;
    this._mat.needsUpdate = true;
  }

  public override postLoad(): void {
    super.postLoad();
    const mesh = this.ensureSingleMeshComponent();
    this.ensureMaterialAndGeometry(mesh);
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    const mesh = this.ensureSingleMeshComponent();
    this.ensureMaterialAndGeometry(mesh);
    this.ensureTextureLoaded();
  }

  protected override doBeginPlay(): void {
    const mesh = this.ensureSingleMeshComponent();
    this.ensureMaterialAndGeometry(mesh);
    super.doBeginPlay();
    this.ensureTextureLoaded();

    // Register with global uniform manager to batch updates
    if (this._mat) {
      GrassUniformManager.registerMaterial(this._mat);
    }
  }

  private ensureTextureLoaded(): void {
    if (this._textureLoadPromise) return;
    const mat = this._mat;
    if (!mat) return;

    const path = AssetPath.fromString(String(mat.mapUrl));
    this._textureLoadPromise = ENGINE.resourceManager.loadTexture(path).then((tex) => {
      if (!tex) return;
      // Ensure alpha textures behave like foliage cutouts.
      tex.needsUpdate = true;
      mat.uniforms.uMap.value = tex;
      // WebGPU node pipeline expects `material.map` too.
      (mat as unknown as { map?: THREE.Texture }).map = tex;
    }).finally(() => {
      // Keep the loaded texture; only clear the promise flag.
      this._textureLoadPromise = null;
    });
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (this.getWorld()?.isEditorWorld) {
      const mesh = this.ensureSingleMeshComponent();
      this.ensureMaterialAndGeometry(mesh);
      super.tickPrePhysics(deltaTime);
      return;
    }

    // PERFORMANCE: Uniform updates are now handled globally by GrassUniformManager
    // instead of per-actor every frame. This reduces O(n) updates to O(1).
    super.tickPrePhysics(deltaTime);
  }

  protected override doEndPlay(): void {
    // Unregister from uniform manager to allow cleanup
    if (this._mat) {
      GrassUniformManager.unregisterMaterial(this._mat);
    }
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Billboard';
  }
}
