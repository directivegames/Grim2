/**
 * DialogueUI — reusable bottom-centred dialogue box using SpeakerUI.png.
 *
 * Click once to complete typewriter, again to advance. Long lines are split
 * automatically so text always fits inside the frame.
 */
import * as ENGINE from '@gnsx/genesys.js';

import type { DialogueLine, DialogueScript } from '../dialogue/DialogueTypes.js';
import { gameSettings } from '../utils/game-settings.js';
import { mountCutsceneSkipButton } from './CutsceneSkipUI.js';

const SPEAKER_PANEL_URL = '@project/assets/UI/SpeakerUI.png';
/** Matches assets/UI/SpeakerUI.png (1536×1024) */
const SPEAKER_PANEL_ASPECT = 1536 / 1024;
/** Fits in the horizontal gap between health (left) and souls (right) HUD. */
const SPEAKER_PANEL_MAX_WIDTH_PX = 540;
/** Sits in the bottom-centre gap; HUD only occupies the corners. */
const SPEAKER_PANEL_BOTTOM_PX = 36;
/** Side reserve for corner HUD (health ~302px + souls ~241px at 0.35 scale). */
const SPEAKER_PANEL_SIDE_RESERVE_PX = 600;
const SPEAKER_PANEL_MIN_WIDTH_PX = 320;
/**
 * Text plaque region inside SpeakerUI.png (fractions of panel size).
 */
const TEXT_INSET_LEFT = 0.13;
const TEXT_INSET_RIGHT = 0.10;
const TEXT_INSET_TOP = 0.28;
const TEXT_INSET_BOTTOM = 0.18;
const HINT_INSET_RIGHT = 0.10;
const HINT_INSET_BOTTOM = 0.10;
const STYLE_ID = 'grim-dialogue-keyframes';
const TYPEWRITER_MS_PER_CHAR = 35;
const PANEL_ENTER_MS = 420;
const PANEL_EXIT_MS = 380;
const SPEAKER_FADE_MS = 220;
/** Reserve vertical space for the speaker label inside the clip area. */
const SPEAKER_LABEL_RESERVE_PX = 22;

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
  private _resolvedPanelUrl = '';
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

    const resolved = await ENGINE.resolveAssetPathsInText(
      `url("${SPEAKER_PANEL_URL}")`,
    );
    const match = resolved.match(/url\("([^"]+)"\)/);
    this._resolvedPanelUrl = match?.[1] ?? '';

    DialogueUI._injectKeyframes(container);
    this._mount(container);

    this._removeSkipButton = mountCutsceneSkipButton(this._world, () => {
      void this._closeAndComplete();
    }, 'SKIP DIALOGUE');

    await delay(50);
    if (this._panel) {
      this._panel.style.opacity = '1';
      this._panel.style.transform = 'translate(-50%, 0)';
    }

    await delay(PANEL_ENTER_MS);
    this._playbackLines = this._expandLines(this._sourceLines);
    this._showLine(0);
  }

  private _mount(container: HTMLElement): void {
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
    panel.style.cssText = `
      position: absolute;
      left: 50%;
      bottom: ${SPEAKER_PANEL_BOTTOM_PX}px;
      width: min(${SPEAKER_PANEL_MAX_WIDTH_PX}px, 82vw, max(${SPEAKER_PANEL_MIN_WIDTH_PX}px, calc(100vw - ${SPEAKER_PANEL_SIDE_RESERVE_PX}px)));
      max-width: ${SPEAKER_PANEL_MAX_WIDTH_PX}px;
      aspect-ratio: ${SPEAKER_PANEL_ASPECT};
      height: auto;
      transform: translate(-50%, 110%);
      opacity: 0;
      transition: transform ${PANEL_ENTER_MS * 0.001}s cubic-bezier(0.22, 1, 0.36, 1),
                  opacity ${PANEL_ENTER_MS * 0.001}s ease;
    `;

    const bg = document.createElement('div');
    bg.style.cssText = `
      position: absolute;
      inset: 0;
      background-image: url("${this._resolvedPanelUrl}");
      background-size: 100% 100%;
      background-repeat: no-repeat;
      filter: drop-shadow(0 8px 22px rgba(0,0,0,0.7));
      pointer-events: none;
    `;

    const clip = document.createElement('div');
    clip.className = 'grim-dialogue-clip';
    clip.style.cssText = `
      position: absolute;
      left: ${TEXT_INSET_LEFT * 100}%;
      right: ${TEXT_INSET_RIGHT * 100}%;
      top: ${TEXT_INSET_TOP * 100}%;
      bottom: ${TEXT_INSET_BOTTOM * 100}%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: flex-start;
      gap: 0.35em;
      box-sizing: border-box;
      pointer-events: none;
    `;

    const speaker = document.createElement('span');
    speaker.className = 'grim-dialogue-speaker';
    speaker.style.cssText = `
      flex-shrink: 0;
      font-size: clamp(11px, 1.5vw, 14px);
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin: 0;
      transition: opacity ${SPEAKER_FADE_MS * 0.001}s ease;
      text-shadow: 0 2px 6px rgba(0,0,0,0.85);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    `;

    const body = document.createElement('p');
    body.className = 'grim-dialogue-body';
    body.style.cssText = `
      flex: 0 1 auto;
      margin: 0;
      font-size: clamp(12px, 1.65vw, 16px);
      line-height: 1.4;
      color: #f0ebe3;
      width: 100%;
      overflow: hidden;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    `;

    const hint = document.createElement('span');
    hint.className = 'grim-dialogue-hint';
    hint.style.cssText = `
      position: absolute;
      right: ${HINT_INSET_RIGHT * 100}%;
      bottom: ${HINT_INSET_BOTTOM * 100}%;
      font-size: clamp(9px, 1.1vw, 11px);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(232, 220, 200, 0.55);
      opacity: 0;
      transition: opacity 0.25s ease;
      white-space: nowrap;
      pointer-events: none;
      text-shadow: 0 1px 4px rgba(0,0,0,0.9);
    `;
    hint.textContent = 'Click — Next';

    clip.appendChild(speaker);
    clip.appendChild(body);
    panel.appendChild(bg);
    panel.appendChild(clip);
    panel.appendChild(hint);
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
      const panelWidth = panel?.getBoundingClientRect().width ?? SPEAKER_PANEL_MAX_WIDTH_PX;
      const panelHeight = panelWidth / SPEAKER_PANEL_ASPECT;
      clipWidth = panelWidth * (1 - TEXT_INSET_LEFT - TEXT_INSET_RIGHT);
      clipHeight = panelHeight * (1 - TEXT_INSET_TOP - TEXT_INSET_BOTTOM);
    }

    return {
      maxWidth: Math.max(120, clipWidth),
      maxBodyHeight: Math.max(40, clipHeight - SPEAKER_LABEL_RESERVE_PX),
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
    this._measurer.style.fontSize = bodyStyle?.fontSize ?? 'clamp(12px, 1.65vw, 16px)';
    this._measurer.style.lineHeight = bodyStyle?.lineHeight ?? '1.4';
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
      this._panel.style.transform = 'translate(-50%, 110%)';
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
    `;
    container.appendChild(style);
  }
}
