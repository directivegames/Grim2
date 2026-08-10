/**
 * Scene actor that enables slow-moving world-space cloud shadows.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  CloudShadowComponent,
  type CloudShadowComponentOptions,
} from './CloudShadowComponent.js';

export type CloudShadowActorOptions = ENGINE.ActorOptions & CloudShadowComponentOptions;

@ENGINE.GameClass()
export class CloudShadowActor extends ENGINE.Actor {
  public override initialize(options?: CloudShadowActorOptions): void {
    super.initialize(options);
    const component = CloudShadowComponent.create({ name: 'CloudShadow', ...options });
    this.add(component);
  }

  public getCloudShadowComponent(): CloudShadowComponent | null {
    return this.getNode(CloudShadowComponent);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Light';
  }
}
