/**
 * Hook before intro / mission start. Mobile load optimizations were reverted;
 * mobile controls and HUD remain in their own modules.
 */
import * as ENGINE from '@gnsx/genesys.js';

export async function prepareMobileForGameplay(_world: ENGINE.World): Promise<void> {
  /* no-op — callers may await without blocking desktop or mobile gameplay setup */
}
