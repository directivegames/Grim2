import * as ENGINE from '@gnsx/genesys.js';

import { DevStorageProvider } from './storage-provider.js';

// Ensure process is available globally with minimal implementation
if (typeof globalThis.process === 'undefined') {
  (globalThis as any).process = {
    cwd: () => '/',
    env: {},
  };
}

// Initialize the game - can be called manually
export async function launchGame() {
  const container = document.getElementById('game-container');
  if (!container) {
    console.error('Game container not found!');
    return;
  }

  try {
    // Create the storage provider for Vite dev environment
    const storageProvider = new DevStorageProvider();

    ENGINE.projectContext({
      project: 'dev-game',
      storageProvider,
    });

    // Create the game runtime
    const gameRuntime = new ENGINE.GameRuntime({
      defaultEngineModule: ENGINE,
      provider: storageProvider,
      container: container,
      gameId: 'dev-game',
      buildProject: false,
      skipClearGameClasses: false
    });

    console.log('Starting game runtime...');

    // Start the game with the default scene
    await gameRuntime.startGame();
  } catch (error) {
    console.error('Failed to initialize game:', error);
  }
}
