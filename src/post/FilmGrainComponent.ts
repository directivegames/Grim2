/**
 * Scene component that drives the HTML film-grain overlay on the game container.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  DEFAULT_FILM_GRAIN_SETTINGS,
  FilmGrainUI,
} from '../ui/FilmGrainUI.js';

import type { EditorPropertyChangedResult } from '@gnsx/genesys.js';

export type FilmGrainComponentOptions = ENGINE.SceneComponentOptions & {
  enabled?: boolean;
  opacity?: number;
  baseFrequency?: number;
  numOctaves?: number;
  animated?: boolean;
  blendMode?: string;
};

@ENGINE.GameClass()
export class FilmGrainComponent extends ENGINE.SceneComponent {
  @ENGINE.property({ type: 'boolean', category: 'Film Grain', description: 'Enable film grain overlay' })
  public override enabled: boolean = DEFAULT_FILM_GRAIN_SETTINGS.enabled;

  @ENGINE.property({
    type: 'number',
    min: 0,
    max: 0.5,
    step: 0.005,
    category: 'Film Grain',
    description: 'Grain overlay opacity',
  })
  public opacity: number = DEFAULT_FILM_GRAIN_SETTINGS.opacity;

  @ENGINE.property({
    type: 'number',
    min: 0.1,
    max: 2,
    step: 0.01,
    category: 'Film Grain',
    description: 'Grain tile scale (lower = coarser / larger tiles)',
  })
  public baseFrequency: number = DEFAULT_FILM_GRAIN_SETTINGS.baseFrequency;

  @ENGINE.property({
    type: 'number',
    min: 1,
    max: 5,
    step: 1,
    category: 'Film Grain',
    description: 'Flicker speed (higher = faster frame changes)',
  })
  public numOctaves: number = DEFAULT_FILM_GRAIN_SETTINGS.numOctaves;

  @ENGINE.property({ type: 'boolean', category: 'Film Grain', description: 'Animate grain each frame' })
  public animated: boolean = DEFAULT_FILM_GRAIN_SETTINGS.animated;

  @ENGINE.property({
    type: 'string',
    category: 'Film Grain',
    description: 'CSS mix-blend-mode (overlay, normal, screen, multiply)',
  })
  public blendMode: string = DEFAULT_FILM_GRAIN_SETTINGS.blendMode;

  public override initialize(options?: FilmGrainComponentOptions): void {
    super.initialize(options);
    if (options?.enabled !== undefined) this.enabled = options.enabled;
    if (options?.opacity !== undefined) this.opacity = options.opacity;
    if (options?.baseFrequency !== undefined) this.baseFrequency = options.baseFrequency;
    if (options?.numOctaves !== undefined) this.numOctaves = options.numOctaves;
    if (options?.animated !== undefined) this.animated = options.animated;
    if (options?.blendMode !== undefined) this.blendMode = options.blendMode;
  }

  private _retrySeconds = 0;
  private _grainAttached = false;

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }this._syncGrain();
  
    return true;
  }

  public override onEditorAddToWorld(): void {
    super.onEditorAddToWorld();
    this._syncGrain();
  }

  public override onEditorPropertyChanged(
    _path: string,
    _value: unknown,
    result: EditorPropertyChangedResult,
  ): void {
    super.onEditorPropertyChanged(_path, _value, result);
    this._syncGrain();
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (this._grainAttached) {
      return;
    }

    this._retrySeconds += deltaTime;
    if (this._retrySeconds > 3) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }

    const ui = FilmGrainUI.attach(world, this._settings());
    if (ui.isAttached) {
      this._grainAttached = true;
    }
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    const world = this.getWorld();
    if (world) {
      FilmGrainUI.detach(world);
    }
    return true;
  }

  private _settings() {
    return {
      enabled: this.enabled,
      opacity: this.opacity,
      baseFrequency: this.baseFrequency,
      numOctaves: this.numOctaves,
      animated: this.animated,
      blendMode: this.blendMode,
    };
  }

  private _syncGrain(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    FilmGrainUI.attach(world, this._settings());
  }
}
