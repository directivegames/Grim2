import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

/** Hit flash: shared, never one per instance. */
const FLASH = new THREE.MeshBasicMaterial({ color: 0xffffff });

/**
 * Visual-only model loaded from a GLB exported by genesys-code-modeling/scripts/export-glb.ts. Physics
 * is off (the owner carries collision). Subclasses animate named pivots ("rig", "head", …) once
 * `onRigReady` runs. Looks: the GLB's own materials (M_Toon / M_Glow via the engine's material link), a
 * shared runtime tint set with `setLook`, and a short white `flash`. Both swap every mesh: skin, ink and glow.
 */
export abstract class GlbModel extends ENGINE.ModelMeshNode {
  protected rig: THREE.Object3D | null = null;
  protected readonly skins: THREE.Mesh[] = [];
  private readonly own: THREE.Material[] = [];
  private look: THREE.Material | null = null; // null = the GLB's own materials
  private flashLeft = 0;

  /** Full '@project/…glb' path as one string literal (the build copies only literal paths). */
  protected abstract glbPath(): string;

  /** Called once the GLB is in place; find pivots with `part(name)`. */
  protected abstract onRigReady(): void;

  constructor() {
    super();
    // Subscribe here, not in initialize(): a load from a prefab or scene may skip initialize().
    this.onMeshLoaded.add(() => this.bindRig());
  }

  public override initialize(options?: ENGINE.ModelMeshNodeOptions): void {
    super.initialize({ ...options, modelUrl: this.glbPath(), physicsOptions: { enabled: false } });
  }

  private bindRig(): void {
    this.rig = this.getObjectByName('rig') ?? null;
    this.skins.length = 0;
    this.own.length = 0;
    for (const m of this.getAllMeshes()) {
      m.castShadow = true;
      this.skins.push(m);
      this.own.push(m.material as THREE.Material);
    }
    if (this.rig) this.onRigReady();
  }

  protected part(name: string): THREE.Object3D {
    const o = this.getObjectByName(name);
    if (!o) throw new Error(`${this.glbPath()}: missing pivot "${name}"`);
    return o;
  }

  /** A toon material the GLB came with (palette + ramp), for building shared tints; null until loaded. */
  protected baseToon(): THREE.MeshToonMaterial | null {
    const m = this.own.find((x) => (x as THREE.MeshToonMaterial).gradientMap && (x as THREE.MeshToonMaterial).map);
    return (m as THREE.MeshToonMaterial | undefined) ?? null;
  }

  /** Switch every mesh to a shared runtime material, or back to the GLB's own with null. */
  protected setLook(mat: THREE.Material | null): void {
    if (mat === this.look) return;
    this.look = mat;
    if (this.flashLeft <= 0) this.applyLook();
  }

  /** Brief white flash of the whole model. */
  protected flash(seconds: number): void {
    this.flashLeft = seconds;
    for (const m of this.skins) m.material = FLASH;
  }

  private applyLook(): void {
    this.skins.forEach((m, i) => (m.material = this.look ?? this.own[i]));
  }

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    if (this.flashLeft > 0 && (this.flashLeft -= dt) <= 0) this.applyLook();
  }
}

/** A toon tint that keeps the palette and ramp of `base`: colour multiplies the palette, emissive adds a glow. Build each once and share it: never per spawn. */
export function toonTint(base: THREE.MeshToonMaterial, color: number, emissive: number, emissiveIntensity: number): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ map: base.map, gradientMap: base.gradientMap, color, emissive, emissiveIntensity });
}
