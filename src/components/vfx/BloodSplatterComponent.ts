/**
 * BloodSplatterComponent — animated blood VFX from a pooled spritesheet billboard.
 *
 * Uses row 2 of VFX Blood Batch 1_SpriteSheetRows (horizontal side splatter).
 * Each burst spawns one billboard that plays through the row's frames once.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const ANIM_DURATION = 0.5;
const SPLATTER_COUNT = 1;
const MAX_POOL_SIZE = 32;

const BLOOD_SPRITESHEET_PATH = '@project/assets/VFX/BloodFX/Blooduse.png';

/** Second row (0-based index 1) — horizontal side-impact splatter. */
const SPLATTER_ROW = 1;
const ROW_COUNT = 9;
const FRAME_COUNT = 7;
const FRAME_DURATION = ANIM_DURATION / FRAME_COUNT;

/** Spritesheet is 1540×837; row 2 cells are ~220×93 px. */
const FRAME_ASPECT = (1540 / FRAME_COUNT) / (837 / ROW_COUNT);

const DROP_GEO = new THREE.PlaneGeometry(FRAME_ASPECT, 1);

const _cameraDir = new THREE.Vector3();

interface BloodDrop {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  active: boolean;
  yawOffset: number;
  scale: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function rowVOffset(rowIndex: number): number {
  return (ROW_COUNT - rowIndex - 1) / ROW_COUNT;
}

function applyFrameUV(texture: THREE.Texture, frameIndex: number): void {
  texture.repeat.set(1 / FRAME_COUNT, 1 / ROW_COUNT);
  texture.offset.set(frameIndex / FRAME_COUNT, rowVOffset(SPLATTER_ROW));
}

/** Convert the sheet's black background into real alpha so it works in WebGPU too. */
function createBlackKeyedTexture(source: THREE.Texture, threshold = 32): THREE.Texture {
  const image = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return source;
  }

  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;

  for (let i = 0; i < data.length; i += 4) {
    const luminance = data[i]! * 0.2126 + data[i + 1]! * 0.7152 + data[i + 2]! * 0.0722;
    data[i + 3] = luminance < threshold ? 0 : 255;
  }

  ctx.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

@ENGINE.GameClass()
export class BloodSplatterComponent extends ENGINE.SceneComponent {
  private readonly _drops: BloodDrop[] = [];
  private readonly _meshPool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private _poolIndex = 0;
  private _spritesheet: THREE.Texture | null = null;

  public override async beginPlay(): Promise<void> {
    super.beginPlay();

    const world = this.getWorld();
    if (!world) {
      return;
    }

    await this._loadSpritesheet();
    this._buildPool(world);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public burst(worldPos: THREE.Vector3): void {
    if (this._meshPool.length === 0) {
      return;
    }

    for (let i = 0; i < SPLATTER_COUNT; i++) {
      const mesh = this._getPooledMesh();
      if (!mesh) {
        break;
      }

      const texture = mesh.material.map;
      if (texture) {
        applyFrameUV(texture, 0);
      }

      mesh.position.copy(worldPos);
      mesh.position.y += randomBetween(0.65, 1.05);
      mesh.visible = true;
      mesh.material.opacity = 1;

      const scale = randomBetween(1.0, 1.35);
      mesh.scale.set(scale * FRAME_ASPECT, scale, 1);

      const yawOffset = randomBetween(0, Math.PI * 2);
      mesh.rotation.set(0, yawOffset, 0);

      const existing = this._drops.find((d) => d.mesh === mesh);
      if (existing) {
        existing.elapsed = 0;
        existing.active = true;
        existing.yawOffset = yawOffset;
        existing.scale = scale;
      } else {
        this._drops.push({
          mesh,
          elapsed: 0,
          active: true,
          yawOffset,
          scale,
        });
      }
    }
  }

  // ── Tick ────────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateDrops(deltaTime);
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async _loadSpritesheet(): Promise<void> {
    if (this._spritesheet) {
      return;
    }

    try {
      const resolvedPath = await ENGINE.resolveAssetPathsInText(BLOOD_SPRITESHEET_PATH);
      this._spritesheet = await new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(
          resolvedPath,
          (texture) => {
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            resolve(createBlackKeyedTexture(texture));
          },
          undefined,
          (err) => reject(err),
        );
      });
    } catch (e) {
      console.warn('[BloodSplatterComponent] Failed to load blood spritesheet:', e);
    }
  }

  private _buildPool(world: ENGINE.World): void {
    if (this._meshPool.length > 0) {
      return;
    }

    for (let i = 0; i < MAX_POOL_SIZE; i++) {
      const mesh = this._createDropMesh();
      mesh.visible = false;
      world.scene.add(mesh);
      this._meshPool.push(mesh);
    }
  }

  private _createDropMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    const texture = this._spritesheet?.clone() ?? null;
    if (texture) {
      applyFrameUV(texture, 0);
    }

    const mat = new THREE.MeshBasicMaterial({
      map: texture ?? undefined,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      alphaTest: texture ? 0.12 : 0,
    });

    if (!texture) {
      mat.color.setHex(0xff1111);
    } else {
    }

    return new THREE.Mesh(DROP_GEO, mat);
  }

  private _getPooledMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null {
    const mesh = this._meshPool[this._poolIndex];
    this._poolIndex = (this._poolIndex + 1) % MAX_POOL_SIZE;
    return mesh ?? null;
  }

  private _billboardToCamera(
    mesh: THREE.Mesh,
    yawOffset: number,
    camera: THREE.Camera | null,
  ): void {
    if (!camera) {
      return;
    }

    _cameraDir.subVectors(camera.position, mesh.position);
    _cameraDir.y = 0;
    if (_cameraDir.lengthSq() < 0.0001) {
      return;
    }

    mesh.rotation.set(0, Math.atan2(_cameraDir.x, _cameraDir.z) + yawOffset, 0);
  }

  private _updateDrops(deltaTime: number): void {
    const drops = this._drops;
    let writeIndex = 0;
    const camera = this.getWorld()?.getActiveCamera() ?? null;

    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      if (!drop.active) {
        continue;
      }

      drop.elapsed += deltaTime;
      const frameIndex = Math.floor(drop.elapsed / FRAME_DURATION);

      this._billboardToCamera(drop.mesh, drop.yawOffset, camera);

      const texture = drop.mesh.material.map;
      if (texture) {
        applyFrameUV(texture, Math.min(frameIndex, FRAME_COUNT - 1));
      }

      if (drop.elapsed >= ANIM_DURATION) {
        drop.mesh.visible = false;
        drop.active = false;
      } else {
        if (writeIndex !== i) {
          drops[writeIndex] = drop;
        }
        writeIndex++;
      }
    }

    drops.length = writeIndex;
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  public override endPlay(): void {
    for (const mesh of this._meshPool) {
      mesh.visible = false;
      mesh.material.map?.dispose();
      mesh.material.dispose();
      mesh.removeFromParent();
    }
    this._meshPool.length = 0;
    this._drops.length = 0;

    if (this._spritesheet) {
      this._spritesheet.dispose();
      this._spritesheet = null;
    }

    super.endPlay();
  }
}
