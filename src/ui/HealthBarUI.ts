/**
 * HealthBarUI - Displays the player's health bar.
 *
 * Singleton pattern - only one instance exists per world.
 * Creates HTML elements in the game container.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const HEALTH_BG_URL = '@project/assets/UI/HealthBG.png';
const HEALTH_FILL_URL = '@project/assets/UI/HealthBar.png';

// Bar dimensions (from HealthBar.png/HealthBG.png)
const BAR_WIDTH = 862;
const BAR_HEIGHT = 235;

// Scale factor to fit on screen (adjust as needed)
const UI_SCALE = 0.35;

export class HealthBarUI {
  private static instances: Map<ENGINE.World, HealthBarUI> = new Map();

  private _container: HTMLDivElement | null = null;
  private _bgElement: HTMLDivElement | null = null;
  private _fillElement: HTMLDivElement | null = null;
  private _currentHealth = 100;
  private _maxHealth = 100;
  private _targetHealthPercent = 1;
  private _displayedHealthPercent = 1;
  private _initialized = false;

  /**
   * Get or create the HealthBarUI singleton for the given world.
   */
  public static async getInstance(world: ENGINE.World | null): Promise<HealthBarUI> {
    if (!world) {
      return new HealthBarUI(null);
    }

    let instance = HealthBarUI.instances.get(world);
    if (!instance) {
      instance = new HealthBarUI(world);
      HealthBarUI.instances.set(world, instance);
      await instance._initializeAsync();
    }
    return instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;

    const gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer;
    if (!gameContainer) return;

    // Main container - positioned bottom-left
    this._container = document.createElement('div');
    this._container.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 20px;
      width: ${BAR_WIDTH * UI_SCALE}px;
      height: ${BAR_HEIGHT * UI_SCALE}px;
      pointer-events: none;
      user-select: none;
      z-index: 1001;
      display: none; /* Hidden until assets loaded */
    `;

    // Background layer (empty bar)
    this._bgElement = document.createElement('div');
    this._bgElement.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-size: 100% 100%;
      background-repeat: no-repeat;
    `;

    // Fill layer (current health) - clipped with clip-path
    this._fillElement = document.createElement('div');
    this._fillElement.style.cssText = `
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-size: 100% 100%;
      background-repeat: no-repeat;
      clip-path: inset(0 0 0 0);
    `;

    this._container.appendChild(this._bgElement);
    this._container.appendChild(this._fillElement);

    gameContainer.appendChild(this._container);
  }

  /**
   * Asynchronously resolve asset paths and apply them.
   */
  private async _initializeAsync(): Promise<void> {
    if (!this._bgElement || !this._fillElement) return;

    // Build CSS with @project paths and resolve them
    const cssString = `
      .bg { background-image: url("${HEALTH_BG_URL}"); }
      .fill { background-image: url("${HEALTH_FILL_URL}"); }
    `;

    const resolvedCss = await ENGINE.resolveAssetPathsInText(cssString);

    // Extract resolved URLs
    const bgMatch = resolvedCss.match(/\.bg\s*\{\s*background-image:\s*url\("([^"]+)"\);/);
    const fillMatch = resolvedCss.match(/\.fill\s*\{\s*background-image:\s*url\("([^"]+)"\);/);

    if (bgMatch) this._bgElement.style.backgroundImage = `url("${bgMatch[1]}")`;
    if (fillMatch) this._fillElement.style.backgroundImage = `url("${fillMatch[1]}")`;

    // Show the container
    if (this._container) {
      this._container.style.display = 'block';
    }
    this._initialized = true;
  }

  /**
   * Update the health display with animation.
   * Called from player pawn on health changes.
   */
  public updateHealth(current: number, max: number): void {
    this._currentHealth = current;
    this._maxHealth = max;
    this._targetHealthPercent = Math.max(0, Math.min(1, current / max));
  }

  /**
   * Called every frame to animate the health bar fill.
   */
  public tick(deltaTime: number): void {
    if (!this._fillElement || !this._initialized) return;

    // Smooth lerp toward target health percentage
    const lerpSpeed = 8; // Adjust for faster/slower animation
    this._displayedHealthPercent = THREE.MathUtils.lerp(
      this._displayedHealthPercent,
      this._targetHealthPercent,
      lerpSpeed * deltaTime
    );

    // Clamp to prevent tiny floating point issues
    if (Math.abs(this._displayedHealthPercent - this._targetHealthPercent) < 0.001) {
      this._displayedHealthPercent = this._targetHealthPercent;
    }

    // Update clip-path: inset(right, top, left, bottom)
    // Health drains from right, so we clip from the right
    const clipRight = (1 - this._displayedHealthPercent) * 100;
    this._fillElement.style.clipPath = `inset(0 ${clipRight}% 0 0)`;
  }

  /**
   * Get current displayed health percentage (0-1).
   */
  public getHealthPercent(): number {
    return this._displayedHealthPercent;
  }

  /**
   * Clean up and remove the UI element.
   */
  public destroy(): void {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
    this._bgElement = null;
    this._fillElement = null;
    this._initialized = false;
  }
}
