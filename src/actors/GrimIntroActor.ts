/**

 * GrimIntroActor — Grim's Room cutscene inside the default gameplay scene.

 *

 * Place the grimstatic prop in the default scene in the editor.

 * Camera cut → brief pause → dialogue → mission map.

 */

import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';



import { ISO_YAW } from '../components/movement/IsometricMovementComponent.js';

import { GRIM_INTRO_DIALOGUE } from '../data/dialogues/grim-intro.js';

import { DialogueUI } from '../ui/DialogueUI.js';

import { MapUI } from '../ui/MapUI.js';
import type { MissionDef } from '../data/missions.js';
import { beginMissionFromMap } from '../utils/begin-mission-from-map.js';
import { gameSettings } from '../utils/game-settings.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { setGameplayUnlocked } from '../utils/game-pause.js';
import { mountCutsceneSkipButton, removeCutsceneSkipButton } from '../ui/CutsceneSkipUI.js';
import { CutsceneMusicActor } from './CutsceneMusicActor.js';
import { MobileSceneChunkLoaderActor } from './MobileSceneChunkLoaderActor.js';



/** Isometric pitch – same angle used by IsometricPlayerPawn. */

const ISO_PITCH = -Math.atan(1 / Math.sqrt(2));



/** Spring-arm distance for the Grimsroom cutscene camera. */

const ISO_CAM_DISTANCE = 13;



/** Actor name or model URL keywords for the static Grim cutscene prop. */

const GRIM_STATIC_KEYWORDS = ['grimstatic', 'Grimstatic', 'GrimStatic'];



export const GRIM_INTRO_BLACK_COVER_ATTR = 'data-grim-intro-black-cover';

const BLACK_FADE_OUT_MS = 500;



/** Pause after the room is visible before dialogue begins. */

const ROOM_DIALOGUE_DELAY_MS = 1000;



type GameContainerWorld = ENGINE.World & { gameContainer?: HTMLElement };



function delay(ms: number): Promise<void> {

  return new Promise((resolve) => window.setTimeout(resolve, ms));

}



/** Full-screen black cover — call on PLAY click before the menu tears down. */

export function ensureGrimIntroBlackCover(world: ENGINE.World): void {

  const gc = (world as GameContainerWorld).gameContainer;

  if (!gc) return;



  let cover = gc.querySelector(`[${GRIM_INTRO_BLACK_COVER_ATTR}]`) as HTMLElement | null;

  if (!cover) {

    cover = document.createElement('div');

    cover.setAttribute(GRIM_INTRO_BLACK_COVER_ATTR, '');

    cover.style.cssText = `

      position: absolute;

      inset: 0;

      z-index: 10090;

      background: #050508;

      opacity: 1;

      pointer-events: none;

    `;

    gc.appendChild(cover);

  } else {

    cover.style.opacity = '1';

    cover.style.transition = 'none';

  }

}



@ENGINE.GameClass()

export class GrimIntroActor extends ENGINE.Actor {



  private _blackCover: HTMLElement | null = null;

  private _cutsceneCamera: ENGINE.ViewTargetCameraComponent | null = null;

  private _skipRequested = false;

  private _finishing = false;

  private _removeSkipButton: (() => void) | null = null;



  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }


    const world = this.getWorld();

    if (!world) return true;

    // Grim's Room cutscene music (stops when intro finishes).
    CutsceneMusicActor.ensureExists(world);



    this._showBlackCover(world);

    void this._runIntroSequence(world);
    return true;
  }



  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._removeSkipButton?.();
    this._removeSkipButton = null;
    const world = this.getWorld();
    if (world) {
      removeCutsceneSkipButton(world);
    }
    DialogueUI.close();
    // Keep intro black cover in the DOM — MapUI cross-fades it out after mount.
    this._blackCover = null;
    this._deactivateCutsceneCamera();
    return true;
  }



  private async _runIntroSequence(world: ENGINE.World): Promise<void> {
    world.inputManager.setInputEnabled(false);
    setGameplayUnlocked(false);

    const mobile = isMobileDevice();
    const mobileLoader = mobile ? MobileSceneChunkLoaderActor.ensureExists(world) : null;

    if (mobileLoader) {
      await mobileLoader.loadIntroBedroom();
      void mobileLoader.startBackgroundLoad();
    }

    if (!mobile && gameSettings.skipAllCutscenes) {
      await this._finishIntro();
      return;
    }

    if (!mobile) {
      this._removeSkipButton = mountCutsceneSkipButton(world, () => {
        void this._requestSkip();
      });
    }

    this._disableSceneViewTargetCameras(world);
    this._setupIsometricCamera(world);

    for (let i = 0; i < 4; i++) {
      if (this._skipRequested) break;
      await this._nextFrame();
    }

    if (this._skipRequested) {
      await this._finishIntro();
      return;
    }

    await this._fadeOutBlackCover();
    if (this._skipRequested) {
      await this._finishIntro();
      return;
    }

    await this._interruptibleDelay(ROOM_DIALOGUE_DELAY_MS);
    if (this._skipRequested) {
      await this._finishIntro();
      return;
    }

    this._removeSkipButton?.();
    this._removeSkipButton = null;

    await DialogueUI.play(world, GRIM_INTRO_DIALOGUE);
    if (!this._finishing) {
      await this._finishIntro();
    }
  }

  private async _requestSkip(): Promise<void> {
    if (this._finishing || this._skipRequested) {
      return;
    }
    this._skipRequested = true;
    this._removeSkipButton?.();
    this._removeSkipButton = null;
    DialogueUI.completeActive();
    await this._finishIntro();
  }

  private async _interruptibleDelay(ms: number): Promise<void> {
    const stepMs = 50;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this._skipRequested) {
        return;
      }
      const chunk = Math.min(stepMs, ms - elapsed);
      await delay(chunk);
      elapsed += chunk;
    }
  }



  private _showBlackCover(world: ENGINE.World): void {

    ensureGrimIntroBlackCover(world);

    const gc = (world as GameContainerWorld).gameContainer;

    if (!gc) return;



    this._blackCover = gc.querySelector(`[${GRIM_INTRO_BLACK_COVER_ATTR}]`) as HTMLElement | null;

  }



  private _removeBlackCover(): void {

    if (this._blackCover?.parentNode) {

      this._blackCover.remove();

    }

    this._blackCover = null;

  }



  private _fadeOutBlackCover(): Promise<void> {

    const cover = this._blackCover;

    if (!cover) return Promise.resolve();



    return new Promise((resolve) => {

      cover.style.transition = `opacity ${BLACK_FADE_OUT_MS * 0.001}s ease`;

      window.requestAnimationFrame(() => {

        cover.style.opacity = '0';

        window.setTimeout(() => {

          this._removeBlackCover();

          resolve();

        }, BLACK_FADE_OUT_MS + 50);

      });

    });

  }



  private _nextFrame(): Promise<void> {

    if (typeof window === 'undefined') {

      return Promise.resolve();

    }

    return new Promise((resolve) => {

      window.requestAnimationFrame(() => resolve());

    });

  }



  private _disableSceneViewTargetCameras(world: ENGINE.World): void {

    for (const actor of world.getActors()) {

      if (actor === this) continue;

      for (const vtc of actor.getComponents(ENGINE.ViewTargetCameraComponent)) {

        vtc.setActive(false);

      }

    }

  }



  private _setupIsometricCamera(world: ENGINE.World): void {

    const grimPos = this._findGrimWorldPosition(world) ?? new THREE.Vector3(0, 0, 0);



    const offsetDir = new THREE.Vector3(0, 0, 1);

    offsetDir.applyEuler(new THREE.Euler(ISO_PITCH, ISO_YAW, 0, 'YXZ'));



    const camPos = grimPos.clone().addScaledVector(offsetDir, ISO_CAM_DISTANCE);



    this.rootComponent.position.copy(camPos);

    this.rootComponent.rotation.set(ISO_PITCH, ISO_YAW, 0, 'YXZ');



    const vtc = ENGINE.ViewTargetCameraComponent.create({

      fov: 40,

      near: ENGINE.CAMERA_NEAR,

      far: ENGINE.CAMERA_FAR,

    });



    this.rootComponent.add(vtc);

    this._cutsceneCamera = vtc;

    vtc.setActive(true);

  }



  private _deactivateCutsceneCamera(): void {

    this._cutsceneCamera?.setActive(false);

    this._cutsceneCamera = null;

  }



  private _matchesGrimStatic(actor: ENGINE.Actor, modelUrl: string): boolean {

    const nameLower = actor.name.toLowerCase();

    if (GRIM_STATIC_KEYWORDS.some((kw) => nameLower.includes(kw.toLowerCase()))) {

      return true;

    }

    const urlLower = modelUrl.toLowerCase();

    return GRIM_STATIC_KEYWORDS.some((kw) => urlLower.includes(kw.toLowerCase()));

  }



  private _findGrimWorldPosition(world: ENGINE.World): THREE.Vector3 | null {

    for (const actor of world.getActors()) {

      if (actor === this) continue;



      const mesh = actor.getComponent(ENGINE.GLTFMeshComponent);

      const url = mesh

        ? ((mesh as unknown as { modelUrl?: string }).modelUrl ?? '')

        : '';

      if (!this._matchesGrimStatic(actor, url)) continue;



      const pos = new THREE.Vector3();

      actor.rootComponent.getWorldPosition(pos);

      return pos;

    }



    console.warn('[GrimIntroActor] Could not find grimstatic prop — camera uses scene origin.');

    return null;

  }



  /**
   * Map START → live mission under UI: Tut Soul (if enabled) → Ready To Reap → control.
   */
  private async _finishIntro(): Promise<void> {
    if (this._finishing) {
      return;
    }
    this._finishing = true;

    this._removeSkipButton?.();
    this._removeSkipButton = null;

    const world = this.getWorld();
    if (world) {
      removeCutsceneSkipButton(world);
    }

    if (!world) {
      console.error('[GrimIntroActor] No world — cannot finish intro.');
      return;
    }

    CutsceneMusicActor.stopAll(world);



    this._deactivateCutsceneCamera();

    this._disableSceneViewTargetCameras(world);

    world.removeActors(this);

    ensureGrimIntroBlackCover(world);

    MapUI.open(world, (mission: MissionDef, config) => {
      beginMissionFromMap(world, mission, config);
    });

  }

}


