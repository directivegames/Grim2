/**
 * ReadyToReapUI — Dramatic "READY TO" → "REAP" intro before gameplay.
 *
 * Transparent overlay over the live game canvas; multiply-blended PNGs knock out white.
 * Input stays disabled until onComplete.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { BackgroundMusicActor } from '../actors/BackgroundMusicActor.js';
import { IsometricPlayerPawn } from '../actors/IsometricPlayerPawn.js';
import { gameSettings } from '../utils/game-settings.js';
import { resolveAndCacheUiImage } from '../utils/ui-image-cache.js';

const READY_URL = '@project/assets/VFX/readyto.webp';
const REAP_URL = '@project/assets/VFX/REAP.webp';

const STYLE_ID = 'grim-ready-to-reap-keyframes';

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function triggerShake(world: ENGINE.World, intensity: number, durationSec: number): void {
  const pawn = world.getFirstPlayerPawn();
  if (pawn instanceof IsometricPlayerPawn) {
    pawn.triggerScreenShake(intensity, durationSec);
  }
}

export interface ReadyToReapPlayOptions {
  /** When false, caller starts gameplay music after onComplete (e.g. mission accept). */
  startGameplayMusic?: boolean;
}

export class ReadyToReapUI {
  /**
   * Full intro sequence; calls onComplete when the player may take control.
   */
  public static async play(
    world: ENGINE.World,
    onComplete: () => void,
    options: ReadyToReapPlayOptions = {},
  ): Promise<void> {
    const { startGameplayMusic = true } = options;
    const w = world as GameContainerWorld;
    const container = w.gameContainer;
    if (!container || w.options?.headless) {
      onComplete();
      return;
    }

    if (gameSettings.skipAllCutscenes) {
      onComplete();
      return;
    }

    // Mount overlay immediately so the gameplay can run under it.
    const overlay = document.createElement('div');
    overlay.className = 'grim-rtr-overlay';
    overlay.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10095;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      pointer-events: auto;
    `;
    container.appendChild(overlay);

    try {
      world.inputManager.setInputEnabled(false);
    } catch {
      /* world may be tearing down */
    }

    if (startGameplayMusic) {
      BackgroundMusicActor.ensurePlaying(world);
    }

    ReadyToReapUI._injectKeyframes(container);

    const [readyUrl, reapUrl] = await Promise.all([
      resolveAndCacheUiImage(READY_URL),
      resolveAndCacheUiImage(REAP_URL),
    ]);

    // No screen fades here — this should be a transparent overlay over gameplay.

    const flash = document.createElement('div');
    flash.className = 'grim-rtr-flash';
    flash.style.cssText = `
      position: absolute;
      inset: 0;
      background: #fff;
      opacity: 0;
      pointer-events: none;
      z-index: 4;
    `;

    const ring = document.createElement('div');
    ring.className = 'grim-rtr-ring';
    ring.style.cssText = `
      position: absolute;
      width: 20vmin;
      height: 20vmin;
      border-radius: 50%;
      border: 3px solid rgba(255, 255, 255, 0.85);
      box-shadow: 0 0 40px rgba(200, 220, 255, 0.6), inset 0 0 30px rgba(255,255,255,0.2);
      opacity: 0;
      pointer-events: none;
      z-index: 2;
      transform: scale(0.2);
    `;

    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = `
      position: relative;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: center;
      width: min(92vw, 900px);
      max-height: 55vh;
    `;

    const img = document.createElement('img');
    img.draggable = false;
    img.style.cssText = `
      width: 100%;
      height: auto;
      max-height: 55vh;
      object-fit: contain;
      mix-blend-mode: multiply;
      filter: drop-shadow(0 0 28px rgba(180, 200, 255, 0.35));
      will-change: transform, opacity;
    `;

    const sparksHost = document.createElement('div');
    sparksHost.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 3;
      overflow: hidden;
    `;

    imgWrap.appendChild(img);
    overlay.appendChild(ring);
    overlay.appendChild(sparksHost);
    overlay.appendChild(imgWrap);
    overlay.appendChild(flash);

    const pulseFlash = (peak = 0.22, holdMs = 50): void => {
      flash.style.transition = 'none';
      flash.style.opacity = String(peak);
      void flash.offsetWidth;
      flash.style.transition = `opacity ${holdMs}ms ease-out`;
      flash.style.opacity = '0';
    };

    const expandRing = (): void => {
      ring.style.transition = 'none';
      ring.style.opacity = '0.9';
      ring.style.transform = 'scale(0.15)';
      void ring.offsetWidth;
      ring.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.9, 0.3, 1), opacity 0.55s ease-out';
      ring.style.transform = 'scale(4.5)';
      ring.style.opacity = '0';
    };

    const spawnGreenSparks = (): void => {
      sparksHost.replaceChildren();
      for (let i = 0; i < 24; i++) {
        const s = document.createElement('div');
        const angle = (i / 24) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 80 + Math.random() * 160;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist * 0.6;
        s.style.cssText = `
          position: absolute;
          left: 50%;
          top: 50%;
          width: ${4 + Math.random() * 6}px;
          height: ${4 + Math.random() * 6}px;
          margin: -3px 0 0 -3px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(120,255,140,1) 0%, rgba(40,180,80,0.4) 70%, transparent 100%);
          box-shadow: 0 0 12px rgba(80, 255, 120, 0.9);
          opacity: 1;
          --dx: ${dx}px;
          --dy: ${dy}px;
          animation: grim-rtr-spark 0.55s ease-out forwards;
          animation-delay: ${Math.random() * 0.08}s;
        `;
        sparksHost.appendChild(s);
      }
    };

    try {
      // Beat 0 — impact flash + shake
      pulseFlash(0.14, 40);
      triggerShake(world, 0.35, 0.15);
      await delay(80);

      // READY TO — slam from above
      img.src = readyUrl;
      img.style.animation = 'grim-rtr-slam-down 0.42s cubic-bezier(0.34, 1.45, 0.64, 1) forwards';
      expandRing();
      triggerShake(world, 0.85, 0.32);
      pulseFlash(0.2, 60);
      await delay(420);

      img.style.animation = 'none';
      img.style.transform = 'scale(1) translateY(0)';
      await delay(600);

      // READY TO — smash away downward
      img.style.animation = 'grim-rtr-smash-out-down 0.32s cubic-bezier(0.55, 0, 1, 0.45) forwards';
      triggerShake(world, 0.55, 0.22);
      await delay(320);

      img.style.visibility = 'hidden';
      pulseFlash(0.16, 45);
      await delay(120);

      // REAP — slam from below (bigger)
      img.src = reapUrl;
      img.style.visibility = 'visible';
      img.style.filter = 'drop-shadow(0 0 36px rgba(60, 255, 100, 0.45))';
      img.style.animation = 'grim-rtr-slam-up 0.48s cubic-bezier(0.22, 1.35, 0.36, 1) forwards';
      expandRing();
      spawnGreenSparks();
      triggerShake(world, 1.0, 0.38);
      pulseFlash(0.24, 70);
      await delay(480);

      img.style.animation = 'grim-rtr-wobble 0.35s ease-in-out';
      await delay(350);

      img.style.animation = 'none';
      img.style.transform = 'scale(1.05) rotate(0deg)';
      await delay(1000);

      // REAP — explode off
      img.style.animation = 'grim-rtr-explode 0.38s cubic-bezier(0.6, 0, 1, 0.2) forwards';
      sparksHost.replaceChildren();
      triggerShake(world, 0.9, 0.35);
      pulseFlash(0.2, 80);
      await delay(380);

      // Fade overlay out
      overlay.style.transition = 'opacity 0.25s ease-out';
      overlay.style.opacity = '0';
      await delay(260);
    } finally {
      overlay.remove();
      container.querySelector(`#${STYLE_ID}`)?.remove();
      onComplete();
    }
  }

  private static _injectKeyframes(container: HTMLElement): void {
    if (container.querySelector(`#${STYLE_ID}`)) return;

    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      @keyframes grim-rtr-slam-down {
        0% { transform: scale(2.2) translateY(-55vh) rotate(-4deg); opacity: 0; }
        70% { transform: scale(0.96) translateY(2vh) rotate(1deg); opacity: 1; }
        100% { transform: scale(1) translateY(0) rotate(0deg); opacity: 1; }
      }
      @keyframes grim-rtr-smash-out-down {
        0% { transform: scale(1) translateY(0); opacity: 1; }
        100% { transform: scale(1.15) translateY(70vh) rotate(8deg); opacity: 0; }
      }
      @keyframes grim-rtr-slam-up {
        0% { transform: scale(3.2) translateY(60vh) rotate(5deg); opacity: 0; }
        65% { transform: scale(0.94) translateY(-3vh) rotate(-2deg); opacity: 1; }
        100% { transform: scale(1.05) translateY(0) rotate(0deg); opacity: 1; }
      }
      @keyframes grim-rtr-wobble {
        0%, 100% { transform: scale(1.05) rotate(0deg); }
        25% { transform: scale(1.08) rotate(-2.5deg); }
        75% { transform: scale(1.06) rotate(2.5deg); }
      }
      @keyframes grim-rtr-explode {
        0% { transform: scale(1.05) rotate(0deg); opacity: 1; filter: brightness(1.2); }
        40% { transform: scale(1.35) rotate(-3deg); opacity: 1; }
        100% { transform: scale(2.5) rotate(12deg); opacity: 0; filter: brightness(2); }
      }
      @keyframes grim-rtr-spark {
        0% { transform: translate(0, 0) scale(1); opacity: 1; }
        100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; }
      }
    `;
    container.appendChild(st);
  }
}
