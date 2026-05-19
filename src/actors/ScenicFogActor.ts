/**
 * Scenic fog card — large atmospheric fog volumes using the TSL fog-card shader.
 * Complements GroundFogActor (close-up drifting puffs).
 */

import * as ENGINE from '@gnsx/genesys.js';

import { FogSystemActor, type FogSystemActorOptions } from '../fog/FogSystemActor.js';

@ENGINE.GameClass()
export class ScenicFogActor extends FogSystemActor {
  public override initialize(options?: FogSystemActorOptions): void {
    super.initialize({
      settings: {
        baseColorTint: '#7080a0',
        atmosphereColor: '#8090b8',
        useAtmosphereColor: 0.6,
        fogDensity: 0.32,
        emissiveIntensity: 0.22,
        flowMapSpeed: 0.12,
        flowMapIntensity: 0.8,
        cameraFadingDistance: 2.5,
        viewAngleFade: 0.15,
      },
      ...options,
    });

    const fog = this.getFogComponent();
    if (fog) {
      fog.debugLogging = false;
      fog.renderOrder = 10;
      fog.updateFogValues();
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_VFX';
  }
}
