/**
 * DialogueUI — reusable bottom dialogue bar.
 *
 * Click once to complete typewriter, again to advance. Long lines are split
 * automatically so text always fits inside the bar.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { DialogueLine, DialogueScript } from '../dialogue/DialogueTypes.js';
import { gameSettings } from '../utils/game-settings.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { mountCutsceneSkipButton } from './CutsceneSkipUI.js';

/** Match FistAbilityHUDUI placement so dialogue clears the E skill stack. */
const FIST_HUD_BOTTOM_PX = 20 + 235 * 0.35 + 10;
const FIST_HUD_STACK_PX = 11 + 3 + 52;
const PANEL_GAP_ABOVE_FIST_PX = 36;
const PANEL_BOTTOM_DESKTOP_PX = FIST_HUD_BOTTOM_PX + FIST_HUD_STACK_PX + PANEL_GAP_ABOVE_FIST_PX;

const PANEL_HEIGHT_DESKTOP_PX = 130;
const PANEL_HEIGHT_MOBILE_PX = 110;
const TEXT_INSET_LEFT_PX = 14;
const TEXT_INSET_RIGHT_PX = 14;
const TEXT_INSET_TOP_DESKTOP_PX = 32;
const TEXT_INSET_TOP_MOBILE_PX = 28;
const TEXT_INSET_BOTTOM_DESKTOP_PX = 30;
const TEXT_INSET_BOTTOM_MOBILE_PX = 26;
const STYLE_ID = 'grim-dialogue-keyframes';
const TYPEWRITER_MS_PER_CHAR = 35;
const PANEL_ENTER_MS = 420;
const PANEL_EXIT_MS = 380;
const SPEAKER_FADE_MS = 220;

const SPEAKER_COLORS: Record<string, string> = {
  Grim: '#e8dcc8',
  Intercom: '#a8c4d0',
};

const DEFAULT_SPEAKER_COLOR = '#e8dcc8';

type GameContainerWorld = ENGINE.World & {
  gameContainer?: HTMLElement;
  options?: { headless?: boolean };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function speakerColor(name: string): string {
  return SPEAKER_COLORS[name] ?? DEFAULT_SPEAKER_COLOR;
}

export class DialogueUI {
  private static _active: DialogueUI | null = null;

  private readonly _world: ENGINE.World;
  private readonly _sourceLines: DialogueScript;
  private readonly _onComplete: () => void;

  private _root: HTMLDivElement | null = null;
  private _panel: HTMLDivElement | null = null;
  private _clipEl: HTMLDivElement | null = null;
  private _speakerEl: HTMLSpanElement | null = null;
  private _bodyEl: HTMLParagraphElement | null = null;
  private _hintEl: HTMLSpanElement | null = null;
  private _measurer: HTMLDivElement | null = null;

  private _playbackLines: DialogueLine[] = [];
  private _lineIndex = 0;
  private _currentSpeaker = '';
  private _fullLineText = '';
  private _revealedChars = 0;
  private _typewriterDone = true;
  private _typewriterTimer: ReturnType<typeof setInterval> | null = null;
  private _closing = false;
  private _removeSkipButton: (() => void) | null = null;

  private constructor(world: ENGINE.World, lines: DialogueScript, onComplete: () => void) {
    this._world = world;
    this._sourceLines = lines;
    this._onComplete = onComplete;
  }

  /**
   * Play a dialogue script. Resolves when the player finishes the last line.
   */
  public static play(
    world: ENGINE.World,
    lines: DialogueScript,
    onComplete?: () => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        onComplete?.();
        resolve();
      };

      const w = world as GameContainerWorld;
      if (!w.gameContainer || w.options?.headless || lines.length === 0) {
        done();
        return;
      }

      if (gameSettings.skipAllCutscenes) {
        done();
        return;
      }

      DialogueUI.close();

      const ui = new DialogueUI(world, lines, done);
      DialogueUI._active = ui;
      void ui._run();
    });
  }

  public static close(): void {
    DialogueUI._active?._destroy(false);
    DialogueUI._active = null;
  }

  /** End the active dialogue and run its completion callback. */
  public static completeActive(): void {
    const active = DialogueUI._active;
    if (!active) {
      return;
    }
    void active._closeAndComplete();
  }

  public static isPlaying(): boolean {
    return DialogueUI._active != null;
  }

  private async _run(): Promise<void> {
    const container = (this._world as GameContainerWorld).gameContainer;
    if (!container) {
      this._finish(false);
      return;
    }

    try {
      this._world.inputManager.setInputEnabled(false);
    } catch {
      /* */
    }

    DialogueUI._injectKeyframes(container);
    this._mount(container);

    this._removeSkipButton = mountCutsceneSkipButton(this._world, () => {
      void this._closeAndComplete();
    }, 'SKIP DIALOGUE');

    await delay(50);
    if (this._panel) {
      this._panel.style.opacity = '1';
      this._panel.style.transform = this._panelShownTransform();
    }
    await delay(PANEL_ENTER_MS);
    this._playbackLines = this._expandLines(this._sourceLines);
    this._showLine(0);
  }

  private _panelShownTransform(): string {
    return 'translateY(0)';
  }

  private _panelHiddenTransform(): string {
    return 'translateY(110%)';
  }

  private _mount(container: HTMLElement): void {
    const mobile = isMobileDevice();
    const panelHeight = mobile ? PANEL_HEIGHT_MOBILE_PX : PANEL_HEIGHT_DESKTOP_PX;
    const panelBottom = mobile ? 0 : PANEL_BOTTOM_DESKTOP_PX;
    const textInsetTop = mobile ? TEXT_INSET_TOP_MOBILE_PX : TEXT_INSET_TOP_DESKTOP_PX;
    const textInsetBottom = mobile ? TEXT_INSET_BOTTOM_MOBILE_PX : TEXT_INSET_BOTTOM_DESKTOP_PX;
    const speakerFontSize = mobile ? '12px' : '14px';
    const bodyFontSize = mobile ? '14px' : '18px';
    const hintFontSize = mobile ? '10px' : '12px';

    const root = document.createElement('div');
    root.className = 'grim-dialogue-root';
    root.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 10100;
      pointer-events: auto;
      cursor: pointer;
      font-family: 'Bree Serif', serif;
    `;

    const panel = document.createElement('div');
    panel.className = 'grim-dialogue-panel';

    const clip = document.createElement('div');
    clip.className = 'grim-dialogue-clip';

    const body = document.createElement('p');
    body.className = 'grim-dialogue-body';

    const hint = document.createElement('span');
    hint.className = 'grim-dialogue-hint';
    hint.textContent = 'Click — Next';

    const speaker = document.createElement('span');
    speaker.className = 'grim-dialogue-speaker';

    panel.style.cssText = `
      position: absolute;
      bottom: ${panelBottom}px;
      left: 0;
      right: 0;
      height: ${panelHeight}px;
      background: rgba(8, 6, 14, 0.93);
      border-top: 2px solid rgba(110, 80, 140, 0.55);
      box-shadow: 0 -6px 28px rgba(0,0,0,0.75);
      box-sizing: border-box;
      transform: translateY(110%);
      opacity: 0;
      transition: transform ${PANEL_ENTER_MS * 0.001}s cubic-bezier(0.22, 1, 0.36, 1),
                  opacity ${PANEL_ENTER_MS * 0.001}s ease;
    `;

    speaker.style.cssText = `
      position: absolute;
      top: 10px;
      left: ${TEXT_INSET_LEFT_PX}px;
      font-size: ${speakerFontSize};
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      transition: opacity ${SPEAKER_FADE_MS * 0.001}s ease;
      text-shadow: 0 2px 8px rgba(0,0,0,0.9);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      z-index: 4;
    `;

    clip.style.cssText = `
      position: absolute;
      top: ${textInsetTop}px;
      left: ${TEXT_INSET_LEFT_PX}px;
      right: ${TEXT_INSET_RIGHT_PX}px;
      bottom: ${textInsetBottom}px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: flex-start;
      pointer-events: none;
    `;

    body.style.cssText = `
      margin: 0;
      font-size: ${bodyFontSize};
      line-height: 1.45;
      color: #f0ebe3;
      width: 100%;
      overflow: hidden;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    `;

    hint.style.cssText = `
      position: absolute;
      right: ${TEXT_INSET_RIGHT_PX}px;
      bottom: 9px;
      font-size: ${hintFontSize};
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(232, 220, 200, 0.5);
      opacity: 0;
      transition: opacity 0.25s ease;
      white-space: nowrap;
      pointer-events: none;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    `;

    clip.appendChild(body);
    panel.appendChild(clip);
    panel.appendChild(hint);
    panel.appendChild(speaker);
    root.appendChild(panel);
    container.appendChild(root);

    root.addEventListener('click', () => this._onAdvanceClick());

    this._root = root;
    this._panel = panel;
    this._clipEl = clip;
    this._speakerEl = speaker;
    this._bodyEl = body;
    this._hintEl = hint;
  }

  /** Split long lines so every page fits inside the text plaque. */
  private _expandLines(lines: DialogueScript): DialogueLine[] {
    const { maxWidth, maxBodyHeight } = this._textMetrics();
    const expanded: DialogueLine[] = [];

    for (const line of lines) {
      const chunks = this._splitTextToFit(line.text, maxBodyHeight, maxWidth);
      for (const chunk of chunks) {
        expanded.push({ speaker: line.speaker, text: chunk });
      }
    }

    return expanded;
  }

  private _textMetrics(): { maxWidth: number; maxBodyHeight: number } {
    const clip = this._clipEl;
    const panel = this._panel;

    let clipWidth = clip?.getBoundingClientRect().width ?? 0;
    let clipHeight = clip?.getBoundingClientRect().height ?? 0;

    if (clipWidth <= 0 || clipHeight <= 0) {
      const panelWidth = panel?.getBoundingClientRect().width ?? 0;
      const panelHeight = panel?.getBoundingClientRect().height
        ?? (isMobileDevice() ? PANEL_HEIGHT_MOBILE_PX : PANEL_HEIGHT_DESKTOP_PX);
      const textInsetTop = isMobileDevice() ? TEXT_INSET_TOP_MOBILE_PX : TEXT_INSET_TOP_DESKTOP_PX;
      const textInsetBottom = isMobileDevice() ? TEXT_INSET_BOTTOM_MOBILE_PX : TEXT_INSET_BOTTOM_DESKTOP_PX;
      clipWidth = Math.max(0, panelWidth - TEXT_INSET_LEFT_PX - TEXT_INSET_RIGHT_PX);
      clipHeight = Math.max(0, panelHeight - textInsetTop - textInsetBottom);
    }

    return {
      maxWidth: Math.max(120, clipWidth),
      maxBodyHeight: Math.max(40, clipHeight),
    };
  }

  private _ensureMeasurer(maxWidth: number): HTMLDivElement {
    if (!this._measurer) {
      this._measurer = document.createElement('div');
      this._measurer.style.cssText = `
        position: absolute;
        visibility: hidden;
        pointer-events: none;
        left: -9999px;
        top: 0;
        font-family: 'Bree Serif', serif;
        white-space: normal;
        word-wrap: break-word;
      `;
      this._root?.appendChild(this._measurer);
    }

    const bodyStyle = this._bodyEl ? getComputedStyle(this._bodyEl) : null;
    this._measurer.style.width = `${maxWidth}px`;
    this._measurer.style.fontSize = bodyStyle?.fontSize ?? (isMobileDevice() ? '14px' : '18px');
    this._measurer.style.lineHeight = bodyStyle?.lineHeight ?? '1.45';
    this._measurer.style.fontFamily = bodyStyle?.fontFamily ?? "'Bree Serif', serif";
    return this._measurer;
  }

  private _splitTextToFit(text: string, maxHeight: number, maxWidth: number): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [''];

    const measurer = this._ensureMeasurer(maxWidth);
    measurer.textContent = trimmed;
    if (measurer.scrollHeight <= maxHeight) {
      return [trimmed];
    }

    const words = trimmed.split(/\s+/);
    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      let end = start + 1;
      let lastGood = start;

      while (end <= words.length) {
        const candidate = words.slice(start, end).join(' ');
        measurer.textContent = candidate;
        if (measurer.scrollHeight <= maxHeight) {
          lastGood = end;
          end++;
        } else {
          break;
        }
      }

      if (lastGood === start) {
        chunks.push(words[start]!);
        start += 1;
      } else {
        chunks.push(words.slice(start, lastGood).join(' '));
        start = lastGood;
      }
    }

    return chunks.length > 0 ? chunks : [trimmed];
  }

  private _showLine(index: number): void {
    if (index >= this._playbackLines.length) {
      void this._closeAndComplete();
      return;
    }

    this._lineIndex = index;
    const line = this._playbackLines[index]!;
    this._fullLineText = line.text;
    this._revealedChars = 0;
    this._typewriterDone = false;

    if (this._hintEl) {
      this._hintEl.style.opacity = '0';
    }

    if (line.speaker !== this._currentSpeaker) {
      this._currentSpeaker = line.speaker;
      if (this._speakerEl) {
        this._speakerEl.style.opacity = '0';
        window.setTimeout(() => {
          if (!this._speakerEl) return;
          this._speakerEl.textContent = line.speaker;
          this._speakerEl.style.color = speakerColor(line.speaker);
          this._speakerEl.style.opacity = '1';
        }, SPEAKER_FADE_MS);
      }
    } else if (this._speakerEl) {
      this._speakerEl.textContent = line.speaker;
      this._speakerEl.style.color = speakerColor(line.speaker);
    }

    this._stopTypewriter();
    if (this._bodyEl) {
      this._bodyEl.textContent = '';
    }

    this._typewriterTimer = setInterval(() => {
      this._revealedChars++;
      if (this._bodyEl) {
        this._bodyEl.textContent = this._fullLineText.slice(0, this._revealedChars);
      }
      if (this._revealedChars >= this._fullLineText.length) {
        this._completeTypewriter();
      }
    }, TYPEWRITER_MS_PER_CHAR);
  }

  private _completeTypewriter(): void {
    this._stopTypewriter();
    this._typewriterDone = true;
    if (this._bodyEl) {
      this._bodyEl.textContent = this._fullLineText;
    }
    if (this._hintEl) {
      this._hintEl.style.opacity = '1';
    }
  }

  private _stopTypewriter(): void {
    if (this._typewriterTimer != null) {
      clearInterval(this._typewriterTimer);
      this._typewriterTimer = null;
    }
  }

  private _onAdvanceClick(): void {
    if (this._closing) return;

    if (!this._typewriterDone) {
      this._completeTypewriter();
      return;
    }

    const next = this._lineIndex + 1;
    if (next >= this._playbackLines.length) {
      void this._closeAndComplete();
      return;
    }

    this._showLine(next);
  }

  private async _closeAndComplete(): Promise<void> {
    if (this._closing) return;
    this._closing = true;
    this._stopTypewriter();

    if (this._panel) {
      this._panel.style.transition = `transform ${PANEL_EXIT_MS * 0.001}s ease-in, opacity ${PANEL_EXIT_MS * 0.001}s ease`;
      this._panel.style.transform = this._panelHiddenTransform();
      this._panel.style.opacity = '0';
      await delay(PANEL_EXIT_MS + 40);
    }

    this._finish(true);
  }

  private _finish(callComplete: boolean): void {
    const cb = callComplete ? this._onComplete : undefined;
    this._destroy(callComplete);
    DialogueUI._active = null;
    cb?.();
  }

  private _destroy(callComplete: boolean): void {
    void callComplete;
    this._removeSkipButton?.();
    this._removeSkipButton = null;
    this._stopTypewriter();
    this._measurer?.remove();
    this._measurer = null;
    this._root?.remove();
    this._root = null;
    this._panel = null;
    this._clipEl = null;
    this._speakerEl = null;
    this._bodyEl = null;
    this._hintEl = null;
    this._playbackLines = [];
  }

  private static _injectKeyframes(container: HTMLElement): void {
    if (container.querySelector(`#${STYLE_ID}`)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .grim-dialogue-panel {
        image-rendering: auto;
      }
      .grim-dialogue-panel > * {
        position: absolute;
      }
    `;
    container.appendChild(style);
  }
}
