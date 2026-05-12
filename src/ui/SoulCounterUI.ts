/**
 * SoulCounterUI - Displays the collected soul count with image background.
 *
 * Singleton pattern - only one instance exists per world.
 * Creates HTML elements in the game container.
 */
import * as ENGINE from '@gnsx/genesys.js';

const SOULS_BG_URL = '@project/assets/UI/SoulsBG.png';
const FONT_URL = '@project/assets/UI/Bree_Serif/BreeSerif-Regular.ttf';

// Background dimensions
const BG_WIDTH = 688;
const BG_HEIGHT = 302;

// Scale factor to fit on screen
const UI_SCALE = 0.35;

export class SoulCounterUI {
  private static instances: Map<ENGINE.World, SoulCounterUI> = new Map();

  private _container: HTMLDivElement | null = null;
  private _countDisplay: HTMLSpanElement | null = null;
  private _count = 0;
  private _initialized = false;

  /**
   * Get or create the SoulCounterUI singleton for the given world.
   */
  public static async getInstance(world: ENGINE.World | null): Promise<SoulCounterUI> {
    if (!world) {
      return new SoulCounterUI(null);
    }

    let instance = SoulCounterUI.instances.get(world);
    if (!instance) {
      instance = new SoulCounterUI(world);
      SoulCounterUI.instances.set(world, instance);
      await instance._initializeAsync();
    }
    return instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;

    const gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer;
    if (!gameContainer) return;

    // Inject custom font
    const fontFace = document.createElement('style');
    fontFace.textContent = `
      @font-face {
        font-family: 'BreeSerif';
        src: url('${FONT_URL}') format('truetype');
        font-weight: normal;
        font-style: normal;
      }
    `;
    document.head.appendChild(fontFace);

    // Main container - positioned bottom-right
    this._container = document.createElement('div');
    this._container.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: ${BG_WIDTH * UI_SCALE}px;
      height: ${BG_HEIGHT * UI_SCALE}px;
      pointer-events: none;
      user-select: none;
      z-index: 1000;
      display: none;
      background-size: 100% 100%;
      background-repeat: no-repeat;
      transition: transform 0.15s ease, opacity 0.3s ease;
      will-change: transform, opacity;
    `;

    // Count display - positioned inside the frame
    this._countDisplay = document.createElement('span');
    this._countDisplay.style.cssText = `
      position: absolute;
      right: 80px;
      top: 52%;
      transform: translateY(-50%);
      font-family: 'BreeSerif', serif;
      font-size: ${90 * UI_SCALE}px;
      font-weight: bold;
      color: #ffffff;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(255, 255, 255, 0.3);
      will-change: transform;
    `;
    this._countDisplay.textContent = '0';

    this._container.appendChild(this._countDisplay);
    gameContainer.appendChild(this._container);
  }

  /**
   * Asynchronously resolve asset paths and apply them.
   */
  private async _initializeAsync(): Promise<void> {
    if (!this._container) return;

    // Resolve background image path
    const cssString = `.bg { background-image: url("${SOULS_BG_URL}"); }`;
    const resolvedCss = await ENGINE.resolveAssetPathsInText(cssString);
    const bgMatch = resolvedCss.match(/\.bg\s*\{\s*background-image:\s*url\("([^"]+)"\);/);

    if (bgMatch) {
      this._container.style.backgroundImage = `url("${bgMatch[1]}")`;
    }

    // Resolve font path and update stylesheet
    const fontStyle = document.querySelector('style');
    if (fontStyle && fontStyle.textContent?.includes(FONT_URL)) {
      const resolvedFont = await ENGINE.resolveAssetPathsInText(`url("${FONT_URL}")`);
      const fontMatch = resolvedFont.match(/url\("([^"]+)"\)/);
      if (fontMatch) {
        fontStyle.textContent = fontStyle.textContent.replace(FONT_URL, fontMatch[1]);
      }
    }

    // Show the container with fade
    this._container.style.opacity = '0';
    this._container.style.display = 'block';
    requestAnimationFrame(() => {
      if (this._container) {
        this._container.style.transition = 'opacity 0.3s ease, transform 0.15s ease';
        this._container.style.opacity = '1';
      }
    });
    this._initialized = true;
  }

  /**
   * Increment the soul counter and update the display with bounce animation.
   */
  public increment(): void {
    this._count++;
    this._updateDisplay();
    this._bounceAnimation();
  }

  private _bounceAnimation(): void {
    if (!this._countDisplay) return;

    // Number pop up
    this._countDisplay.style.transition = 'none';
    this._countDisplay.style.transform = 'translateY(-50%) scale(1.3)';

    // Spring back down
    requestAnimationFrame(() => {
      if (!this._countDisplay) return;
      this._countDisplay.style.transition = 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
      this._countDisplay.style.transform = 'translateY(-50%) scale(1)';
    });

    // Container subtle shake
    if (this._container) {
      this._container.style.transform = 'scale(1.02)';
      setTimeout(() => {
        if (this._container) {
          this._container.style.transform = 'scale(1)';
        }
      }, 100);
    }
  }

  /**
   * Get the current soul count.
   */
  public getCount(): number {
    return this._count;
  }

  /**
   * Set the soul count (for loading saved games, etc.).
   */
  public setCount(count: number): void {
    this._count = count;
    this._updateDisplay();
  }

  private _updateDisplay(): void {
    if (!this._countDisplay) return;
    this._countDisplay.textContent = this._count.toString();
  }

  /**
   * Clean up and remove the UI element.
   */
  public destroy(): void {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
    this._countDisplay = null;
    this._initialized = false;
  }
}
