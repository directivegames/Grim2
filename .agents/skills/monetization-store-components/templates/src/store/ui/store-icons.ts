/**
 * Developer-authored SVG icons for the store UI. These strings are trusted
 * markup and may be passed to widget `icon` / `iconHtml` options. Never put
 * network or player strings in here.
 */

export const COIN_ICON_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4.5"></circle></svg>';

export const BAG_ICON_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8z"></path><path d="M9 8V6a3 3 0 0 1 6 0v2"></path></svg>';

export const PLUS_ICON_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';

export const CLOSE_ICON_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

export const CHECK_ICON_SVG =
  '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"></path></svg>';

export const USER_ICON_SVG =
  '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a8adb8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>';

export const ALERT_ICON_SVG =
  '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>';

export const LOCK_ICON_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a8adb8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';

/* Placeholder art shown on a tile until the item has an image (potion, crest, gift, coin pile). */
export const ART_CONSUMABLE_SVG =
  '<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M40 14h16v14l14 26a16 16 0 0 1-14 24H40a16 16 0 0 1-14-24l14-26V14Z" fill="#1d6b52" stroke="#8ff0c4" stroke-width="3" stroke-linejoin="round"></path><path d="M31 56h34a13 13 0 0 1-11 20H42a13 13 0 0 1-11-20Z" fill="#5ee6a8"></path><rect x="36" y="10" width="24" height="8" rx="3" fill="#8ff0c4"></rect><circle cx="44" cy="66" r="3" fill="#e8fff4"></circle><circle cx="55" cy="62" r="2" fill="#e8fff4"></circle></svg>';

export const ART_PERMANENT_SVG =
  '<svg viewBox="0 0 96 96" aria-hidden="true"><path d="M48 10 78 22v22c0 18-12 32-30 40-18-8-30-22-30-40V22l30-12Z" fill="#2b3680" stroke="#b7c3ff" stroke-width="3" stroke-linejoin="round"></path><path d="M48 26 58 46l-10 8-10-8 10-20Z" fill="#8ea2ff"></path><path d="M36 54h24v6H36z" fill="#b7c3ff"></path></svg>';

export const ART_FREE_SVG =
  '<svg viewBox="0 0 96 96" aria-hidden="true"><rect x="18" y="38" width="60" height="44" rx="6" fill="#7a4d16" stroke="#fbd27a" stroke-width="3"></rect><rect x="14" y="28" width="68" height="16" rx="4" fill="#fbbf24"></rect><rect x="43" y="28" width="10" height="54" fill="#fff1c2"></rect><path d="M48 28c-8-2-14-8-12-14 3-6 10-2 12 6 2-8 9-12 12-6 2 6-4 12-12 14Z" fill="#fde68a"></path></svg>';

export const ART_COINS_SVG =
  '<svg viewBox="0 0 96 96" aria-hidden="true"><ellipse cx="40" cy="70" rx="26" ry="9" fill="#a16207"></ellipse><ellipse cx="40" cy="64" rx="26" ry="9" fill="#fbbf24"></ellipse><ellipse cx="56" cy="52" rx="26" ry="9" fill="#a16207"></ellipse><ellipse cx="56" cy="46" rx="26" ry="9" fill="#fcd34d"></ellipse><ellipse cx="44" cy="34" rx="26" ry="9" fill="#a16207"></ellipse><ellipse cx="44" cy="28" rx="26" ry="9" fill="#fde68a"></ellipse><ellipse cx="44" cy="28" rx="12" ry="4" fill="none" stroke="#a16207" stroke-width="2"></ellipse></svg>';

export type ArtKind = 'consumable' | 'permanent' | 'free';

export function placeholderArt(kind: ArtKind): string {
  return kind === 'consumable' ? ART_CONSUMABLE_SVG : kind === 'free' ? ART_FREE_SVG : ART_PERMANENT_SVG;
}

/** 1100 -> "1,100" */
export function formatCoins(coins: number): string {
  return Math.round(coins).toLocaleString('en-US');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * `<img>` markup for a catalog image, or "" when there is no usable https URL
 * (the tile then shows placeholder art). Attributes are escaped
 * because the URL comes from the catalog, not from this codebase.
 */
export function safeImageHtml(url: string | null | undefined, alt: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    return `<img src="${escapeAttribute(parsed.toString())}" alt="${escapeAttribute(alt)}" loading="lazy">`;
  } catch {
    return '';
  }
}

/** customStyles that re-skin a kit primary Button with the configured accent. */
export function accentButtonStyles(accent: string | null | undefined): Record<string, string> {
  if (!accent) return {};
  return {
    '--ui-btn-bg': accent,
    '--ui-btn-bg-hover': accent,
    '--ui-btn-bg-active': accent,
    '--ui-btn-shadow': 'none',
  };
}
