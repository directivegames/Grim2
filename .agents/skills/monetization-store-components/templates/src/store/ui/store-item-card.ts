import * as ENGINE from '@gnsx/genesys.js';

import type { ItemView } from '../store-controller.js';
import { COIN_ICON_SVG, accentButtonStyles, formatCoins, placeholderArt, safeImageHtml, type ArtKind } from './store-icons.js';

export type CardMode = 'shop' | 'inventory';
export type CardAction = 'buy' | 'buy-again' | 'claim' | 'use' | 'owned';

export interface StoreItemCardOptions extends ENGINE.BaseUIComponentOptions {
  accent?: string | null;
  /** Called with the item id and the action the button represented. */
  onAction?: (itemId: string, action: CardAction) => void;
}

interface ButtonSpec {
  label: string;
  variant: 'primary' | 'secondary' | 'success';
  disabled: boolean;
  action: CardAction;
}

function isFree(view: ItemView): boolean {
  return 'free' in view.price && view.price.free === true;
}

/**
 * Which button an item gets, per tab (decision Q18 / Q18b: one click, no confirm).
 * Guests keep the same actions; the labels say sign-in comes first.
 */
export function buttonSpecFor(view: ItemView, mode: CardMode, guest = false): ButtonSpec {
  if (mode === 'inventory') {
    return view.consumable
      ? { label: 'Use', variant: 'success', disabled: view.quantity <= 0, action: 'use' }
      : { label: 'Owned', variant: 'secondary', disabled: true, action: 'owned' };
  }
  if (guest) {
    return view.action === 'claim'
      ? { label: 'Sign in to claim', variant: 'success', disabled: false, action: 'claim' }
      : { label: 'Sign in to buy', variant: 'primary', disabled: false, action: 'buy' };
  }
  switch (view.action) {
    case 'claim':
      return { label: 'Claim', variant: 'success', disabled: false, action: 'claim' };
    case 'buy-again':
      return { label: 'Buy another', variant: 'primary', disabled: false, action: 'buy-again' };
    case 'owned':
      return { label: isFree(view) ? 'Claimed' : 'Owned', variant: 'secondary', disabled: true, action: 'owned' };
    case 'published':
      return { label: 'Published', variant: 'secondary', disabled: true, action: 'owned' };
    case 'processing':
      return { label: 'Processing…', variant: 'secondary', disabled: true, action: 'owned' };
    default:
      return { label: 'Buy', variant: 'primary', disabled: false, action: 'buy' };
  }
}

function artKindOf(view: ItemView): ArtKind {
  if (isFree(view)) return 'free';
  return view.consumable ? 'consumable' : 'permanent';
}

/**
 * One item tile in the Shop or Inventory grid: art (item image, or placeholder
 * art per kind), type chip and owned count on the art, name, description,
 * price and one contextual ENGINE.Button.
 */
export class StoreItemCard extends ENGINE.BaseUIComponent<StoreItemCardOptions> {
  private root: HTMLElement | null = null;
  private artElement: HTMLElement | null = null;
  private typeElement: HTMLElement | null = null;
  private countElement: HTMLElement | null = null;
  private draftElement: HTMLElement | null = null;
  private pictureElement: HTMLElement | null = null;
  private nameElement: HTMLElement | null = null;
  private descriptionElement: HTMLElement | null = null;
  private amountElement: HTMLElement | null = null;
  private noteElement: HTMLElement | null = null;
  private actionSlot: HTMLElement | null = null;
  private button: ENGINE.Button | null = null;
  private view: ItemView | null = null;
  private mode: CardMode = 'shop';
  private guest = false;
  private currentAction: CardAction = 'buy';
  private renderedPicture = '';

  protected override getAssetPaths(): { templatePath: string; stylesPath: string } {
    return {
      templatePath: '@project/assets/ui/store/store-item-card.html',
      stylesPath: '@project/assets/ui/store/store-item-card.css',
    };
  }

  protected override getDefaultOptions(): Required<StoreItemCardOptions> {
    return {
      position: 'none',
      visible: true,
      customClasses: [],
      customStyles: {},
      accent: null,
      onAction: () => undefined,
    };
  }

  protected override getInitialData(): Record<string, unknown> {
    return {};
  }

  protected override cacheElements(): void {
    if (!this.layout) return;
    this.root = this.layout.querySelector('[data-store-card]');
    this.artElement = this.layout.querySelector('[data-store-card-art]');
    this.typeElement = this.layout.querySelector('[data-store-card-type]');
    this.countElement = this.layout.querySelector('[data-store-card-count]');
    this.draftElement = this.layout.querySelector('[data-store-card-draft]');
    this.pictureElement = this.layout.querySelector('[data-store-card-picture]');
    this.nameElement = this.layout.querySelector('[data-store-card-name]');
    this.descriptionElement = this.layout.querySelector('[data-store-card-description]');
    this.amountElement = this.layout.querySelector('[data-store-card-amount]');
    this.noteElement = this.layout.querySelector('[data-store-card-note]');
    this.actionSlot = this.layout.querySelector('[data-store-card-action-slot]');
  }

  protected override async onInitialize(): Promise<void> {
    if (!this.actionSlot || !this.artElement) throw new Error('Store item card template is missing its slots.');
    this.button = await this.mountChild(
      ENGINE.Button,
      {
        label: 'Buy',
        variant: 'primary',
        size: 'medium',
        onClick: () => {
          if (this.view) this.options.onAction(this.view.itemId, this.currentAction);
        },
      },
      this.actionSlot,
    );
    if (this.view) this.applyView();
  }

  public getItemId(): string | null {
    return this.view?.itemId ?? null;
  }

  /** Renders an item; safe to call before initialize() and on every state change. */
  public setView(view: ItemView, mode: CardMode, busy: boolean, guest = false): void {
    this.view = view;
    this.mode = mode;
    this.guest = guest;
    if (this.root) this.root.dataset.busy = String(busy);
    if (this.button) this.applyView();
    this.button?.setLoading(busy);
  }

  private applyView(): void {
    const view = this.view;
    if (!view) return;
    const kind = artKindOf(view);

    if (this.artElement) this.artElement.dataset.kind = kind;
    if (this.typeElement) this.typeElement.textContent = view.consumable ? 'Consumable' : 'Permanent';
    if (this.draftElement) this.draftElement.hidden = !view.draft;
    if (this.root) this.root.dataset.draft = String(view.draft);
    if (this.root) this.root.title = view.action === 'published' ? 'Published: take it down to draft to test it with Test Silicon' : '';
    if (this.countElement) {
      this.countElement.hidden = !(view.owned && view.quantity > 0);
      this.countElement.textContent = `×${view.quantity}`;
    }
    // Item image when there is one, placeholder art otherwise. Both are trusted markup:
    // safeImageHtml only ever emits an https <img> with escaped attributes.
    const picture = safeImageHtml(view.imageUrl, view.name) || placeholderArt(kind);
    if (this.pictureElement && picture !== this.renderedPicture) {
      this.pictureElement.innerHTML = picture;
      this.renderedPicture = picture;
    }
    if (this.nameElement) this.nameElement.textContent = view.name;
    if (this.descriptionElement) this.descriptionElement.textContent = view.description;

    if (this.amountElement) {
      if (this.mode === 'inventory') {
        this.amountElement.textContent = '';
        this.amountElement.dataset.free = 'false';
      } else if (isFree(view)) {
        this.amountElement.textContent = 'Free';
        this.amountElement.dataset.free = 'true';
      } else {
        const coins = 'coins' in view.price ? view.price.coins : 0;
        this.amountElement.innerHTML = COIN_ICON_SVG; // trusted, developer-authored SVG
        this.amountElement.append(formatCoins(coins));
        if ('currency' in view.price && view.price.currency === 'test-coins') {
          const tag = document.createElement('span');
          tag.className = 'store-test-tag';
          tag.textContent = 'TEST';
          this.amountElement.append(tag);
        }
        this.amountElement.dataset.free = 'false';
      }
    }
    if (this.noteElement) {
      this.noteElement.textContent =
        this.mode === 'inventory'
          ? view.consumable
            ? `${view.quantity} left`
            : 'In your inventory'
          : '';
    }

    const spec = buttonSpecFor(view, this.mode, this.guest);
    this.currentAction = spec.action;
    this.button?.setLabel(spec.label);
    this.button?.setVariant(spec.variant);
    this.button?.setDisabled(spec.disabled);
    // Only primary buttons take the accent; success/secondary keep kit colors.
    if (spec.variant === 'primary' && this.options.accent) {
      for (const [property, value] of Object.entries(accentButtonStyles(this.options.accent))) {
        this.button?.getElement()?.querySelector('.ui-button')?.style.setProperty(property, value);
      }
    }
  }

  protected override onDestroy(): void {
    this.button = null;
    this.root = null;
    this.artElement = null;
    this.typeElement = null;
    this.countElement = null;
    this.draftElement = null;
    this.pictureElement = null;
    this.nameElement = null;
    this.descriptionElement = null;
    this.amountElement = null;
    this.noteElement = null;
    this.actionSlot = null;
    this.view = null;
  }
}
