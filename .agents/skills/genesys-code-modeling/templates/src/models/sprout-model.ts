import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { GlbModel } from './glb-model.js';

/**
 * The sprout from assets/models/sprout.glb (built in tools/models/sprout.ts). Pivots: rig → head,
 * leg_l, leg_r. Visual only: the enemy, pickup or pawn that owns it carries collision and isRoot.
 */
@ENGINE.GameClass()
export class SproutModel extends GlbModel {
  public lookTarget: THREE.Vector3 | null = null; // world point the head turns toward
  private head: THREE.Object3D | null = null;
  private legL: THREE.Object3D | null = null;
  private legR: THREE.Object3D | null = null;
  private readonly prev = new THREE.Vector3(); // scratch vectors: no allocation per frame
  private readonly now = new THREE.Vector3();
  private phase = 0;
  private deadFor = -1; // < 0 = alive

  protected glbPath(): string {
    return '@project/assets/models/sprout.glb';
  }

  protected onRigReady(): void {
    this.head = this.part('head');
    this.legL = this.part('leg_l');
    this.legR = this.part('leg_r');
    this.getWorldPosition(this.prev);
  }

  public hitFlash(): void { this.flash(0.12); }
  public die(): void { this.deadFor = 0; }

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    const { rig, head, legL, legR } = this;
    if (dt <= 0 || !rig || !head || !legL || !legR) return; // GLB still loading
    if (this.deadFor >= 0) { // tip forward 90° and shrink to 50 % over 0.4 s
      const k = Math.min((this.deadFor += dt) / 0.4, 1);
      rig.rotation.x = -k * Math.PI / 2;
      rig.scale.setScalar(1 - 0.5 * k);
      return;
    }
    this.getWorldPosition(this.now);
    const speed = Math.hypot(this.now.x - this.prev.x, this.now.z - this.prev.z) / dt;
    this.prev.copy(this.now);
    const move = Math.min(speed / 3, 1); // 0 = idle, 1 = full stride at 3 m/s
    this.phase += dt * (4 + speed * 3); // stride rate follows speed
    const swing = Math.sin(this.phase) * 0.7 * move;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    rig.position.y = 0.05 * Math.abs(Math.sin(this.phase)) * move;
    const sy = 1 + 0.03 * Math.sin((this.getWorld()?.getGameTime() ?? 0) * 2.2) * (1 - move); // idle breath
    rig.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy)); // squash keeps volume
    if (this.lookTarget) {
      rig.worldToLocal(this.now.copy(this.lookTarget));
      const yaw = Math.atan2(-(this.now.x - head.position.x), -(this.now.z - head.position.z));
      head.rotation.y = THREE.MathUtils.damp(head.rotation.y, THREE.MathUtils.clamp(yaw, -1, 1), 8, dt);
    }
  }
}
