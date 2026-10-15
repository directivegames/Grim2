import * as ENGINE from '@gnsx/genesys.js';

import { BAG_ICON_SVG, accentButtonStyles } from './store-icons.js';

export interface StoreHudButtonOptions extends ENGINE.BaseUIComponentOptions {
  /** Hotkey shown as a Keystroke chip; null hides the chip. */
  hotkey?: string | null;
  /** Accent color for the Shop button; null keeps the kit primary blue. */
  accent?: string | null;
  onOpen?: () => void;
}

/**
 * Always-visible HUD chip: a Shop button and the hotkey hint. The balance
 * lives inside the panel (decision: keep the HUD minimal).
 * Composes ENGINE.Button and ENGINE.Keystroke; nothing is hand-rolled.
 */
export class StoreHudButton extends ENGINE.BaseUIComponent<StoreHudButtonOptions> {
  private openSlot: HTMLElement | null = null;
  private keySlot: HTMLElement | null = null;
  private openButton: ENGINE.Button | null = null;
  private keystroke: ENGINE.Keystroke | null = null;

  protected override getAssetPaths(): { templatePath: string; stylesPath: string } {
    return {
      templatePath: '@project/assets/ui/store/store-hud-button.html',
      stylesPath: '@project/assets/ui/store/store-hud-button.css',
    };
  }

  protected override getDefaultOptions(): Required<StoreHudButtonOptions> {
    return {
      position: 'top-right',
      visible: true,
      customClasses: [],
      customStyles: {},
      hotkey: 'b',
      accent: null,
      onOpen: () => undefined,
    };
  }

  protected override getInitialData(): Record<string, unknown> {
    return {};
  }

  protected override cacheElements(): void {
    if (!this.layout) return;
    this.openSlot = this.layout.querySelector('[data-store-hud-open-slot]');
    this.keySlot = this.layout.querySelector('[data-store-hud-key-slot]');
  }

  protected override async onInitialize(): Promise<void> {
    if (!this.openSlot || !this.keySlot) throw new Error('Store HUD template is missing its slots.');
    // The engine's HUD row spans the screen; tell the CSS which side to hug.
    const root = this.layout?.querySelector('[data-store-hud]');
    root?.setAttribute('data-store-hud-side', this.options.position.endsWith('right') ? 'right' : 'left');

    this.openButton = await this.mountChild(
      ENGINE.Button,
      {
        label: 'Shop',
        variant: 'primary',
        size: 'medium',
        icon: BAG_ICON_SVG,
        customStyles: accentButtonStyles(this.options.accent),
        onClick: () => this.options.onOpen(),
      },
      this.openSlot,
    );

    if (this.options.hotkey) {
      this.keystroke = await this.mountChild(
        ENGINE.Keystroke,
        { key: this.options.hotkey.toUpperCase(), size: 'small' },
        this.keySlot,
      );
    }
  }

  protected override onDestroy(): void {
    this.openButton = null;
    this.keystroke = null;
    this.openSlot = null;
    this.keySlot = null;
  }
}
