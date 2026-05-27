import * as ENGINE from '@gnsx/genesys.js';

function extractUrlFromCss(text: string): string | null {
  const match = text.match(/url\(["']([^"']+)["']\)/);
  return match?.[1] ?? null;
}

function extractImgSrc(html: string): string | null {
  const match = html.match(/src=["']([^"']+)["']/);
  return match?.[1] ?? null;
}

function isResolvedAssetUrl(url: string): boolean {
  return url.length > 0 && !url.includes('@project') && !url.includes('@engine');
}

/** Resolve a single @project / @engine path to a browser-loadable URL. */
export async function resolveProjectAssetUrl(projectPath: string): Promise<string> {
  const direct = (await ENGINE.resolveAssetPathsInText(projectPath)).trim();
  if (isResolvedAssetUrl(direct)) {
    return direct;
  }

  const fromCss = extractUrlFromCss(
    await ENGINE.resolveAssetPathsInText(`url("${projectPath}")`),
  );
  if (fromCss && isResolvedAssetUrl(fromCss.trim())) {
    return fromCss.trim();
  }

  const fromImg = extractImgSrc(
    await ENGINE.resolveAssetPathsInText(`<img src="${projectPath}" alt="" />`),
  );
  if (fromImg && isResolvedAssetUrl(fromImg.trim())) {
    return fromImg.trim();
  }

  return '';
}
