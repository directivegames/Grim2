/**
 * Full-screen loading overlay with progress bar and status text.
 * Stays visible until warmup completes (title menu may show underneath in peek mode).
 */
import { UI_START_BG, getCachedUiImageUrl, resolveAndCacheUiImage } from '../utils/ui-image-cache.js';

export const LOADING_SCREEN_ATTR = 'data-grim-loading-screen';

const STYLE_ID = 'grim-loading-screen-styles';

/** Progress 0–100 mapped to staged boot + preload + warmup. */
export type LoadingProgressListener = (percent: number, status: string) => void;

let _root: HTMLDivElement | null = null;
let _fill: HTMLDivElement | null = null;
let _percentLabel: HTMLSpanElement | null = null;
let _statusLabel: HTMLSpanElement | null = null;
let _dotsEl: HTMLSpanElement | null = null;
let _targetPercent = 0;
let _displayPercent = 0;
let _rafId = 0;
let _dotsTimer = 0;

function ensureStyles(container: HTMLElement): void {
  if (container.querySelector(`#${STYLE_ID}`)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes grim-load-pulse {
      0%, 100% { opacity: 0.45; transform: scale(0.98); }
      50% { opacity: 1; transform: scale(1); }
    }
    @keyframes grim-load-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    @keyframes grim-load-spin {
      to { transform: rotate(360deg); }
    }
    .grim-loading-logo {
      animation: grim-load-pulse 2.2s ease-in-out infinite;
    }
    .grim-loading-bar-fill.grim-loading-indeterminate {
      background: linear-gradient(
        90deg,
        rgba(0, 180, 220, 0.25) 0%,
        rgba(0, 220, 255, 0.95) 45%,
        rgba(0, 180, 220, 0.25) 100%
      );
      background-size: 200% 100%;
      animation: grim-load-shimmer 1.4s linear infinite;
      width: 35% !important;
    }
    .grim-loading-spinner {
      width: 28px;
      height: 28px;
      border: 2px solid rgba(120, 140, 160, 0.35);
      border-top-color: rgba(0, 220, 255, 0.9);
      border-radius: 50%;
      animation: grim-load-spin 0.85s linear infinite;
      flex-shrink: 0;
    }
  `;
  container.appendChild(style);
}

function tickDots(): void {
  if (!_dotsEl) {
    return;
  }
  const phase = Math.floor(performance.now() / 420) % 4;
  _dotsEl.textContent = '.'.repeat(phase);
}

function applyPercent(percent: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  if (_fill) {
    _fill.style.width = `${clamped}%`;
    if (clamped > 2) {
      _fill.classList.remove('grim-loading-indeterminate');
    }
  }
  if (_percentLabel) {
    _percentLabel.textContent = `${clamped}%`;
  }
}

function animatePercent(): void {
  if (!_root) {
    _rafId = 0;
    return;
  }
  const diff = _targetPercent - _displayPercent;
  if (Math.abs(diff) < 0.4) {
    _displayPercent = _targetPercent;
    applyPercent(_displayPercent);
    _rafId = 0;
    return;
  }
  _displayPercent += diff * 0.14;
  applyPercent(_displayPercent);
  _rafId = requestAnimationFrame(animatePercent);
}

function schedulePercentAnimation(): void {
  if (_rafId) {
    return;
  }
  _rafId = requestAnimationFrame(animatePercent);
}

export class LoadingScreenUI {
  /** Attach to host or game container (call from main() before engine boot). */
  public static attach(container: HTMLElement): void {
    if (container.querySelector(`[${LOADING_SCREEN_ATTR}]`)) {
      return;
    }
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    ensureStyles(container);

    const root = document.createElement('div');
    root.setAttribute(LOADING_SCREEN_ATTR, '');
    root.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10080;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding: clamp(24px, 6vh, 56px) clamp(20px, 5vw, 40px);
      box-sizing: border-box;
      background: rgba(5, 5, 8, 0.94);
      pointer-events: none;
      transition: background 0.55s ease;
    `;

    const topCluster = document.createElement('div');
    topCluster.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -58%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      width: min(320px, 88vw);
    `;

    const logo = document.createElement('div');
    logo.className = 'grim-loading-logo';
    logo.style.cssText = `
      width: min(200px, 52vw);
      aspect-ratio: 16 / 10;
      background: rgba(20, 24, 32, 0.6) center / contain no-repeat;
      border-radius: 4px;
    `;
    void resolveAndCacheUiImage(UI_START_BG).then(url => {
      if (url && logo.isConnected) {
        logo.style.backgroundImage = `url("${url}")`;
      }
    });
    const cachedLogo = getCachedUiImageUrl(UI_START_BG);
    if (cachedLogo) {
      logo.style.backgroundImage = `url("${cachedLogo}")`;
    }

    const titleRow = document.createElement('div');
    titleRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    const spinner = document.createElement('div');
    spinner.className = 'grim-loading-spinner';

    const title = document.createElement('div');
    title.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: clamp(0.75rem, 2vw, 0.95rem);
      letter-spacing: 0.28em;
      color: rgba(200, 220, 235, 0.92);
      text-shadow: 0 0 18px rgba(0, 200, 255, 0.25);
    `;
    const dots = document.createElement('span');
    dots.style.cssText = `display: inline-block; min-width: 1.2em; text-align: left;`;
    dots.textContent = '';
    title.append('LOADING', dots);
    titleRow.append(spinner, title);

    topCluster.append(logo, titleRow);

    const panel = document.createElement('div');
    panel.style.cssText = `
      width: min(420px, 92vw);
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    const barRow = document.createElement('div');
    barRow.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    `;

    const percentLabel = document.createElement('span');
    percentLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-weight: 700;
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      color: rgba(0, 220, 255, 0.9);
      min-width: 3.2em;
    `;
    percentLabel.textContent = '0%';

    const track = document.createElement('div');
    track.style.cssText = `
      flex: 1;
      height: 8px;
      border-radius: 999px;
      background: rgba(0, 220, 255, 0.12);
      border: 1px solid rgba(100, 160, 200, 0.25);
      overflow: hidden;
    `;

    const fill = document.createElement('div');
    fill.className = 'grim-loading-bar-fill grim-loading-indeterminate';
    fill.style.cssText = `
      height: 100%;
      width: 0%;
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(0, 160, 200, 0.85), rgba(0, 230, 255, 0.95));
      transition: width 0.08s linear;
    `;
    track.appendChild(fill);

    barRow.append(track, percentLabel);

    const statusLabel = document.createElement('div');
    statusLabel.style.cssText = `
      font-family: Montserrat, system-ui, sans-serif;
      font-size: clamp(0.58rem, 1.35vw, 0.72rem);
      letter-spacing: 0.1em;
      color: rgba(160, 175, 190, 0.88);
      text-align: center;
      min-height: 1.2em;
    `;
    statusLabel.textContent = 'Starting Grim…';

    panel.append(barRow, statusLabel);
    root.append(topCluster, panel);
    container.appendChild(root);

    _root = root;
    _fill = fill;
    _percentLabel = percentLabel;
    _statusLabel = statusLabel;
    _dotsEl = dots;
    _targetPercent = 0;
    _displayPercent = 0;

    window.clearInterval(_dotsTimer);
    _dotsTimer = window.setInterval(tickDots, 120);
    tickDots();

    LoadingScreenUI.setProgress(3, 'Initializing…');
  }

  /** Lighter overlay so the title menu art is visible while warmup finishes. */
  public static setPeekMode(enabled: boolean): void {
    if (!_root) {
      return;
    }
    _root.style.background = enabled
      ? 'rgba(5, 5, 8, 0.52)'
      : 'rgba(5, 5, 8, 0.94)';
  }

  public static setProgress(percent: number, status: string): void {
    _targetPercent = Math.max(_targetPercent, percent);
    schedulePercentAnimation();
    if (_statusLabel && status) {
      _statusLabel.textContent = status;
    }
  }

  public static isVisible(): boolean {
    return Boolean(_root?.isConnected);
  }

  public static dismiss(): void {
    window.clearInterval(_dotsTimer);
    _dotsTimer = 0;
    if (_rafId) {
      cancelAnimationFrame(_rafId);
      _rafId = 0;
    }

    const root = _root;
    _root = null;
    _fill = null;
    _percentLabel = null;
    _statusLabel = null;
    _dotsEl = null;

    if (!root?.parentNode) {
      return;
    }
    root.style.transition = 'opacity 0.45s ease';
    root.style.opacity = '0';
    window.setTimeout(() => {
      root.remove();
    }, 480);
  }
}

/** Staged progress helpers for boot pipeline. */
export const LoadingStages = {
  boot: { percent: 8, status: 'Booting engine…' },
  worldReady: { percent: 14, status: 'Loading Burdenville…' },
  menuVisible: { percent: 20, status: 'Preparing menu…' },
  uiPreloadStart: { percent: 22, status: 'Loading interface…' },
  uiPreloadEnd: { percent: 62, status: 'Interface ready' },
  warmupStart: { percent: 64, status: 'Warming up gameplay…' },
  warmupEnd: { percent: 98, status: 'Almost ready…' },
  done: { percent: 100, status: 'Ready' },
} as const;

export function mapUiPreloadProgress(loaded: number, total: number): number {
  const t = Math.max(1, total);
  const frac = Math.min(1, loaded / t);
  return LoadingStages.uiPreloadStart.percent
    + frac * (LoadingStages.uiPreloadEnd.percent - LoadingStages.uiPreloadStart.percent);
}

export function mapWarmupProgress(frac: number, status: string): void {
  const p = LoadingStages.warmupStart.percent
    + Math.min(1, Math.max(0, frac)) * (LoadingStages.warmupEnd.percent - LoadingStages.warmupStart.percent);
  LoadingScreenUI.setProgress(p, status);
}
