/**
 * Scene actor that enables a CSS film-grain overlay on the game container.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { FilmGrainComponent, type FilmGrainComponentOptions } from './FilmGrainComponent.js';

export type FilmGrainActorOptions = ENGINE.ActorOptions & FilmGrainComponentOptions;

@ENGINE.GameClass()
export class FilmGrainActor extends ENGINE.Actor {
  public override initialize(options?: FilmGrainActorOptions): void {
    super.initialize(options);
    const component = FilmGrainComponent.create({ name: 'FilmGrain', ...options });
    this.add(component);
  }

  public getFilmGrainComponent(): FilmGrainComponent | null {
    return this.getNode(FilmGrainComponent);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Vfx';
  }
}
