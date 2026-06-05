/**
 * Browser-specific runtime capability gates.
 */

export function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent;
  const vendor = navigator.vendor;
  const isAppleBrowser = /Apple/i.test(vendor);
  const hasSafariToken = /Safari/i.test(ua);
  const isOtherChromiumOrFirefox =
    /Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(ua);

  return isAppleBrowser && hasSafariToken && !isOtherChromiumOrFirefox;
}

/**
 * Safari's WebGPU compiler can reject complex TSL node shaders with private
 * address-space limits. Disable those optional effects there and keep gameplay.
 */
export function shouldDisableWebGpuTslEffects(): boolean {
  return isSafariBrowser();
}
