import { loadWorld } from './utils.js';

export async function getSceneState(sceneName: string, specifiedActors?: string[], getDetailedComponentsInfo?: boolean) {
  using worldResource = await loadWorld(sceneName, { readonly: true, skipLoadingGLTF: false });

  const world = worldResource.world;
  return world.describe({specifiedActors, includeComponentsDetails: getDetailedComponentsInfo});
}

// This foramts the json into a yaml style output, so as to get rid of quotes and braces to hopefully save some tokens
// it's not much compared to a condensed json output. Not using it for now
function format(obj: any, indent = 0): string {
  const spaces = '  '.repeat(indent);
  if (Array.isArray(obj)) {
    return obj
      .map(item => `${spaces}- ${format(item, indent + 1).trimStart()}`)
      .join('\n');
  } else if (obj && typeof obj === 'object') {
    return Object.entries(obj)
      .map(
        ([key, value]) =>
          `${spaces}${key}: ${
            typeof value === 'object' ? `\n${format(value, indent + 1)}` : value
          }`
      )
      .join('\n');
  } else {
    return String(obj);
  }
}
