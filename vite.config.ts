import { defineConfig, mergeConfig } from 'vite';

import sdkConfig from './.genesys/sdk/vite.config.js';

/**
 * Vite configuration for this Genesys project.
 *
 * This file imports the SDK's base Vite configuration and merges it.
 * You can customize/extend the configuration here for your specific project needs.
 *
 * @example Add custom plugins:
 * export default mergeConfig(sdkConfig, {
 *   plugins: [myCustomPlugin()]
 * });
 */
export default mergeConfig(sdkConfig, defineConfig({
  // Add your custom Vite configuration here
  // These will override or extend the SDK base configuration

  // Example: custom server port
  // server: {
  //   port: 4000
  // }
}));
