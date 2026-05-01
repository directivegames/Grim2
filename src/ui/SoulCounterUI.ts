/**
 * SoulCounterUI - Displays the collected soul count.
 *
 * Singleton pattern - only one instance exists per world.
 * Creates an HTML element in the game container.
 */
import * as ENGINE from '@gnsx/genesys.js';

export class SoulCounterUI {
  private static instances: Map<ENGINE.World, SoulCounterUI> = new Map();

  private _element: HTMLDivElement | null = null;
  private _count = 0;

  /**
   * Get or create the SoulCounterUI singleton for the given world.
   */
  public static getInstance(world: ENGINE.World | null): SoulCounterUI {
    if (!world) {
      // Return a dummy instance if no world (shouldn't happen in normal gameplay)
      return new SoulCounterUI(null);
    }

    let instance = SoulCounterUI.instances.get(world);
    if (!instance) {
      instance = new SoulCounterUI(world);
      SoulCounterUI.instances.set(world, instance);
    }
    return instance;
  }

  private constructor(world: ENGINE.World | null) {
    if (!world) return;

    // Create the UI element
    this._element = document.createElement('div');
    this._element.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      padding: 10px 20px;
      background: rgba(0, 0, 0, 0.6);
      border: 2px solid #4a90d9;
      border-radius: 8px;
      color: #4a90d9;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 24px;
      font-weight: bold;
      pointer-events: none;
      user-select: none;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 10px;
    `;

    // Soul icon (crescent moon symbol)
    const icon = document.createElement('span');
    icon.textContent = '☽';
    icon.style.fontSize = '28px';

    // Count display
    const countDisplay = document.createElement('span');
    countDisplay.id = 'soul-count';
    countDisplay.textContent = '0';

    this._element.appendChild(icon);
    this._element.appendChild(countDisplay);

    // Add to game container
    const gameContainer = (world as unknown as { gameContainer?: HTMLElement }).gameContainer;
    if (gameContainer) {
      gameContainer.appendChild(this._element);
    }
  }

  /**
   * Increment the soul counter and update the display.
   */
  public increment(): void {
    this._count++;
    this._updateDisplay();
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
    if (!this._element) return;

    const countDisplay = this._element.querySelector('#soul-count');
    if (countDisplay) {
      countDisplay.textContent = this._count.toString();
    }
  }

  /**
   * Clean up and remove the UI element.
   */
  public destroy(): void {
    if (this._element && this._element.parentNode) {
      this._element.parentNode.removeChild(this._element);
    }
    this._element = null;
  }
}
