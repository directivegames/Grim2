import * as ENGINE from '@gnsx/genesys.js';

import { STORE_VERSION } from '../store-config.js';

import type { ItemView, StoreState, StoreTab } from '../store-controller.js';
import { StoreItemCard, type CardAction, type CardMode } from './store-item-card.js';
import {
  ALERT_ICON_SVG,
  BAG_ICON_SVG,
  CLOSE_ICON_SVG,
  COIN_ICON_SVG,
  LOCK_ICON_SVG,
  PLUS_ICON_SVG,
  USER_ICON_SVG,
  accentButtonStyles,
  formatCoins,
} from './store-icons.js';

export interface StorePanelOptions extends ENGINE.BaseUIComponentOptions {
  accent?: string | null;
  /** Show the low-opacity session line (signed-in state, user id, environment) in the footer. */
  showSessionInfo?: boolean;
  onClose?: () => void;
  /** Get Silicon: must open the top-up tab synchronously, inside the click (Q30). */
  onGetSilicon?: () => void;
  /** Editor only: shown in place of Get Silicon while the balance is Test Silicon. */
  onRefill?: () => void;
  onTab?: (tab: StoreTab) => void;
  onRetry?: () => void;
  onLogin?: () => void;
  onCancelLogin?: () => void;
  onAction?: (sku: string, action: CardAction) => void;
}

/**
 * The store dialog: header (balance, Get Silicon, close), Shop / Inventory tabs,
 * an auto-fill grid of StoreItemCard (two columns on phones in portrait, more in
 * landscape), and one view per non-ready state.
 * Renders from StoreState; owns no logic.
 */
export class StorePanel extends ENGINE.BaseUIComponent<StorePanelOptions> {
  private backdrop: HTMLElement | null = null;
  private pressStartedOnBackdrop = false;
  private releasedOnBackdrop = false;
  private balanceElement: HTMLElement | null = null;
  private testTagElement: HTMLElement | null = null;
  private gridElement: HTMLElement | null = null;
  private inventoryEmpty: HTMLElement | null = null;
  private errorMessage: HTMLElement | null = null;
  private notice: HTMLElement | null = null;
  private sessionInfo: HTMLElement | null = null;
  private guestBar: HTMLElement | null = null;
  private topUpBar: HTMLElement | null = null;
  private topUpText: HTMLElement | null = null;
  private guestText: HTMLElement | null = null;
  private loginButton: ENGINE.Button | null = null;
  private headerButton: ENGINE.Button | null = null;
  private stateElements = new Map<string, HTMLElement>();
  private tabButtons = new Map<StoreTab, HTMLElement>();
  private tabCounts = new Map<StoreTab, HTMLElement>();
  private cards = new Map<string, StoreItemCard>();
  private cardMode: CardMode = 'shop';
  private lastState: StoreState | null = null;
  private rendering = false;
  private pendingState: StoreState | null = null;

  protected override getAssetPaths(): { templatePath: string; stylesPath: string } {
    return {
      templatePath: '@project/assets/ui/store/store-panel.html',
      stylesPath: '@project/assets/ui/store/store-panel.css',
    };
  }

  protected override getDefaultOptions(): Required<StorePanelOptions> {
    return {
      position: 'none',
      visible: true,
      customClasses: [],
      customStyles: {},
      accent: null,
      showSessionInfo: true,
      onClose: () => undefined,
      onGetSilicon: () => undefined,
      onRefill: () => undefined,
      onTab: () => undefined,
      onRetry: () => undefined,
      onLogin: () => undefined,
      onCancelLogin: () => undefined,
      onAction: () => undefined,
    };
  }

  protected override getInitialData(): Record<string, unknown> {
    return {};
  }

  protected override cacheElements(): void {
    if (!this.layout) return;
    this.backdrop = this.layout.querySelector('[data-store-backdrop]');
    // A tap on the dimmed area around the panel closes it; taps inside never do,
    // nor does a press that starts inside the panel and ends on the backdrop (a text selection)
    // or one that starts on the backdrop and ends inside the panel.
    this.backdrop?.addEventListener('pointerdown', (event) => {
      this.pressStartedOnBackdrop = event.target === this.backdrop;
    });
    this.backdrop?.addEventListener('pointerup', (event) => {
      this.releasedOnBackdrop = event.target === this.backdrop;
    });
    this.backdrop?.addEventListener('click', (event) => {
      const startedOnBackdrop = this.pressStartedOnBackdrop;
      const releasedOnBackdrop = this.releasedOnBackdrop;
      this.pressStartedOnBackdrop = false;
      this.releasedOnBackdrop = false;
      if (startedOnBackdrop && releasedOnBackdrop && event.target === this.backdrop) this.options.onClose();
    });
    this.balanceElement = this.layout.querySelector('[data-store-balance]');
    this.testTagElement = this.layout.querySelector('[data-store-test-tag]');
    this.gridElement = this.layout.querySelector('[data-store-grid]');
    this.inventoryEmpty = this.layout.querySelector('[data-store-inventory-empty]');
    this.errorMessage = this.layout.querySelector('[data-store-error-message]');
    this.notice = this.layout.querySelector('[data-store-notice]');
    this.sessionInfo = this.layout.querySelector('[data-store-session-info]');
    this.guestBar = this.layout.querySelector('[data-store-guest-bar]');
    this.guestText = this.layout.querySelector('[data-store-guest-text]');
    this.topUpBar = this.layout.querySelector('[data-store-topup-bar]');
    this.topUpText = this.layout.querySelector('[data-store-topup-text]');
    for (const tab of ['shop', 'inventory'] as StoreTab[]) {
      const button = this.layout.querySelector(`[data-store-tab="${tab}"]`) as HTMLElement | null;
      const count = this.layout.querySelector(`[data-store-tab-count="${tab}"]`) as HTMLElement | null;
      if (button) this.tabButtons.set(tab, button);
      if (count) this.tabCounts.set(tab, count);
    }
    for (const name of ['loading', 'empty', 'error', 'unlinked']) {
      const element = this.layout.querySelector(`[data-store-state="${name}"]`);
      if (element) this.stateElements.set(name, element);
    }
  }

  protected override async onInitialize(): Promise<void> {
    const slot = (selector: string): HTMLElement => {
      const element = this.layout?.querySelector(selector);
      if (!element) throw new Error(`Store panel template is missing ${selector}.`);
      return element;
    };
    const icon = (selector: string, svg: string): void => {
      const element = this.layout?.querySelector(selector);
      if (element) element.innerHTML = svg; // trusted, developer-authored SVG
    };
    icon('[data-store-coin-icon]', COIN_ICON_SVG);
    icon('[data-store-guest-icon]', USER_ICON_SVG);
    icon('[data-store-topup-icon]', COIN_ICON_SVG);
    icon('[data-store-empty-icon]', BAG_ICON_SVG);
    icon('[data-store-error-icon]', ALERT_ICON_SVG);
    icon('[data-store-unlinked-icon]', LOCK_ICON_SVG);

    this.headerButton = await this.mountChild(
      ENGINE.Button,
      {
        label: 'Get Silicon',
        variant: 'primary', // gold fill via .store-header CSS (decision: D + 2); never takes the project accent
        size: 'medium',
        icon: PLUS_ICON_SVG,
        // One button, two jobs: Get Silicon for players, Refill Test Silicon in the editor (Q26).
        onClick: () => (this.lastState?.currency === 'test-coins' ? this.options.onRefill() : this.options.onGetSilicon()),
      },
      slot('[data-store-get-coins-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: '', variant: 'ghost', size: 'medium', icon: CLOSE_ICON_SVG, onClick: () => this.options.onClose() },
      slot('[data-store-close-slot]'),
    );
    this.layout?.querySelector('[data-store-close-slot] .ui-button')?.setAttribute('aria-label', 'Close store');

    for (const [tab, button] of this.tabButtons) {
      button.addEventListener('click', () => this.options.onTab(tab));
    }
    if (this.options.accent) {
      (this.layout?.querySelector('.store-panel') as HTMLElement | null)?.style.setProperty('--store-accent', this.options.accent);
    }

    this.loginButton = await this.mountChild(
      ENGINE.Button,
      {
        label: 'Sign in',
        variant: 'primary',
        size: 'medium',
        customStyles: accentButtonStyles(this.options.accent),
        // One button, two jobs: starts the popup sign-in, or cancels the wait.
        onClick: () => (this.lastState?.loginPending ? this.options.onCancelLogin() : this.options.onLogin()),
      },
      slot('[data-store-login-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: 'Get Silicon', variant: 'primary', size: 'medium', icon: PLUS_ICON_SVG, onClick: () => this.options.onGetSilicon() },
      slot('[data-store-topup-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: 'Retry', variant: 'secondary', size: 'medium', onClick: () => this.options.onRetry() },
      slot('[data-store-retry-slot]'),
    );
    await this.mountChild(
      ENGINE.Button,
      { label: 'Browse the Shop', variant: 'secondary', size: 'small', onClick: () => this.options.onTab('shop') },
      slot('[data-store-browse-slot]'),
    );

    if (this.lastState) await this.render(this.lastState);
  }

  /**
   * Renders a state snapshot. Safe to call on every controller `state` event:
   * renders are serialized (cards mount asynchronously) and the latest state
   * always wins; a failing render is logged instead of breaking the store.
   */
  public async render(state: StoreState): Promise<void> {
    this.lastState = state;
    if (!this.backdrop) return;
    if (this.rendering) {
      this.pendingState = state;
      return;
    }
    this.rendering = true;
    try {
      await this.renderNow(state);
    } catch (error) {
      console.error('[Store] panel render failed', error);
    } finally {
      this.rendering = false;
      const next = this.pendingState;
      this.pendingState = null;
      if (next) void this.render(next);
    }
  }

  private async renderNow(state: StoreState): Promise<void> {
    if (!this.backdrop) return;

    this.backdrop.hidden = !state.isOpen;
    if (this.balanceElement) {
      this.balanceElement.textContent = state.balance === null ? '—' : formatCoins(state.balance);
    }
    const testMode = state.currency === 'test-coins';
    if (this.testTagElement) this.testTagElement.hidden = !(testMode && state.balance !== null);
    this.headerButton?.setLabel(testMode ? 'Refill Test Silicon' : 'Get Silicon');
    this.headerButton?.setDisabled(testMode && state.refillPending);

    const ownedViews = state.items.filter((view) => view.owned && view.quantity > 0);
    for (const [tab, button] of this.tabButtons) {
      button.setAttribute('aria-selected', String(state.activeTab === tab));
    }
    const counts: Record<StoreTab, number> = { shop: state.items.length, inventory: ownedViews.length };
    for (const [tab, element] of this.tabCounts) {
      element.textContent = counts[tab] > 0 ? String(counts[tab]) : '';
    }

    const showGrid = state.phase === 'ready' || (state.phase === 'guest' && state.items.length > 0);
    for (const [name, element] of this.stateElements) {
      element.hidden = state.phase !== name;
    }
    if (this.guestBar) {
      this.guestBar.hidden = state.phase !== 'guest';
      if (this.guestText) {
        this.guestText.textContent = state.loginPending
          ? 'Finish signing in in the window that just opened. The store updates by itself once you are in.'
          : 'You are browsing as a guest. Sign in with your Sandbox account to buy or claim items; your Silicon and items follow you across games.';
      }
      this.loginButton?.setLabel(state.loginPending ? 'Cancel sign-in' : 'Sign in');
      this.loginButton?.setVariant(state.loginPending ? 'secondary' : 'primary');
    }
    // Short on Silicon, or waiting for a top-up in the other tab (Q30). Never in the editor.
    if (this.topUpBar) {
      const text = testMode ? null : topUpText(state);
      this.topUpBar.hidden = text === null;
      if (this.topUpText && text) this.topUpText.textContent = text;
    }
    if (this.errorMessage && state.lastError) {
      this.errorMessage.textContent = `${state.lastError.message} (${state.lastError.code})`;
    }
    // An action failed while the catalog itself is fine: say so inline.
    if (this.notice) {
      const actionError = state.phase !== 'error' && state.phase !== 'loading' ? state.lastError : null;
      this.notice.hidden = !actionError;
      if (actionError) this.notice.textContent = `${actionError.message} (${actionError.code})`;
    }
    if (this.sessionInfo) {
      this.sessionInfo.textContent = this.options.showSessionInfo ? sessionInfoText(state) : '';
    }

    if (!this.gridElement) return;
    const views = state.activeTab === 'inventory' ? ownedViews : state.items;
    const mode: CardMode = state.activeTab === 'inventory' ? 'inventory' : 'shop';
    const gridVisible = showGrid && views.length > 0;
    this.gridElement.hidden = !gridVisible;
    if (this.inventoryEmpty) {
      this.inventoryEmpty.hidden = !(showGrid && state.activeTab === 'inventory' && views.length === 0);
    }
    if (!gridVisible) return;
    await this.renderCards(views, mode, state.busySku, state.phase === 'guest');
  }

  private async renderCards(views: ItemView[], mode: CardMode, busySku: string | null, guest: boolean): Promise<void> {
    if (!this.gridElement) return;
    if (mode !== this.cardMode) {
      // Cards keep per-mode button semantics; rebuild when switching tabs.
      for (const card of this.cards.values()) card.destroy();
      this.cards.clear();
      this.gridElement.replaceChildren();
      this.cardMode = mode;
    }
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.sku);
      let card = this.cards.get(view.sku);
      if (!card) {
        const holder = document.createElement('div');
        holder.dataset.storeCardHolder = view.sku;
        this.gridElement.appendChild(holder);
        card = await this.mountChild(
          StoreItemCard,
          { accent: this.options.accent, onAction: (sku: string, action: CardAction) => this.options.onAction(sku, action) },
          holder,
        );
        this.cards.set(view.sku, card);
      }
      card.setView(view, mode, busySku === view.sku, guest);
    }
    for (const [sku, card] of this.cards) {
      if (seen.has(sku)) continue;
      card.destroy();
      this.cards.delete(sku);
      this.gridElement.querySelector(`[data-store-card-holder="${sku}"]`)?.remove();
    }
  }

  protected override onDestroy(): void {
    this.cards.clear();
    this.stateElements.clear();
    this.tabButtons.clear();
    this.tabCounts.clear();
    this.backdrop = null;
    this.balanceElement = null;
    this.testTagElement = null;
    this.gridElement = null;
    this.inventoryEmpty = null;
    this.errorMessage = null;
    this.notice = null;
    this.sessionInfo = null;
    this.guestBar = null;
    this.guestText = null;
    this.topUpBar = null;
    this.topUpText = null;
    this.loginButton = null;
    this.headerButton = null;
    this.lastState = null;
  }
}

/** "store v<version> · <username> · production · game <game id>", or the guest / loading equivalent. */
export function sessionInfoText(state: StoreState): string {
  const parts: string[] = [`store v${STORE_VERSION}`];
  const session = state.session;
  if (!session) parts.push(state.phase === 'loading' ? 'Checking session…' : 'Session unknown');
  else if (!session.authenticated) parts.push('Not signed in');
  else parts.push(session.username ?? session.userId ?? 'player');
  if (session?.environment) parts.push(session.environment);
  if (session?.paymentMode === 'sandbox') parts.push('sandbox payments');
  if (state.currency === 'test-coins') parts.push('test silicon');
  parts.push(state.gameId ? `game ${state.gameId}` : 'game not linked');
  if (state.items.some((item) => item.draft)) parts.push('drafts visible');
  return parts.join(' · ');
}

/** The top-up bar's line, or null to hide it. */
export function topUpText(state: Pick<StoreState, 'shortfall' | 'awaitingTopUp'>): string | null {
  if (state.awaitingTopUp) {
    return 'Finish your top-up in the Silicon tab. Your balance updates here once it lands.';
  }
  if (state.shortfall !== null && state.shortfall > 0) {
    return `You need ${formatCoins(state.shortfall)} more Silicon for this item.`;
  }
  return null;
}
