/**
 * MobileCombatChromeUI — pause button and touch fallback stick zones.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { MobileCombatActor } from '../actors/MobileCombatActor.js';
import { MapUI } from './MapUI.js';
import { PauseMenuUI } from './PauseMenuUI.js';
import { UpgradeShopUI } from './UpgradeShopUI.js';
import { StartMenuUI } from './StartMenuUI.js';
import {
  MOBILE_COMBAT_ROOT_ATTR,
  bindTouchStickZone,
  ensureMobileCombatStyles,
} from './mobile-combat-layout.js';
import {
  alignMobileJoystickZones,
  findEngineJoystickZones,
  scheduleMobileJoystickAlignment,
} from '../utils/mobile-touch-zones.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import {
  canOpenPause,
  isGameplayUnlocked,
  isPaused,
  pauseGame,
  resumeGame,
} from '../utils/game-pause.js';
import { withMenuSelectSound } from '../utils/menu-audio.js';

type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };

export class MobileCombatChromeUI {
  private static readonly byWorld = new Map<ENGINE.World, MobileCombatChromeUI>();

  private readonly _world: ENGINE.World;
  private _root: HTMLDivElement | null = null;
  private _stopAlign: (() => void) | null = null;
  private _unbindMove: (() => void) | null = null;
  private _unbindAim: (() => void) | null = null;
  private _fallbackMove: HTMLDivElement | null = null;
  private _fallbackAim: HTMLDivElement | null = null;

  private constructor(world: ENGINE.World) {
    this._world = world;
  }

  public static attach(world: ENGINE.World): MobileCombatChromeUI | null {
    if (!isMobileDevice()) {
      return null;
    }

    const gc = (world as GameContainerWorld).gameContainer;
    if (!gc) {
      return null;
    }

    let inst = MobileCombatChromeUI.byWorld.get(world);
    if (!inst) {
      inst = new MobileCombatChromeUI(world);
      MobileCombatChromeUI.byWorld.set(world, inst);
    }
    inst._ensureMounted(gc);
    MobileCombatActor.ensureExists(world);
    return inst;
  }

  public static detach(world: ENGINE.World): void {
    MobileCombatChromeUI.byWorld.get(world)?._destroy();
  }

  public refreshVisibility(): void {
    if (!this._root) {
      return;
    }
    const visible = this._shouldShow();
    this._root.style.display = visible ? '' : 'none';
    if (visible) {
      this._syncTouchFallback();
    }
  }

  private _gameContainer(): HTMLElement | null {
    return (this._world as GameContainerWorld).gameContainer ?? null;
  }

  private _shouldShow(): boolean {
    if (!isMobileDevice() || !isGameplayUnlocked()) {
      return false;
    }
    if (StartMenuUI.isVisible(this._world)) {
      return false;
    }
    if (MapUI.isOpen(this._world) || UpgradeShopUI.isOpen(this._world)) {
      return false;
    }
    if (PauseMenuUI.isOpen(this._world)) {
      return false;
    }
    return true;
  }

  private _ensureMounted(host: HTMLElement): void {
    ensureMobileCombatStyles(host);
    this._stopAlign?.();
    this._stopAlign = scheduleMobileJoystickAlignment(host);

    if (this._root?.parentNode === host) {
      this.refreshVisibility();
      return;
    }

    this._destroyDom();

    const root = document.createElement('div');
    root.setAttribute(MOBILE_COMBAT_ROOT_ATTR, '');

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'grim-mobile-combat-btn grim-mobile-pause-btn';
    pauseBtn.textContent = 'PAUSE';
    pauseBtn.addEventListener('click', withMenuSelectSound(this._world, () => {
      this._togglePause();
    }));

    const moveZone = document.createElement('div');
    moveZone.className = 'grim-mobile-touch-fallback grim-mobile-touch-move';
    moveZone.setAttribute('aria-hidden', 'true');

    const aimZone = document.createElement('div');
    aimZone.className = 'grim-mobile-touch-fallback grim-mobile-touch-aim';
    aimZone.setAttribute('aria-hidden', 'true');

    root.append(pauseBtn, moveZone, aimZone);
    host.appendChild(root);

    this._root = root;
    this._fallbackMove = moveZone;
    this._fallbackAim = aimZone;

    const combat = MobileCombatActor.ensureExists(this._world);
    this._unbindMove = bindTouchStickZone(moveZone, (x, y, active) => {
      combat.setTouchMove(x, y, active);
    });
    this._unbindAim = bindTouchStickZone(aimZone, (x, y, active) => {
      combat.setTouchAim(x, y, active);
    });

    this.refreshVisibility();
    this._syncTouchFallback();
  }

  private _syncTouchFallback(): void {
    const host = this._gameContainer();
    if (!host || !this._fallbackMove || !this._fallbackAim) {
      return;
    }

    alignMobileJoystickZones(host);
    const zones = findEngineJoystickZones(host);
    const showFallback = !zones.left || !zones.right;
    this._fallbackMove.style.display = showFallback ? '' : 'none';
    this._fallbackAim.style.display = showFallback ? '' : 'none';
  }

  private _togglePause(): void {
    if (PauseMenuUI.isOpen(this._world) || isPaused()) {
      PauseMenuUI.close(this._world);
      resumeGame(this._world);
      this.refreshVisibility();
      return;
    }

    if (!canOpenPause(this._world)) {
      return;
    }

    pauseGame(this._world);
    void PauseMenuUI.open(this._world);
    this.refreshVisibility();
  }

  private _destroyDom(): void {
    this._unbindMove?.();
    this._unbindAim?.();
    this._unbindMove = null;
    this._unbindAim = null;
    this._root?.remove();
    this._root = null;
    this._fallbackMove = null;
    this._fallbackAim = null;
  }

  private _destroy(): void {
    this._stopAlign?.();
    this._stopAlign = null;
    this._destroyDom();
    MobileCombatChromeUI.byWorld.delete(this._world);
  }
}
