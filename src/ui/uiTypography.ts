/**
 * Shared sunset-yellow typography for in-game HUD text.
 */

export const FONT_URL = '@project/assets/UI/Bree_Serif/BreeSerif-Regular.ttf';

/** Warm sunset yellow — used for all HUD numbers/labels */
export const SUNSET_YELLOW = '#FFB347';
export const SUNSET_YELLOW_BRIGHT = '#FFE082';

/** Heavy outline + glow so text reads on any background */
export const SUNSET_TEXT_SHADOW = `
  -2px -2px 0 #1a0a00,
  2px -2px 0 #1a0a00,
  -2px 2px 0 #1a0a00,
  2px 2px 0 #1a0a00,
  0 3px 6px rgba(0, 0, 0, 0.85),
  0 0 14px rgba(255, 140, 40, 0.75),
  0 0 28px rgba(255, 100, 20, 0.35)
`.replace(/\s+/g, ' ').trim();

/** Brief RGB split on impact (chromatic aberration) */
export const CHROMATIC_TEXT_SHADOW = `
  3px 0 0 rgba(255, 60, 60, 0.9),
  -3px 0 0 rgba(80, 120, 255, 0.9),
  0 0 16px rgba(255, 179, 71, 1)
`.replace(/\s+/g, ' ').trim();

export function injectBreeSerifFont(): void {
  if (document.querySelector('style[data-font="BreeSerif"]')) return;

  const fontFace = document.createElement('style');
  fontFace.setAttribute('data-font', 'BreeSerif');
  fontFace.textContent = `
    @font-face {
      font-family: 'BreeSerif';
      src: url('${FONT_URL}') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
  `;
  document.head.appendChild(fontFace);
}

/** Base CSS for HUD number text */
export function sunsetNumberTextCss(fontSizePx: number): string {
  return `
    font-family: 'BreeSerif', Georgia, serif;
    font-size: ${fontSizePx}px;
    font-weight: 900;
    color: ${SUNSET_YELLOW};
    -webkit-text-stroke: 1.5px #5c2e00;
    paint-order: stroke fill;
    text-shadow: ${SUNSET_TEXT_SHADOW};
    will-change: transform, text-shadow, opacity;
  `.replace(/\s+/g, ' ').trim();
}

/** Brief edge vignette pulse when something impactful happens on screen */
export function pulseHitVignette(gameContainer: HTMLElement): void {
  const flash = document.createElement('div');
  flash.style.cssText = `
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1400;
    background: radial-gradient(ellipse at center, transparent 45%, rgba(255, 120, 30, 0.22) 100%);
    opacity: 0;
  `;
  gameContainer.appendChild(flash);

  flash.animate(
    [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }],
    { duration: 220, easing: 'ease-out' },
  ).onfinish = () => flash.remove();
}

/** Chromatic flash on a text element, then settle to normal shadow */
export function flashChromaticText(el: HTMLElement): void {
  el.style.textShadow = CHROMATIC_TEXT_SHADOW;
  el.animate(
    [{ textShadow: CHROMATIC_TEXT_SHADOW }, { textShadow: SUNSET_TEXT_SHADOW }],
    { duration: 120, easing: 'ease-out', fill: 'forwards' },
  );
}


