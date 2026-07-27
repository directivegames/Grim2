import * as ENGINE from '@gnsx/genesys.js';

import { FilmGrainActor } from '../post/FilmGrainActor.js';
import { FilmGrainUI } from '../ui/FilmGrainUI.js';
import { CloudShadowActor } from '../cloudShadow/CloudShadowActor.js';
import { CloudShadowState } from '../cloudShadow/CloudShadowState.js';
import { ScenicFogActor } from '../actors/ScenicFogActor.js';
import { ZombieHordeManager } from '../actors/ZombieHordeManager.js';
import {
  gameSettings,
  type GraphicsQuality,
} from './game-settings.js';
import { isMobileDevice } from './mobile-device.js';
import { shouldDisableWebGpuTslEffects } from './browser-compat.js';

export type GraphicsQualityProfile = {
  pixelRatioCap: number;
  filmGrain: boolean;
  filmGrainOpacity: number;
  cloudShadows: boolean;
  scenicFog: boolean;
  scenicFogCount: number;
  desktopHordeCap: number;
};

export const GRAPHICS_QUALITY_PROFILES: Record<GraphicsQuality, GraphicsQualityProfile> = {
  low: {
    pixelRatioCap: 1,
    filmGrain: false,
    filmGrainOpacity: 0,
    cloudShadows: false,
    scenicFog: false,
    scenicFogCount: 0,
    desktopHordeCap: 35,
  },
  medium: {
    pixelRatioCap: 1.5,
    filmGrain: true,
    filmGrainOpacity: 0.07,
    cloudShadows: true,
    scenicFog: true,
    scenicFogCount: 2,
    desktopHordeCap: 45,
  },
  high: {
    pixelRatioCap: 2,
    filmGrain: true,
    filmGrainOpacity: 0.09,
    cloudShadows: true,
    scenicFog: true,
    scenicFogCount: 3,
    desktopHordeCap: 50,
  },
};

export function getGraphicsQualityProfile(
  quality: GraphicsQuality = gameSettings.graphicsQuality,
): GraphicsQualityProfile {
  return GRAPHICS_QUALITY_PROFILES[quality] ?? GRAPHICS_QUALITY_PROFILES.high;
}

/** Apply renderer + atmosphere settings that can change at runtime. */
export function applyGraphicsQuality(
  world: ENGINE.World,
  gameLoop?: { renderer?: { native?: { setPixelRatio?: (dpr: number) => void } } | null },
): void {
  const profile = getGraphicsQualityProfile();
  const mobile = isMobileDevice();
  const disableTsl = shouldDisableWebGpuTslEffects();

  try {
    const dpr = Math.min(window.devicePixelRatio || 1, profile.pixelRatioCap);
    gameLoop?.renderer?.native?.setPixelRatio?.(dpr);
  } catch {
    /* renderer may not be ready */
  }

  if (!mobile) {
    if (profile.filmGrain) {
      FilmGrainUI.attach(world, {
        enabled: true,
        opacity: profile.filmGrainOpacity,
        animated: true,
      });
      for (const actor of world.getActors()) {
        if (actor instanceof FilmGrainActor) {
          const grain = actor.getFilmGrainComponent();
          if (grain) {
            grain.enabled = true;
            grain.opacity = profile.filmGrainOpacity;
          }
        }
      }
    } else {
      FilmGrainUI.detach(world);
      for (const actor of world.getActors()) {
        if (actor instanceof FilmGrainActor) {
          const grain = actor.getFilmGrainComponent();
          if (grain) grain.enabled = false;
        }
      }
    }
  }

  if (!mobile && !disableTsl) {
    CloudShadowState.applySettings({ enabled: profile.cloudShadows });
    for (const actor of world.getActors()) {
      if (actor instanceof CloudShadowActor) {
        actor.setHiddenInGame(!profile.cloudShadows);
      }
    }

    const fogs = world.getActors().filter((a) => a instanceof ScenicFogActor) as ScenicFogActor[];
    fogs.forEach((fog, index) => {
      const show = profile.scenicFog && index < profile.scenicFogCount;
      fog.setHiddenInGame(!show);
    });
  }

  if (!mobile) {
    for (const actor of world.getActors()) {
      if (actor instanceof ZombieHordeManager) {
        actor.applyGraphicsHordeCap(profile.desktopHordeCap);
      }
    }
  }
}
