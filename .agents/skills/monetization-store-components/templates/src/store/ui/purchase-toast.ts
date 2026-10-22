import * as ENGINE from '@gnsx/genesys.js';

import { CHECK_ICON_SVG, formatCoins } from './store-icons.js';

/** Purchase feedback on top of the kit Achievement toast (top-right slide-in). */
export class PurchaseToast {
  private achievement: ENGINE.Achievement | null = null;

  public async initialize(uiManager: ENGINE.UIManager): Promise<void> {
    this.achievement = new ENGINE.Achievement(uiManager, { position: 'top-right', visible: false });
    await this.achievement.initialize();
  }

  public showPurchased(itemName: string, coins: number | null): void {
    this.show(`${itemName} is yours`, coins === null ? 'Added to your inventory for this game.' : `−${formatCoins(coins)} Silicon · added to your inventory.`);
  }

  /** The purchase is still being processed: no charge confirmation yet, and no need to buy again. */
  public showProcessing(itemName: string): void {
    this.show(`${itemName}: purchase processing`, 'It appears in your inventory once it goes through.');
  }

  public showClaimed(itemName: string): void {
    this.show(`${itemName} claimed`, 'Added to your inventory for this game.');
  }

  public showConsumed(itemName: string, remaining: number): void {
    this.show(`${itemName} used`, remaining > 0 ? `${remaining} left.` : 'That was the last one.');
  }

  private show(title: string, description: string): void {
    this.achievement?.show({ title, description, iconHtml: CHECK_ICON_SVG, rarity: 'rare', duration: 4000 });
  }

  public destroy(): void {
    this.achievement?.destroy();
    this.achievement = null;
  }
}
