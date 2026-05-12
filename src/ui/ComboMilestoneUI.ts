/**
 * ComboMilestoneUI - Displays special combo milestone images (10x, 20x, etc.)
 *
 * Shows at top-center with escalating animations based on milestone tier.
 */
import * as ENGINE from '@gnsx/genesys.js';

const MILESTONES = [
  { threshold: 10, image: '@project/assets/UI/Combo-10x 2.png', tier: 'bronze' },
  { threshold: 20, image: '@project/assets/UI/Combo-20x 2.png', tier: 'bronze' },
  { threshold: 30, image: '@project/assets/UI/Combo-30x 2.png', tier: 'silver' },
  { threshold: 40, image: '@project/assets/UI/Combo-40x 2.png', tier: 'silver' },
  { threshold: 50, image: '@project/assets/UI/Combo-50x 2.png', tier: 'silver' },
  { threshold: 75, image: '@project/assets/UI/Combo-75x 2.png', tier: 'gold' },
  { threshold: 100, image: '@project/assets/UI/Combo-100x 2.png', tier: 'gold' },
  { threshold: 150, image: '@project/assets/UI/Combo-150x 2.png', tier: 'gold' },
  { threshold: 200, image: '@project/assets/UI/Combo-200x 2.png', tier: 'epic' },
  { threshold: 250, image: '@project/assets/UI/Combo-250x 2.png', tier: 'epic' },
  { threshold: 500, image: '@project/assets/UI/Combo-500x 2.png', tier: 'legendary' },
  { threshold: 999, image: '@project/assets/UI/Combo-999x 2.png', tier: 'legendary' },
] as const;

const UI_SCALE = 0.3;
const IMG_SIZE = 512;
const DISPLAY_DURATION = 2500;

export class ComboMilestoneUI {
  private static _instance: ComboMilestoneUI | null = null;
  private static _initPromise: Promise<ComboMilestoneUI> | null = null;

  private _world: ENGINE.World | null = null;
  private _gameContainer: HTMLElement | null = null;
  private _milestoneContainer: HTMLDivElement | null = null;
  private _resolvedUrls: Map<string, string> = new Map();
  private _lastShownThreshold = 0;
  private _isShowing = false;
  private _initialized = false;

  public static getInstance(world: ENGINE.World | null): ComboMilestoneUI {
    if (!ComboMilestoneUI._instance) {
      if (!world) throw new Error('World required to initialize ComboMilestoneUI');
      ComboMilestoneUI._instance = new ComboMilestoneUI(world);
      ComboMilestoneUI._initPromise = ComboMilestoneUI._instance._initializeAsync().then(() => ComboMilestoneUI._instance!);
    }
    return ComboMilestoneUI._instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;
    this._world = world;
    this._gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer ?? null;
  }

  private async _initializeAsync(): Promise<void> {
    if (!this._gameContainer || this._initialized) return;

    // Pre-resolve all milestone image URLs
    await this._resolveAllUrls();

    // Create milestone display container (centered at top)
    this._milestoneContainer = document.createElement('div');
    this._milestoneContainer.style.cssText = `
      position: absolute;
      left: 50%;
      top: ${80 * UI_SCALE}px;
      transform: translateX(-50%);
      width: ${IMG_SIZE * UI_SCALE}px;
      height: ${IMG_SIZE * UI_SCALE}px;
      pointer-events: none;
      user-select: none;
      z-index: 2000;
      will-change: transform, opacity;
      display: none;
      background-size: 100% 100%;
      background-repeat: no-repeat;
    `;

    this._gameContainer.appendChild(this._milestoneContainer);
    this._initialized = true;
  }

  private async _resolveAllUrls(): Promise<void> {
    for (const m of MILESTONES) {
      const css = `.bg { background-image: url("${m.image}"); }`;
      const resolved = await ENGINE.resolveAssetPathsInText(css);
      const match = resolved.match(/url\("([^"]+)"\)/);
      if (match) {
        this._resolvedUrls.set(m.image, match[1]);
      }
    }
  }

  /**
   * Check combo count and trigger milestone if a new threshold is reached.
   * Called by ComboMeterTracker when a kill is recorded.
   */
  public checkAndTrigger(combo: number): void {
    // Wait for initialization if needed
    if (!this._initialized) {
      void ComboMilestoneUI._initPromise?.then(() => this.checkAndTrigger(combo));
      return;
    }

    if (!this._milestoneContainer || this._isShowing) return;

    // Find highest milestone reached
    let targetMilestone: typeof MILESTONES[number] | null = null;
    for (const m of MILESTONES) {
      if (combo >= m.threshold && m.threshold > this._lastShownThreshold) {
        targetMilestone = m;
      }
    }

    if (!targetMilestone) return;

    this._lastShownThreshold = targetMilestone.threshold;
    this._isShowing = true;

    const url = this._resolvedUrls.get(targetMilestone.image) || '';
    this._milestoneContainer.style.backgroundImage = `url("${url}")`;
    this._milestoneContainer.style.display = 'block';

    // Entry animation based on tier
    const entryAnim = this._getEntryAnimation(targetMilestone.tier);
    const effectAnim = this._getEffectAnimation(targetMilestone.tier);

    // Play entry
    this._milestoneContainer.animate(entryAnim.keyframes, {
      duration: entryAnim.duration,
      easing: entryAnim.easing,
      fill: 'forwards',
    });

    // Effects (glow/shake) for higher tiers
    if (effectAnim) {
      setTimeout(() => {
        this._milestoneContainer?.animate(effectAnim.keyframes, {
          duration: effectAnim.duration,
          easing: effectAnim.easing,
          iterations: effectAnim.iterations,
        });
      }, entryAnim.duration * 0.5);
    }

    // Screen flash for legendary
    if (targetMilestone.tier === 'legendary') {
      this._screenFlash();
    }

    // Exit after duration
    setTimeout(() => {
      this._hideMilestone();
    }, DISPLAY_DURATION);
  }

  private _getEntryAnimation(tier: string) {
    const base = {
      bronze: { scale: [0.3, 1.1, 1], duration: 400 },
      silver: { scale: [0.2, 1.3, 1], duration: 500 },
      gold: { scale: [0.15, 1.4, 0.95, 1], duration: 600 },
      epic: { scale: [0.1, 1.5, 0.9, 1.1, 1], duration: 700 },
      legendary: { scale: [0.05, 1.6, 0.85, 1.15, 1], duration: 800 },
    }[tier] || { scale: [0.3, 1], duration: 400 };

    return {
      keyframes: base.scale.map((s, i) => ({
        transform: `translateX(-50%) scale(${s})`,
        opacity: i === 0 ? 0 : 1,
      })),
      duration: base.duration,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    };
  }

  private _getEffectAnimation(tier: string) {
    if (tier === 'bronze') return null;

    if (tier === 'silver' || tier === 'gold') {
      return {
        keyframes: [
          { filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,200,100,0))' },
          { filter: 'brightness(1.3) drop-shadow(0 0 20px rgba(255,200,100,0.8))' },
          { filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,200,100,0))' },
        ],
        duration: 600,
        easing: 'ease-in-out',
        iterations: 2,
      };
    }

    // epic, legendary
    return {
      keyframes: [
        { filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,100,255,0))', transform: 'translateX(-50%) rotate(0deg)' },
        { filter: 'brightness(1.5) drop-shadow(0 0 30px rgba(255,100,255,1))', transform: 'translateX(-50%) rotate(-3deg)' },
        { filter: 'brightness(1.2) drop-shadow(0 0 20px rgba(255,100,255,0.6))', transform: 'translateX(-50%) rotate(3deg)' },
        { filter: 'brightness(1.5) drop-shadow(0 0 30px rgba(255,100,255,1))', transform: 'translateX(-50%) rotate(-2deg)' },
        { filter: 'brightness(1) drop-shadow(0 0 0 rgba(255,100,255,0))', transform: 'translateX(-50%) rotate(0deg)' },
      ],
      duration: 400,
      easing: 'ease-in-out',
      iterations: 3,
    };
  }

  private _screenFlash(): void {
    if (!this._gameContainer) return;

    const flash = document.createElement('div');
    flash.style.cssText = `
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at 50% 30%, rgba(255, 200, 100, 0.4), transparent 70%);
      pointer-events: none;
      z-index: 1999;
      opacity: 0;
    `;
    this._gameContainer.appendChild(flash);

    flash.animate([
      { opacity: 0 },
      { opacity: 1 },
      { opacity: 0 },
    ], {
      duration: 400,
      easing: 'ease-out',
    }).onfinish = () => flash.remove();
  }

  private _hideMilestone(): void {
    if (!this._milestoneContainer) return;

    this._milestoneContainer.animate([
      { transform: 'translateX(-50%) scale(1)', opacity: 1 },
      { transform: 'translateX(-50%) scale(0.8)', opacity: 0 },
    ], {
      duration: 300,
      easing: 'ease-in',
      fill: 'forwards',
    }).onfinish = () => {
      if (this._milestoneContainer) {
        this._milestoneContainer.style.display = 'none';
        this._isShowing = false;
      }
    };
  }

  public reset(): void {
    this._lastShownThreshold = 0;
    this._isShowing = false;
    if (this._milestoneContainer) {
      this._milestoneContainer.style.display = 'none';
    }
  }

  public destroy(): void {
    this._milestoneContainer?.remove();
    this._milestoneContainer = null;
    ComboMilestoneUI._instance = null;
    ComboMilestoneUI._initPromise = null;
  }
}
