/**
 * WeaponSlashSpriteComponent — blade-aligned slash spritesheet VFX.
 *
 * Uses SlashFX Combo3 (4 horizontal frames). Quad lies flat in the XZ plane,
 * rotates with the blade orbit (not camera-billboarded). Frames follow swing progress.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const SLASH_SPRITESHEET_PATH =
  '@project/assets/VFX/SlashFX Combos/SlashFX Combo3 sheet.png';

const FRAME_COUNT = 4;
/** Matches SpinningWeaponActor — keeps sprite aligned with the blade model. */
const BLADE_ANGLE_OFFSET = Math.PI / 2;
/** Fine-tune arc direction vs. texture (horizontal crescent in sheet). */
const SLASH_TEXTURE_YAW_OFFSET = 0;

const BLADE_ALONG_T = 0.55;
const SLASH_Y_LIFT = 0.04;
const BLADE_LENGTH_SCALE = 2.7;
const SLASH_MIN_SIZE = 5.6;
/** Extra width on the arc (local X after lay-flat). */
const SLASH_WIDTH_SCALE = 1.25;

const _X_AXIS = new THREE.Vector3(1, 0, 0);
const _Y_AXIS = new THREE.Vector3(0, 1, 0);
const _scratchPos = new THREE.Vector3();
const _quatFlat = new THREE.Quaternion();
const _quatYaw = new THREE.Quaternion();

function applyFrameUV(texture: THREE.Texture, frameIndex: number): void {
  texture.repeat.set(1 / FRAME_COUNT, 1);
  texture.offset.set(frameIndex / FRAME_COUNT, 0);
}

function applyBlackKeyCutout(material: THREE.MeshBasicMaterial, threshold = 0.12): void {
  material.customProgramCacheKey = () => `slashBlackKey_${threshold}`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      if (dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) < ${threshold.toFixed(4)}) {
        discard;
      }`,
    );
  };
}

@ENGINE.GameClass()
export class WeaponSlashSpriteComponent extends ENGINE.SceneComponent {
  private _mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private _texture: THREE.Texture | null = null;
  private _frameAspect = 2.4;
  private _active = false;
  private _sweepSign = 1;
  private _finisherScale = 1;

  public override async beginPlay(): Promise<void> {
    super.beginPlay();
    await this._loadTexture();
    this._buildMesh();
  }

  public beginSwing(attackStartAngle: number, attackEndAngle: number, finisher: boolean): void {
    this._sweepSign = attackEndAngle >= attackStartAngle ? 1 : -1;
    this._finisherScale = finisher ? 1.35 : 1;
    this._active = true;
    this._applyVisibility(true);
    if (this._texture) {
      applyFrameUV(this._texture, 0);
    }
  }

  public updateSwing(
    swingProgress: number,
    displayOrbitAngle: number,
    weaponStart: THREE.Vector3,
    weaponEnd: THREE.Vector3,
    _bladePitch: number,
  ): void {
    if (!this._active || !this._mesh) {
      return;
    }

    const frameIndex = Math.min(
      FRAME_COUNT - 1,
      Math.floor(Math.min(Math.max(swingProgress, 0), 0.999) * FRAME_COUNT),
    );

    if (this._texture) {
      applyFrameUV(this._texture, frameIndex);
    }

    _scratchPos.copy(weaponStart).lerp(weaponEnd, BLADE_ALONG_T);
    _scratchPos.y = weaponStart.y + SLASH_Y_LIFT;
    this._mesh.position.copy(_scratchPos);

    this._setSlashOrientation(displayOrbitAngle);

    const bladeLen = weaponStart.distanceTo(weaponEnd);
    const size = Math.max(bladeLen * BLADE_LENGTH_SCALE, SLASH_MIN_SIZE) * this._finisherScale;
    const flip = this._sweepSign;
    this._mesh.scale.set(size * this._frameAspect * SLASH_WIDTH_SCALE * flip, size, 1);
  }

  public endSwing(): void {
    this._active = false;
    this._applyVisibility(false);
  }

  public override endPlay(): void {
    if (this._mesh) {
      this._mesh.visible = false;
      this._mesh.material.dispose();
      this._mesh.geometry.dispose();
      this._mesh.removeFromParent();
      this._mesh = null;
    }
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
    super.endPlay();
  }

  /**
   * Lay flat on the ground (XZ), then yaw with the blade — visible from isometric camera.
   */
  private _setSlashOrientation(orbitAngle: number): void {
    if (!this._mesh) {
      return;
    }

    const yaw =
      -orbitAngle + BLADE_ANGLE_OFFSET + SLASH_TEXTURE_YAW_OFFSET;

    _quatFlat.setFromAxisAngle(_X_AXIS, -Math.PI / 2);
    _quatYaw.setFromAxisAngle(_Y_AXIS, yaw);
    this._mesh.quaternion.copy(_quatYaw).multiply(_quatFlat);
  }

  private _applyVisibility(visible: boolean): void {
    if (this._mesh) {
      this._mesh.visible = visible;
    }
  }

  private async _loadTexture(): Promise<void> {
    if (this._texture) {
      return;
    }

    try {
      const resolvedPath = await ENGINE.resolveAssetPathsInText(SLASH_SPRITESHEET_PATH);
      this._texture = await new Promise<THREE.Texture>((resolve, reject) => {
        new THREE.TextureLoader().load(
          resolvedPath,
          (texture) => {
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            resolve(texture);
          },
          undefined,
          (err) => reject(err),
        );
      });

      const image = this._texture.image as { width?: number; height?: number } | undefined;
      if (image?.width && image?.height) {
        this._frameAspect = image.width / FRAME_COUNT / image.height;
      }
    } catch (e) {
      console.warn('[WeaponSlashSpriteComponent] Failed to load slash spritesheet:', e);
    }
  }

  private _buildMesh(): void {
    const world = this.getWorld();
    if (!world || this._mesh) {
      return;
    }

    const geometry = new THREE.PlaneGeometry(this._frameAspect, 1);
    const material = new THREE.MeshBasicMaterial({
      map: this._texture ?? undefined,
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      alphaTest: this._texture ? 0.1 : 0,
    });

    if (this._texture) {
      applyFrameUV(this._texture, 0);
      applyBlackKeyCutout(material);
    } else {
      material.color.setHex(0x00e8ff);
    }

    this._mesh = new THREE.Mesh(geometry, material);
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 20;
    world.scene.add(this._mesh);
    this._applyVisibility(this._active);
  }
}
