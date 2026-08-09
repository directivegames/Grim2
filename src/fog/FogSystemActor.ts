/**
 * Fog-system actor wrapper.
 *
 * Owns a single fog-card component.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { FogSystemComponent, type FogSystemComponentOptions } from './FogSystemComponent.js';
import type { FogCardSettings } from './FogCardMaterial.js';

export interface FogSystemActorOptions extends ENGINE.ActorOptions, FogSystemComponentOptions {}

@ENGINE.GameClass()
export class FogSystemActor extends ENGINE.Actor {
  public override initialize(options?: FogSystemActorOptions): void {
    super.initialize(options);
    const component = FogSystemComponent.create({ name: 'FogSystem', ...options });
    this.add(component);
  }

  public getFogComponent(): FogSystemComponent | null {
    return this.getNode(FogSystemComponent);
  }

  public updateSettings(partial: Partial<FogCardSettings>): void {
    this.getFogComponent()?.updateSettings(partial);
  }

  public updateFogValues(): void {
    this.getFogComponent()?.updateFogValues();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Fog';
  }
}
